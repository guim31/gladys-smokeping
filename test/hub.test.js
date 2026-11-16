// -----------------------------------------------------------------------------
// The hub against the SDK's fake Gladys and a fake SmokePing: discovery,
// states, alerts and scene events, persistence across restarts, staleness,
// errors, graphs, scene actions, the widget, quiet logs, and the reading timer
// of the container.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { FEATURE_KEYS } from '../src/devices.js';
import { TRIGGERS, WIDGET_KEY, evaluate } from '../src/hub.js';
import { ERROR_TEXT } from '../src/texts.js';
import {
  BASE,
  FakeSmokePing,
  createClock,
  createDevices,
  createWorld,
  idsOf,
} from './helpers/world.js';

const events = (world, key) => world.fake.sceneEvents.filter((event) => event.key === key);
const MINUTE = 60_000;
const config = (extra = {}) => ({ url: `${BASE}/smokeping/`, language: 'en', ...extra });
const transportOf = (world, path) =>
  world.fake.transports
    .filter(
      (entry) => (entry.external_id ?? entry.device_external_id) === idsOf(world, path).device,
    )
    .at(-1)?.transport;

async function settle() {
  for (let i = 0; i < 30; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

test('one device per target, never the groups, proposed in Discovery, nothing polled by Gladys', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const devices = world.fake.discoveredDevices;
  assert.deepEqual(
    devices.map((d) => d.name),
    ['Cloudflare', 'Dead host', 'Google DNS', 'Lossy box'],
  );
  for (const device of devices) {
    assert.equal(device.should_poll, false);
    assert.equal(device.poll_frequency, undefined);
  }
  assert.deepEqual(devices[3].params, [
    { name: 'SMOKEPING_TARGET', value: 'Lab.Lossy' },
    { name: 'SMOKEPING_GROUP', value: 'Lab' },
  ]);
  // Nothing is published for devices not added.
  assert.equal(world.fake.states.length, 0);
  assert.equal(world.fake.cameraImages.length, 0);
  assert.equal(world.fake.connectionStatus.connected, true);
});

test('the states and the graph of an added device, at once, then only the changes', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await createDevices(world);
  const lossy = idsOf(world, 'Lab.Lossy');
  assert.equal(world.fake.lastState(lossy.feature(FEATURE_KEYS.REACHABLE)), 1);
  assert.equal(world.fake.lastState(lossy.feature(FEATURE_KEYS.MEDIAN_LATENCY)), 41);
  assert.equal(world.fake.lastState(lossy.feature(FEATURE_KEYS.PACKET_LOSS)), 20);
  assert.ok(world.fake.lastState(lossy.feature(FEATURE_KEYS.JITTER)) > 0);
  const date = world.fake.states.find(
    (state) => state.device_feature_external_id === lossy.feature(FEATURE_KEYS.LAST_MEASUREMENT),
  );
  assert.match(date.text, /\d\d:\d\d/);
  const dead = idsOf(world, 'Lab.Dead');
  assert.equal(world.fake.lastState(dead.feature(FEATURE_KEYS.REACHABLE)), 0);
  assert.equal(world.fake.lastState(dead.feature(FEATURE_KEYS.PACKET_LOSS)), 100);
  assert.equal(
    world.fake.states.some(
      (state) => state.device_feature_external_id === dead.feature(FEATURE_KEYS.MEDIAN_LATENCY),
    ),
    false,
    'no latency without an answer',
  );
  // One graph per added device, a PNG.
  assert.equal(world.fake.cameraImages.length, 4);
  assert.match(world.fake.cameraImages[0].image, /^image\/png;base64,iVBORw0KGgo/);
  assert.equal(transportOf(world, 'Lab.Lossy'), 'local');

  const before = world.fake.states.length;
  await world.hub.pollNow();
  assert.equal(world.fake.states.length, before, 'nothing changed, nothing sent');
  assert.equal(world.fake.cameraImages.length, 4, 'the graphs go every 5 minutes');
});

test('the measurements go at most every 5 minutes, a change of state at once', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await createDevices(world);
  const ids = idsOf(world, 'DNS.Google');
  world.smokeping.set('DNS.Google', { medianMs: 18 });
  await world.step();
  assert.equal(world.fake.lastState(ids.feature(FEATURE_KEYS.MEDIAN_LATENCY)), 13.3);
  await world.step(4);
  assert.equal(world.fake.lastState(ids.feature(FEATURE_KEYS.MEDIAN_LATENCY)), 18);
  world.smokeping.set('DNS.Google', { lost: 10 });
  await world.step();
  assert.equal(world.fake.lastState(ids.feature(FEATURE_KEYS.REACHABLE)), 0);
  assert.equal(world.fake.lastState(ids.feature(FEATURE_KEYS.PACKET_LOSS)), 100);
});

test('unreachable after the measurements in a row, reachable again with the outage, for any target', async (t) => {
  const world = await createWorld({ config: config({ rounds: '2' }) });
  t.after(() => world.app.stop());
  // Nothing added to Gladys: the events fire anyway.
  world.smokeping.set('DNS.Google', { lost: 10 });
  await world.step();
  assert.deepEqual(events(world, TRIGGERS.UNREACHABLE), [], 'one measurement is not enough');
  await world.step();
  const [down] = events(world, TRIGGERS.UNREACHABLE);
  assert.deepEqual(down.data, {
    device: idsOf(world, 'DNS.Google').device,
    target: 'Google DNS',
    group: 'DNS',
  });
  await world.step(3);
  assert.equal(events(world, TRIGGERS.UNREACHABLE).length, 1, 'announced once');
  world.smokeping.set('DNS.Google', { lost: 0 });
  await world.step();
  const [back] = events(world, TRIGGERS.REACHABLE);
  assert.equal(back.data.target, 'Google DNS');
  assert.ok(back.data.downtime_minutes >= 5 && back.data.downtime_minutes <= 7);
  // The target down from the start (first sight) fired nothing.
  assert.ok(world.fake.sceneEvents.every((event) => event.data.target !== 'Dead host'));
});

test('packet loss and latency beyond the thresholds, once until they come back below', async (t) => {
  const world = await createWorld({
    config: config({ rounds: '2', loss_threshold: 30, latency_threshold: 100 }),
  });
  t.after(() => world.app.stop());
  world.smokeping.set('DNS.Cloudflare', { lost: 4, medianMs: 150 });
  await world.step(2);
  const [loss] = events(world, TRIGGERS.LOSS_HIGH);
  assert.deepEqual(loss.data, {
    device: idsOf(world, 'DNS.Cloudflare').device,
    target: 'Cloudflare',
    group: 'DNS',
    packet_loss: 40,
  });
  assert.equal(events(world, TRIGGERS.LATENCY_HIGH)[0].data.latency, 150);
  await world.step(2);
  world.smokeping.set('DNS.Cloudflare', { lost: 0, medianMs: 15 });
  await world.step();
  world.smokeping.set('DNS.Cloudflare', { lost: 4, medianMs: 150 });
  await world.step(2);
  assert.equal(events(world, TRIGGERS.LOSS_HIGH).length, 2);
  assert.equal(events(world, TRIGGERS.LATENCY_HIGH).length, 2);
  // Lossy box: 20 % < 30 %, never.
  assert.ok(world.fake.sceneEvents.every((event) => event.data.target !== 'Lossy box'));
});

test('the alert rules, measurement by measurement', () => {
  const rules = { rounds: 2, lossThreshold: 10, latencyThreshold: 100 };
  const m = (lossPercent, medianMs = 20) => ({ lossPercent, medianMs });
  assert.deepEqual(evaluate([m(0), m(0)], rules), {
    state: 'up',
    lossHigh: false,
    latencyHigh: false,
  });
  assert.equal(evaluate([m(0), m(100, null)], rules, { state: 'up' }).state, 'up');
  assert.equal(evaluate([m(100, null), m(100, null)], rules, { state: 'up' }).state, 'down');
  // Unreachable ends the other alerts; one answer is enough to be back.
  assert.deepEqual(evaluate([m(100, null), m(100, null)], rules, { lossHigh: true }), {
    state: 'down',
    lossHigh: false,
    latencyHigh: false,
  });
  assert.equal(evaluate([m(100, null), m(90, 30)], rules, { state: 'down' }).state, 'up');
  // In between, the alert stays.
  assert.equal(evaluate([m(5), m(20)], rules, { state: 'up', lossHigh: true }).lossHigh, true);
  assert.equal(evaluate([m(5), m(20)], rules, { state: 'up' }).lossHigh, false);
  assert.equal(evaluate([m(20), m(5)], rules, { state: 'up', lossHigh: true }).lossHigh, false);
  assert.equal(evaluate([m(0, 120), m(0, 130)], rules).latencyHigh, true);
  // SmokePing did not measure: nothing changes.
  assert.deepEqual(
    evaluate([m(0), { lossPercent: null, medianMs: null }], rules, { state: 'down' }),
    {
      state: 'down',
      lossHigh: false,
      latencyHigh: false,
    },
  );
});

test('a target that went down during a restart is announced once', async (t) => {
  const clock = createClock();
  const smokeping = new FakeSmokePing({ start: clock.time });
  const first = await createWorld({ clock, smokeping });
  await first.app.stop();
  smokeping.set('Lab.Lossy', { lost: 10 });
  for (let i = 0; i < 3; i += 1) {
    clock.advance(MINUTE);
    smokeping.measure();
  }
  const second = await createWorld({ clock, smokeping, dataDir: first.dataDir });
  t.after(() => second.app.stop());
  assert.deepEqual(
    second.fake.sceneEvents.map((event) => [event.key, event.data.target]),
    [[TRIGGERS.UNREACHABLE, 'Lossy box']],
  );
  await second.hub.store.flush();
  const third = await createWorld({ clock, smokeping, dataDir: first.dataDir });
  t.after(() => third.app.stop());
  assert.deepEqual(third.fake.sceneEvents, [], 'not twice');
});

test('a target SmokePing no longer measures: nothing published, badge unreachable, no event', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await createDevices(world);
  world.clock.advance(10 * MINUTE); // no measurement in 10 minutes
  const sent = world.fake.states.length;
  await world.hub.pollNow();
  assert.ok(world.hub.list().every((target) => target.stale));
  assert.ok(
    world.fake.states
      .slice(sent)
      .every((state) => !state.device_feature_external_id.endsWith(FEATURE_KEYS.REACHABLE)),
  );
  assert.equal(transportOf(world, 'DNS.Google'), 'unreachable');
  assert.deepEqual(world.fake.sceneEvents, []);
  world.smokeping.lastUpdate += 10 * 60;
  world.smokeping.measure(false);
  await world.hub.pollNow();
  assert.equal(transportOf(world, 'DNS.Google'), 'local');
});

test('SmokePing unreachable: status, badges, no event; back: everything again', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await createDevices(world);
  world.smokeping.down = true;
  await world.step();
  assert.deepEqual(world.fake.connectionStatus, {
    connected: false,
    message: ERROR_TEXT.unreachable,
  });
  assert.equal(transportOf(world, 'Lab.Lossy'), 'unreachable');
  assert.deepEqual(world.fake.sceneEvents, []);
  world.smokeping.down = false;
  await world.step();
  assert.equal(world.fake.connectionStatus.connected, true);
  assert.equal(transportOf(world, 'Lab.Lossy'), 'local');
});

test('the RRD files not served, a login refused, no address: each one says what to do', async (t) => {
  const smokeping = new FakeSmokePing({ start: createClock().time });
  smokeping.dataMissing = true;
  const world = await createWorld({ smokeping });
  t.after(() => world.app.stop());
  assert.equal(world.fake.connectionStatus.message.en, ERROR_TEXT.no_data.en);
  smokeping.dataMissing = false;
  smokeping.status = 401;
  await world.fake.configUpdated(config({ username: 'admin', password: 'wrong' }));
  assert.equal(world.fake.connectionStatus.message.fr, ERROR_TEXT.auth.fr);

  const empty = await createWorld({ config: {} });
  t.after(() => empty.app.stop());
  assert.equal(empty.fake.connectionStatus.connected, false);
  assert.match(empty.fake.connectionStatus.message.en, /Enter the address/);
});

test('"Test the connection": the report in four languages, or the reason in red', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const ok = await world.fake.action('test_connection');
  assert.equal(ok.success, true, ok.error);
  assert.equal(
    ok.data.message.en,
    'SmokePing: Connected, 4 target(s), 1 unreachable, a measurement every 60 s',
  );
  assert.match(ok.data.message.fr, /^SmokePing : Connecté, 4 cible\(s\)/);
  world.smokeping.down = true;
  const failed = await world.fake.action('test_connection');
  assert.equal(failed.success, false);
  assert.equal(failed.error.fr, 'SmokePing ne répond pas');
});

test('"State of a target" and "Count the unreachable targets", in the language of the configuration', async (t) => {
  const world = await createWorld({ config: config({ language: 'fr' }) });
  t.after(() => world.app.stop());
  const state = await world.fake.sceneAction('get_target_status', {
    device: idsOf(world, 'Lab.Lossy').device,
  });
  assert.equal(state.success, true, state.error);
  const { jitter, sentence, ...outputs } = state.data.outputs;
  assert.deepEqual(outputs, {
    reachable: true,
    state: 'Joignable',
    name: 'Lossy box',
    group: 'Lab',
    latency: 41,
    packet_loss: 20,
  });
  assert.ok(jitter > 0);
  assert.match(sentence, /^Lossy box : Joignable, 41 ms, 20 % de pertes, gigue 0,\d ms\.$/);
  const unknown = await world.fake.sceneAction('get_target_status', { device: 'other' });
  assert.equal(unknown.success, false);
  assert.equal(unknown.error.fr, "Cet appareil n'est pas une cible SmokePing.");

  const all = await world.fake.sceneAction('count_unreachable_targets', {});
  assert.deepEqual(all.data.outputs, { unreachable: 1, degraded: 1, total: 4, names: 'Dead host' });
  const dns = await world.fake.sceneAction('count_unreachable_targets', { group: 'dns' });
  assert.deepEqual(dns.data.outputs, { unreachable: 0, degraded: 0, total: 2, names: '' });

  world.smokeping.down = true;
  world.clock.advance(MINUTE);
  const failed = await world.fake.sceneAction('count_unreachable_targets', {});
  assert.equal(failed.success, false);
  assert.equal(failed.error.en, 'SmokePing does not answer');
});

test('the camera: a fresh graph on request, the period of the configuration', async (t) => {
  const world = await createWorld({ config: config({ graph_period: '30h' }) });
  t.after(() => world.app.stop());
  await createDevices(world);
  const device = world.fake.discoveredDevices[0];
  const ack = await world.fake.getImage(device);
  assert.equal(ack.success, true, ack.error);
  assert.match(ack.data.image, /^image\/png;base64,/);
  const graph = world.smokeping.calls.findLast((call) => call.url.includes('displaymode=a'));
  const [, start, end] = /start=(\d+);end=(\d+)/.exec(graph.url).map(Number);
  assert.equal(end - start, 30 * 3600);
  world.smokeping.down = true;
  const failed = await world.fake.getImage(device);
  assert.equal(failed.success, false);
});

test('the widget: unreachable and degraded first, with latency and loss; a Refresh button', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await createDevices(world);
  const ack = await world.fake.widgetGet(WIDGET_KEY, { settings: {}, language: 'fr' });
  assert.equal(ack.success, true, ack.error);
  const content = ack.data.content;
  assert.deepEqual(validateWidgetContent(content).errors ?? [], []);
  const [down, degraded, latency, status, button] = content.components;
  assert.equal(down.value, 1);
  assert.equal(degraded.value, 1, '20 % of loss, beyond the 10 % threshold');
  assert.equal(latency.unit, 'ms');
  assert.deepEqual(
    status.items.map((item) => [item.label, item.value]),
    [
      ['Dead host', 'Injoignable'],
      ['Lossy box', '41 ms · 20 % pertes'],
      ['Cloudflare', '15,7 ms · 0 % pertes'],
      ['Google DNS', '13,3 ms · 0 % pertes'],
    ],
  );
  assert.equal(button.action.key, 'refresh');

  const hidden = await world.fake.widgetGet(WIDGET_KEY, {
    settings: { hide_summary: true, hide_refresh: true, group: 'Lab' },
  });
  assert.deepEqual(
    hidden.data.content.components.map((component) => component.type),
    ['status'],
  );
  const chosen = await world.fake.widgetGet(WIDGET_KEY, {
    settings: { targets: [idsOf(world, 'DNS.Google').device] },
  });
  assert.equal(chosen.data.content.components.at(-2).items.length, 1);

  const refreshed = await world.fake.widgetAction(WIDGET_KEY, 'refresh');
  assert.equal(refreshed.success, true, refreshed.error);
  world.smokeping.down = true;
  const failed = await world.fake.widgetAction(WIDGET_KEY, 'refresh');
  assert.equal(failed.success, false);
});

test('the widget says what to do without address', async (t) => {
  const world = await createWorld({ config: {} });
  t.after(() => world.app.stop());
  const ack = await world.fake.widgetGet(WIDGET_KEY, { settings: {}, language: 'de' });
  assert.match(ack.data.content.components[0].text, /Gib die Adresse/);
});

test('a new language renames the devices proposed; Search reads the menu again', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await world.fake.configUpdated(config({ language: 'fr' }));
  assert.equal(world.fake.discoveredDevices[0].features[1].name, 'Latence médiane');
  world.smokeping.menu = world.smokeping.menu.replace('>Lossy box<', '>Box ADSL<');
  await world.fake.scanRequest();
  assert.ok(world.fake.discoveredDevices.some((device) => device.name === 'Box ADSL'));
});

test('Gladys restarted: everything is sent again', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await createDevices(world);
  const sent = world.fake.states.length;
  await world.hub.resync(world.hub.config);
  assert.ok(world.fake.states.length >= sent * 2);
});

async function captureLogs(t, level, fn) {
  const lines = [];
  const write = (chunk) => {
    lines.push(...String(chunk).split('\n').filter(Boolean));
    return true;
  };
  const before = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = level;
  const stdout = t.mock.method(process.stdout, 'write', write);
  const stderr = t.mock.method(process.stderr, 'write', write);
  try {
    await fn();
  } finally {
    stdout.mock.restore();
    stderr.mock.restore();
    process.env.LOG_LEVEL = before;
  }
  return lines;
}

test('a normal reading cycle writes nothing at the info level', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await createDevices(world);
  const sent = world.fake.states.length;
  const lines = await captureLogs(t, 'info', async () => {
    for (let cycle = 0; cycle < 6; cycle += 1) {
      world.smokeping.set('DNS.Google', { medianMs: 13 + cycle });
      await world.step();
    }
  });
  assert.ok(world.fake.states.length > sent, 'states were published');
  assert.deepEqual(lines, []);
});

test('the internal timer reads SmokePing and publishes the changes, without any poll from Gladys', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const world = await createWorld({ timers: true });
  t.after(() => world.app.stop());
  await createDevices(world);
  const reads = world.smokeping.calls.length;
  world.smokeping.set('DNS.Google', { lost: 10 });
  world.clock.advance(MINUTE);
  world.smokeping.measure();
  t.mock.timers.tick(60_000);
  await settle();
  assert.ok(world.smokeping.calls.length > reads);
  assert.equal(world.fake.lastState(idsOf(world, 'DNS.Google').feature('reachable')), 0);
});

// -----------------------------------------------------------------------------
// The SmokePing client: the menu recorded from SmokePing 2.9.0, the address
// normalization, Range reads (and a server that ignores Range), the graph,
// and the errors by kind.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig, parseCgiUrl, parseDataUrl } from '../src/config.js';
import {
  ERROR_KINDS,
  SmokePingClient,
  htmlText,
  measurementOf,
  parseMenu,
} from '../src/smokeping/client.js';
import { CGI, DATA, FakeSmokePing, MENU_HTML, PINGS } from './helpers/fakeSmokePing.js';

const START = Date.UTC(2026, 10, 16, 10, 0, 0);

function client(fake = new FakeSmokePing({ start: START }), extra = {}) {
  return {
    fake,
    client: new SmokePingClient({ url: CGI, dataUrl: DATA, request: fake.request, ...extra }),
  };
}

test('the menu: targets and groups with their labels, never the charts', () => {
  assert.deepEqual(parseMenu(MENU_HTML), [
    { path: 'DNS.Cloudflare', label: 'Cloudflare' },
    { path: 'DNS', label: 'DNS' },
    { path: 'Lab.Dead', label: 'Dead host' },
    { path: 'DNS.Google', label: 'Google DNS' },
    { path: 'Lab', label: 'Lab' },
    { path: 'Lab.Lossy', label: 'Lossy box' },
  ]);
  assert.equal(htmlText('<b>R&amp;D</b> &#233;tage&nbsp;2'), 'R&D étage 2');
  // Links with a path prefix, an unsafe path dropped.
  assert.deepEqual(
    parseMenu(
      '<a href="/cgi-bin/smokeping.cgi?filter=.;target=A.B">x</a><a href="?target=..%2Fetc">y</a>',
    ),
    [{ path: 'A.B', label: 'x' }],
  );
});

test('the addresses: a bare host, the folder of the interface, the CGI itself', () => {
  assert.equal(parseCgiUrl('192.0.2.10:8080'), 'http://192.0.2.10:8080/smokeping/smokeping.cgi');
  assert.equal(parseCgiUrl('http://192.0.2.10/smokeping/'), CGI);
  assert.equal(parseCgiUrl(`${CGI}?target=DNS`), CGI);
  assert.equal(
    parseCgiUrl('https://host.example/cgi-bin/smokeping.cgi'),
    'https://host.example/cgi-bin/smokeping.cgi',
  );
  assert.equal(parseCgiUrl('http://user:pw@192.0.2.10/'), null);
  assert.equal(parseCgiUrl('ftp://192.0.2.10/'), null);
  assert.equal(parseDataUrl('', CGI), DATA);
  assert.equal(parseDataUrl('http://192.0.2.11/rrd', CGI), 'http://192.0.2.11/rrd/');
  const config = normalizeConfig({ url: ' 192.0.2.10 ', loss_threshold: '12,4', rounds: '9' });
  assert.equal(config.url, 'http://192.0.2.10/smokeping/smokeping.cgi');
  assert.equal(config.dataUrl, DATA);
  assert.equal(config.lossThreshold, 12);
  assert.equal(config.rounds, 2);
  assert.equal(normalizeConfig({}).url, '');
  assert.equal(normalizeConfig({ url: 'ftp://x' }).url, null);
});

test('a measurement: loss in percent, median and jitter in milliseconds', () => {
  const row = {
    time: 1794845640,
    values: { loss: 2, median: 0.0415, ping1: 0.04, ping2: 0.041, ping3: 0.042, ping4: null },
  };
  assert.deepEqual(measurementOf(row, 4), {
    time: 1794845640000,
    pings: 4,
    lossPercent: 50,
    medianMs: 41.5,
    jitterMs: 0.82,
  });
  assert.deepEqual(measurementOf({ time: 0, values: { loss: null, median: null } }, 4), {
    time: 0,
    pings: 4,
    lossPercent: null,
    medianMs: null,
    jitterMs: null,
  });
});

test('the newest measurements, read with Range requests', async () => {
  const { fake, client: smokeping } = client();
  const data = await smokeping.read('Lab.Lossy', 3);
  assert.equal(data.step, 60);
  assert.equal(data.measurements.length, 3);
  assert.deepEqual(
    data.measurements.map((m) => [m.lossPercent, m.medianMs]),
    [
      [20, 41],
      [20, 41],
      [20, 41],
    ],
  );
  assert.ok(fake.calls.every((call) => /^bytes=\d+-\d+$/.test(call.headers.range)));
  assert.ok(fake.calls.length <= 3, 'header probe, header, rows');
  // A group has no file.
  assert.equal(await smokeping.read('DNS', 1), null);
  // The header size is remembered: two requests next time.
  fake.calls.length = 0;
  await smokeping.read('Lab.Lossy', 3);
  assert.equal(fake.calls.length, 2);
});

test('a server that ignores Range: the whole file, read once', async () => {
  const fake = new FakeSmokePing({ start: START });
  fake.ranges = false;
  const { client: smokeping } = client(fake);
  const data = await smokeping.read('Lab.Dead', 2);
  assert.deepEqual(
    data.measurements.map((m) => [m.lossPercent, m.medianMs]),
    [
      [100, null],
      [100, null],
    ],
  );
  assert.equal(fake.calls.length, 1);
});

test('the graph is a PNG', async () => {
  const { fake, client: smokeping } = client();
  const png = await smokeping.graph('Lab.Lossy', 100, 200);
  assert.equal(png.readUInt32BE(0), 0x89504e47);
  assert.equal(fake.calls[0].url, `${CGI}?displaymode=a;start=100;end=200;target=Lab.Lossy`);
});

test('the errors, by kind, without the credentials', async () => {
  const fake = new FakeSmokePing({ start: START });
  const { client: smokeping } = client(fake, { username: 'admin', password: 's3cret' });
  await smokeping.menu();
  assert.match(fake.calls[0].headers.authorization, /^Basic /);

  fake.down = true;
  await assert.rejects(smokeping.menu(), { kind: ERROR_KINDS.UNREACHABLE });
  fake.down = false;
  for (const [status, kind] of [
    [401, ERROR_KINDS.AUTH],
    [302, ERROR_KINDS.REDIRECT],
    [404, ERROR_KINDS.NOT_SMOKEPING],
    [500, ERROR_KINDS.HTTP],
  ]) {
    fake.status = status;
    const err = await smokeping.menu().catch((error) => error);
    assert.equal(err.kind, kind, `HTTP ${status}`);
    assert.doesNotMatch(err.message, /s3cret|admin/);
  }
  fake.status = null;
  fake.menu = '<html>Welcome to nginx</html>';
  await assert.rejects(smokeping.menu(), { kind: ERROR_KINDS.NOT_SMOKEPING });
  // An HTML page where an RRD file should be.
  const html = {
    status: 200,
    contentRange: null,
    body: Buffer.from(`<!DOCTYPE html>${'x'.repeat(200)}`),
  };
  const lost = new SmokePingClient({ url: CGI, dataUrl: DATA, request: async () => html });
  await assert.rejects(lost.read('DNS.Google', 1), { kind: ERROR_KINDS.NO_DATA });
  assert.equal(PINGS, 10);
});

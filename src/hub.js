// -----------------------------------------------------------------------------
// The SmokePing hub: the server read on a timer of the container (the
// interval chosen in the configuration); the states of the added devices
// published when they change, the scene events fired on transitions, the
// graphs pushed as camera images, and the views the widget and the scene
// actions read. (Adapted from guim31/gladys-gatus.)
//
// Gladys never polls these devices (should_poll: false): the interval goes up
// to 5 minutes, and the scene events must fire for every target, added to
// Gladys or not — "a target becomes unreachable" spares one scene per device.
//
// Each reading takes the newest measurements of every target from its RRD
// file and goes through the ones made since the last reading, one window of
// `rounds` measurements at a time (src/hub.js walk), so no measurement is
// skipped and a state survives a restart of the integration:
//   - unreachable: every ping lost in the `rounds` newest measurements;
//     reachable again as soon as one ping answers;
//   - loss alert: the loss at or above the threshold in the `rounds` newest
//     measurements, over when the newest one is below it (same for the
//     median latency);
//   - in between, the state stays. A target SmokePing stopped measuring
//     (`stale`) keeps its state and publishes nothing.
// The last state of each target is kept in /data (src/store.js): a target
// that went down while the integration or Gladys restarted is still
// announced, once, and the first sight of a target fires nothing. A scene
// event Gladys refuses (it is restarting) is kept there and sent again.
// -----------------------------------------------------------------------------

import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import { VOLATILE, buildTargetDevice, parseTargetId, targetIds, targetValues } from './devices.js';
import { ERROR_KINDS, SmokePingClient, SmokePingError } from './smokeping/client.js';
import { hostOf, normalizeConfig } from './config.js';
import { ProblemLog } from './problems.js';
import {
  ACTION_TEXT,
  ActionFailure,
  CONNECTION_TEXT,
  ERROR_TEXT,
  REPORT_TEXT,
  labelled,
} from './texts.js';

const logger = createLogger({ name: 'smokeping-hub' });

export const WIDGET_KEY = 'smokeping';

// Scene trigger keys (manifest `scene_triggers`): permanent once published.
export const TRIGGERS = Object.freeze({
  UNREACHABLE: 'target_unreachable',
  REACHABLE: 'target_reachable',
  LOSS_HIGH: 'packet_loss_high',
  LATENCY_HIGH: 'latency_high',
});

export const HUB_TIMINGS = {
  // The measurements change at every SmokePing step: published at most this
  // often per target (a change of state publishes them at once), so a
  // hundred targets stay far below the 300 states per minute of Gladys.
  volatileEveryMs: 5 * 60_000,
  // The menu (the list of targets) is read again this often.
  menuEveryMs: 10 * 60_000,
  // A graph is pushed to the camera of an added device this often: SmokePing
  // draws it on each request, a closer pace would only load it.
  imageEveryMs: 5 * 60_000,
  // An unchanged value is sent again this often: Gladys shows "no recent
  // value" after 48 hours.
  heartbeatMs: 12 * 3600_000,
  // A scene action reads SmokePing again when the last read is older.
  freshMs: 30_000,
};

const MAX_TRANSPORTS_PER_REQUEST = 100;
const READ_CONCURRENCY = 4;
// Measurements read per target, at most (a 5-minute interval on a 1-minute step).
const MAX_ROWS = 20;
const MAX_PENDING_EVENTS = 100;
const PENDING_EVENT_MS = 3600_000;
// The whole string, prefix included (SDK MAX_CAMERA_IMAGE_SIZE).
export const MAX_CAMERA_IMAGE = 150 * 1024;
export const CAMERA_PREFIX = 'image/png;base64,';

/**
 * The state of a target from its newest measurements (oldest first).
 * @param {object[]} rows the `rounds` newest measurements
 * @param {object} config { rounds, lossThreshold, latencyThreshold }
 * @param {object} [previous] { state, lossHigh, latencyHigh } before this read
 * @returns {{ state: 'up'|'down'|'unknown', lossHigh: boolean, latencyHigh: boolean }}
 */
export function evaluate(rows, config, previous = {}) {
  const kept = {
    state: previous.state ?? 'unknown',
    lossHigh: previous.lossHigh ?? false,
    latencyHigh: previous.latencyHigh ?? false,
  };
  const last = rows.at(-1);
  if (!last || last.lossPercent === null) {
    return kept; // SmokePing did not measure: nothing to say
  }
  const full = rows.length >= config.rounds && rows.every((row) => row.lossPercent !== null);
  if (last.lossPercent >= 100) {
    if (full && rows.every((row) => row.lossPercent >= 100)) {
      // Unreachable says it all: the loss and latency alerts end without event.
      return { state: 'down', lossHigh: false, latencyHigh: false };
    }
    return kept;
  }
  const lossHigh =
    full && rows.every((row) => row.lossPercent >= config.lossThreshold)
      ? true
      : last.lossPercent < config.lossThreshold
        ? false
        : kept.lossHigh;
  const latencyHigh =
    full && rows.every((row) => row.medianMs !== null && row.medianMs >= config.latencyThreshold)
      ? true
      : last.medianMs !== null && last.medianMs < config.latencyThreshold
        ? false
        : kept.latencyHigh;
  return { state: 'up', lossHigh, latencyHigh };
}

/**
 * Device names: the menu label of SmokePing, prefixed by its group when two
 * targets share it ("DNS Probes · Google DNS 1").
 */
export function nameTargets(targets) {
  const counts = new Map();
  for (const target of targets) {
    counts.set(target.label, (counts.get(target.label) ?? 0) + 1);
  }
  for (const target of targets) {
    target.name =
      counts.get(target.label) > 1 && target.group
        ? `${target.group} · ${target.label}`.slice(0, 255)
        : target.label;
  }
  return targets;
}

export class SmokePingHub {
  /**
   * @param {object} options
   * @param {object} options.gladys GladysIntegration (or the SDK's fake Gladys)
   * @param {object} options.store persistence (src/store.js)
   * @param {Function} [options.request] HTTP seam (src/smokeping/client.js)
   * @param {boolean} [options.timers] the reading timer (off in tests)
   * @param {object} [options.timings] HUB_TIMINGS overrides
   * @param {() => number} [options.now]
   */
  constructor({ gladys, store, request, timers = true, timings, now }) {
    this.gladys = gladys;
    this.store = store;
    this.request = request;
    this.timersEnabled = timers;
    this.timings = { ...HUB_TIMINGS, ...timings };
    this.now = now ?? (() => Date.now());
    // Defaults until start(): a handler reached after a failed start still
    // answers with a readable message.
    this.config = normalizeConfig({});
    this.client = null;
    this.signature = null;
    /** @type {Map<string, object>} targets of the last read, by path */
    this.targets = new Map();
    this.menu = null;
    this.menuAt = 0;
    /** Menu entries without RRD file (groups), skipped until the next menu. */
    this.noFile = new Set();
    this.readAt = 0;
    this.error = null;
    this.polling = null;
    /** When the volatile features of a target were last published, by path. */
    this.volatileAt = new Map();
    /** When the graph of an added device was last pushed, by path. */
    this.imageAt = new Map();
    this.transports = new Map();
    this.connection = null;
    this.discovered = null;
    this.saved = { targets: {} };
    this.pollTimer = null;
    this.stopped = false;
    // What fails again at every cycle (Gladys refusing, the reading loop):
    // one line when it starts, one when it ends.
    this.problems = new ProblemLog(logger);
  }

  // --- Lifecycle -------------------------------------------------------------

  async start(config) {
    const saved = await this.store.load();
    const targets = saved.targets && typeof saved.targets === 'object' ? saved.targets : {};
    const pending = Array.isArray(saved.pending) ? saved.pending : [];
    this.saved = { targets, pending };
    await this.reconfigure(config);
  }

  /** Gladys reconnected (it restarted): send everything again. */
  async resync(config) {
    this.gladys.forgetPublishedStates?.();
    this.volatileAt.clear();
    this.imageAt.clear();
    this.transports.clear();
    this.connection = null;
    this.discovered = null;
    await this.reconfigure(config);
  }

  async reconfigure(config) {
    const previous = this.config;
    this.config = config;
    const signature = JSON.stringify([
      config.url,
      config.dataUrl,
      config.username,
      config.password,
    ]);
    if (signature !== this.signature) {
      if (this.signature !== null && JSON.parse(this.signature)[0] !== config.url) {
        // Another SmokePing: the states saved for the previous one mean nothing.
        this.saved = { targets: {}, pending: [] };
        this.store.save(this.saved);
      }
      this.signature = signature;
      this.client =
        config.url && config.dataUrl
          ? new SmokePingClient({
              url: config.url,
              dataUrl: config.dataUrl,
              username: config.username,
              password: config.password,
              request: this.request,
            })
          : null;
      this.targets = new Map();
      this.menu = null;
      this.menuAt = 0;
      this.noFile = new Set();
      this.readAt = 0;
      this.error = null;
      this.polling = null;
    }
    if (previous.language !== config.language) {
      this.discovered = null; // new names for the Discovery tab
    }
    if (previous.graphPeriod !== config.graphPeriod) {
      this.imageAt.clear();
    }
    try {
      if (this.client) {
        await this.pollNow({ publish: true });
      } else {
        await this.afterChanges(true, { publish: true });
      }
    } finally {
      this.schedulePoll();
    }
  }

  async stop() {
    this.stopped = true;
    clearTimeout(this.pollTimer);
    await this.store.flush();
  }

  /** The next read by the timer, after `delayMs` (the refresh interval by default). */
  schedulePoll(delayMs = this.config.pollIntervalMs) {
    clearTimeout(this.pollTimer);
    if (!this.timersEnabled || this.stopped || !this.client) {
      return;
    }
    this.pollTimer = setTimeout(async () => {
      try {
        await this.pollNow();
        this.problems.recover('poll', 'Reading SmokePing works again');
      } catch (err) {
        this.problems.fail('poll', `Poll failed: ${err.message}`, 'error');
      }
      this.schedulePoll();
    }, delayMs);
  }

  // --- Reading SmokePing ---------------------------------------------------------

  /** Read the server now, publish what changed, push the graphs due. */
  async pollNow({ publish = false, menu = false } = {}) {
    if (menu) {
      this.menuAt = 0;
    }
    const changed = await this.poll();
    await this.afterChanges(changed, { publish });
    await this.publishImages();
  }

  /** Read again when the last read is older than `freshMs` (scene actions). */
  async refreshIfStale() {
    if (this.client && this.now() - this.readAt >= this.timings.freshMs) {
      await this.pollNow();
    }
  }

  /**
   * Read the server and apply what changed. Concurrent calls share the read.
   * @returns {Promise<boolean>} whether the widget shows something new
   */
  poll() {
    if (!this.client) {
      return Promise.resolve(false);
    }
    if (!this.polling) {
      const polling = this.read(this.client).finally(() => {
        // A read of a previous client must not drop the promise of the current one.
        if (this.polling === polling) {
          this.polling = null;
        }
      });
      this.polling = polling;
    }
    return this.polling;
  }

  async read(client) {
    let result;
    try {
      result = await this.readTargets(client);
    } catch (err) {
      if (!(err instanceof SmokePingError)) {
        throw err;
      }
      return client === this.client && this.applyFailure(err);
    }
    if (client !== this.client) {
      return false;
    }
    return this.applySuccess(result);
  }

  /**
   * Rows read per target: the measurements of the alert window, plus the
   * ones SmokePing may have made since the last reading (at its shortest
   * step, 1 minute), so that no measurement is skipped between two readings.
   */
  rowsToRead() {
    return Math.min(
      MAX_ROWS,
      this.config.rounds + Math.ceil(this.config.pollIntervalMs / 60_000) + 1,
    );
  }

  /**
   * The menu when due, then the newest measurements of every target.
   * @returns {Promise<{ readings: object[], failed: Set<string> }>} one reading per
   *   target with an RRD file, and the paths that could not be read
   * @throws {SmokePingError} when the server cannot be read at all
   */
  async readTargets(client) {
    if (!this.menu || this.now() - this.menuAt >= this.timings.menuEveryMs) {
      this.menu = await client.menu();
      this.menuAt = this.now();
      this.noFile = new Set();
    }
    const labels = new Map(this.menu.map((entry) => [entry.path, entry.label]));
    const queue = this.menu.filter((entry) => !this.noFile.has(entry.path));
    const count = this.rowsToRead();
    const readings = [];
    const failures = [];
    const worker = async () => {
      for (let entry = queue.shift(); entry; entry = queue.shift()) {
        try {
          const data = await client.read(entry.path, count);
          if (!data) {
            this.noFile.add(entry.path);
            continue;
          }
          const parent = entry.path.split('.').slice(0, -1).join('.');
          readings.push({
            path: entry.path,
            label: entry.label,
            group: parent ? (labels.get(parent) ?? parent) : '',
            ...data,
          });
        } catch (err) {
          if (!(err instanceof SmokePingError)) {
            throw err;
          }
          failures.push({ path: entry.path, err });
        }
      }
    };
    await Promise.all(Array.from({ length: READ_CONCURRENCY }, worker));
    if (readings.length === 0 && failures.length > 0) {
      throw failures[0].err;
    }
    if (readings.length === 0 && this.menu.length > 0) {
      // Entries in the menu, none with a file: the files are not served.
      throw new SmokePingError(ERROR_KINDS.NO_DATA, 'No RRD file at the data address');
    }
    if (failures.length > 0) {
      const [{ path, err }] = failures;
      this.problems.fail(
        'targets',
        `${failures.length} target(s) not read: ${path}: ${err.message}`,
      );
    } else {
      this.problems.recover('targets', 'Every target read again');
    }
    // Menu order, whatever the order of the answers.
    const order = new Map(this.menu.map((entry, index) => [entry.path, index]));
    return {
      readings: readings.sort((a, b) => order.get(a.path) - order.get(b.path)),
      failed: new Set(failures.map(({ path }) => path)),
    };
  }

  async applySuccess({ readings, failed = new Set() }) {
    let widgetChanged = this.error !== null || this.readAt === 0;
    if (this.error) {
      logger.info('SmokePing answers again');
    }
    if (this.readAt === 0) {
      logger.info(`SmokePing (${hostOf(this.config.url)}): ${readings.length} target(s)`);
    }
    this.error = null;
    this.readAt = this.now();

    // Everything below up to the events is synchronous: a concurrent read
    // (a new configuration) cannot interleave with it.
    const now = this.now();
    const next = new Map();
    const changed = new Set();
    const events = [];
    let dirty = false;
    for (const reading of nameTargets(readings)) {
      const previous = this.targets.get(reading.path);
      const stale = now - reading.lastUpdate > 3 * reading.step * 1000 + this.config.pollIntervalMs;
      const rows = reading.measurements;
      const target = {
        path: reading.path,
        label: reading.label,
        name: reading.name,
        group: reading.group,
        step: reading.step,
        lastUpdate: reading.lastUpdate,
        measurements: rows,
        latest: rows.at(-1) ?? null,
        stale,
        state: previous?.state ?? this.saved.targets[reading.path]?.state ?? 'unknown',
        lossHigh: previous?.lossHigh ?? this.saved.targets[reading.path]?.lossHigh ?? false,
        latencyHigh:
          previous?.latencyHigh ?? this.saved.targets[reading.path]?.latencyHigh ?? false,
      };
      // Where the last reading stopped, kept across a stale reading.
      target.walkedTo = previous?.walkedTo ?? null;
      if (!stale) {
        dirty = this.walk(target, previous, events) || dirty;
      }
      next.set(target.path, target);
      if (
        !previous ||
        ['state', 'lossHigh', 'latencyHigh', 'stale', 'name', 'lastUpdate'].some(
          (key) => previous[key] !== target[key],
        )
      ) {
        widgetChanged = true;
      }
      if (
        previous &&
        ['state', 'lossHigh', 'latencyHigh', 'stale'].some((key) => previous[key] !== target[key])
      ) {
        changed.add(target.path);
      }
    }
    // A target that could not be read this time stays, without measurement.
    for (const path of failed) {
      const previous = this.targets.get(path);
      if (previous) {
        next.set(path, { ...previous, stale: true });
        widgetChanged = widgetChanged || !previous.stale;
      }
    }
    if ([...this.targets.keys()].some((path) => !next.has(path))) {
      widgetChanged = true; // a target removed from the SmokePing configuration
    }
    this.targets = next;
    // A target gone from the menu is forgotten (a group has no file either);
    // never on an empty menu, more likely a glitch than every target removed.
    const inMenu = new Set(this.menu.map((entry) => entry.path));
    if (inMenu.size > 0) {
      for (const path of Object.keys(this.saved.targets)) {
        if (!inMenu.has(path)) {
          delete this.saved.targets[path];
          dirty = true;
        }
      }
    }
    dirty = (await this.fireAll(events)) || dirty;
    // Written only when something changed: no wear of the SD card at every read.
    if (dirty) {
      this.store.save(this.saved);
    }
    await this.publishStates({ changed });
    return widgetChanged;
  }

  applyFailure(err) {
    const wasError = this.error?.kind;
    this.error = { kind: err.kind, message: err.message };
    this.readAt = this.now();
    if (wasError !== err.kind) {
      logger.warn(`SmokePing: ${err.message}`);
    }
    return wasError !== err.kind;
  }

  /**
   * Go through the measurements made since the last reading (only the
   * newest one at the first sight of a target, or after a restart), one alert
   * window at a time: no measurement is skipped, whatever the refresh
   * interval. Updates the state of `target` and queues the scene events.
   * @returns {boolean} whether the saved state changed
   */
  walk(target, previous, events) {
    const rows = target.measurements;
    const seen = previous?.walkedTo ?? null;
    let first = rows.length - 1;
    if (seen !== null) {
      first = rows.findIndex((row) => row.time > seen);
      if (first === -1) {
        target.walkedTo = seen;
        return false; // no new measurement
      }
    }
    let dirty = false;
    for (let k = Math.max(0, first); k < rows.length; k += 1) {
      const window = rows.slice(Math.max(0, k - this.config.rounds + 1), k + 1);
      Object.assign(target, evaluate(window, this.config, target));
      dirty = this.transition(target, window, events) || dirty;
    }
    target.walkedTo = rows.at(-1)?.time ?? seen;
    return dirty;
  }

  /**
   * Compare a target with its last saved state; queue the scene events.
   * @param {object} target with its new state and alerts
   * @param {object[]} window the measurements of the alert window, the newest last
   * @param {Array} events where the events to fire are pushed
   * @returns {boolean} whether the saved state changed
   */
  transition(target, window, events) {
    const previous = this.saved.targets[target.path];
    const { state, lossHigh, latencyHigh } = target;
    const row = window.at(-1);
    if (state === 'unknown') {
      return false;
    }
    if (
      previous?.state === state &&
      previous.lossHigh === lossHigh &&
      previous.latencyHigh === latencyHigh
    ) {
      return false;
    }
    const now = this.now();
    let since = previous?.since ?? now;
    if (previous?.state !== state) {
      // An outage starts at its first measurement with every ping lost.
      since = Math.min(now, (state === 'down' ? window[0]?.time : row?.time) ?? now);
    }
    this.saved.targets[target.path] = { state, since, lossHigh, latencyHigh };
    if (!previous) {
      return true; // first sight: no event
    }
    const data = (extra = {}) => ({
      device: targetIds(this.gladys, target.path).device,
      target: target.name,
      group: target.group,
      ...extra,
    });
    if (previous.state !== state && state === 'down') {
      logger.info(`${target.name} is unreachable`);
      events.push([TRIGGERS.UNREACHABLE, data()]);
    } else if (previous.state === 'down' && state === 'up') {
      const minutes = Math.max(0, Math.round(((row?.time ?? now) - previous.since) / 60_000));
      logger.info(`${target.name} is reachable again after ${minutes} min`);
      events.push([TRIGGERS.REACHABLE, data({ downtime_minutes: minutes })]);
    }
    if (lossHigh && previous.lossHigh === false) {
      logger.info(`${target.name}: packet loss ${row.lossPercent} %`);
      events.push([TRIGGERS.LOSS_HIGH, data({ packet_loss: row.lossPercent })]);
    }
    if (latencyHigh && previous.latencyHigh === false) {
      logger.info(`${target.name}: median latency ${row.medianMs} ms`);
      events.push([TRIGGERS.LATENCY_HIGH, data({ latency: row.medianMs })]);
    }
    return true;
  }

  /**
   * Fire the new scene events after the ones Gladys refused before (kept in
   * /data with the states, so that a transition saved is never lost).
   * @returns {Promise<boolean>} whether the list kept in /data changed
   */
  async fireAll(events) {
    // An event Gladys still refuses after an hour is dropped: late, it would
    // mislead (an outage long over), and a removed trigger would be retried forever.
    const now = this.now();
    const kept = (this.saved.pending ?? []).filter(
      ([, , at]) => Number.isFinite(at) && now - at < PENDING_EVENT_MS,
    );
    const queue = [...kept, ...events.map(([key, data]) => [key, data, now])];
    const before = JSON.stringify(this.saved.pending ?? []);
    if (queue.length === 0) {
      this.saved.pending = [];
      return before !== '[]';
    }
    const refused = [];
    for (const [key, data, at] of queue) {
      try {
        await this.gladys.publishSceneEvent(key, data);
      } catch (err) {
        refused.push([key, data, at]);
        this.problems.fail('event', `Scene event ${key} refused, kept for later: ${err.message}`);
      }
    }
    if (refused.length === 0) {
      this.problems.recover('event', 'Scene events accepted again');
    }
    // At most a hundred kept: an hour of outage of Gladys is not a backlog.
    this.saved.pending = refused.slice(-MAX_PENDING_EVENTS);
    return JSON.stringify(this.saved.pending) !== before;
  }

  // --- Publishing to Gladys ----------------------------------------------------

  isCreated(externalId) {
    return (this.gladys.devices ?? []).some((device) => device.external_id === externalId);
  }

  /** The name given in Gladys, else the SmokePing one. */
  displayName(target) {
    const externalId = targetIds(this.gladys, target.path).device;
    const device = (this.gladys.devices ?? []).find((each) => each.external_id === externalId);
    return device?.name || target.name;
  }

  list() {
    return [...this.targets.values()];
  }

  discoveredDevices() {
    const language = this.config.language;
    if (!this.client || this.readAt === 0 || this.error) {
      return null; // nothing read: keep the list Gladys has
    }
    return this.list().map((target) => buildTargetDevice(this.gladys, target, language));
  }

  /** Publish the Discovery list when it changed (a target added, renamed…). */
  async publishDevices({ force = false } = {}) {
    const devices = this.discoveredDevices() ?? (this.client ? null : []);
    if (devices === null) {
      return;
    }
    const key = JSON.stringify(devices);
    if (!force && key === this.discovered) {
      return;
    }
    try {
      await this.gladys.publishDiscoveredDevices(devices);
      this.discovered = key;
      this.problems.recover('discovered', 'Discovered devices accepted again');
    } catch (err) {
      this.problems.fail('discovered', `Discovered devices refused: ${err.message}`);
    }
  }

  /** "Search" in the Discovery tab: read the menu and the targets again. */
  async rediscover() {
    this.menuAt = 0;
    await this.poll();
    await this.afterChanges(true, { publish: true });
  }

  /**
   * The user added (or updated) a device: its states sent before were dropped
   * by Gladys, and its camera waits for a first graph.
   */
  async onDeviceCreated(device) {
    const path = parseTargetId(this.gladys, device.external_id);
    if (path) {
      this.volatileAt.delete(path);
      this.imageAt.delete(path);
    }
    this.transports.delete(device.external_id);
    // The SDK forgets what it sent for this device: everything goes again.
    await this.publishStates({ changed: new Set(path ? [path] : []) });
    await this.publishTransports();
    await this.publishImages();
    this.gladys.requestWidgetRefresh(WIDGET_KEY);
  }

  /** Gladys asks for a refresh (onPoll, only if it polls anyway). */
  async pollDevice() {
    await this.pollNow();
  }

  /**
   * The states of the added devices. The SDK skips the values Gladys already
   * has (and sends an unchanged one again after `heartbeatMs`).
   * @param {{ changed?: Set<string> }} options targets whose volatile features go now
   */
  async publishStates({ changed = new Set() } = {}) {
    if (this.readAt === 0 || this.error) {
      return;
    }
    const now = this.now();
    const states = [];
    let index = -1;
    for (const target of this.targets.values()) {
      index += 1;
      if (!this.isCreated(targetIds(this.gladys, target.path).device)) {
        continue; // Gladys drops the states of a device not added
      }
      const volatileDue =
        changed.has(target.path) ||
        !this.volatileAt.has(target.path) ||
        now - this.volatileAt.get(target.path) >= this.timings.volatileEveryMs;
      if (volatileDue) {
        // Spread over the period: a fifth of the targets come due each time.
        const spread = this.volatileAt.has(target.path)
          ? 0
          : ((index % 5) * this.timings.volatileEveryMs) / 5;
        this.volatileAt.set(target.path, now - spread);
      }
      for (const { key, ...state } of targetValues(this.gladys, target, this.config.language)) {
        if (volatileDue || !VOLATILE.has(key)) {
          states.push(state);
        }
      }
    }
    if (states.length === 0) {
      return;
    }
    try {
      await this.gladys.publishChangedStates(states, { heartbeat: this.timings.heartbeatMs });
      this.problems.recover('states', 'States accepted again');
    } catch (err) {
      this.problems.fail('states', `States refused: ${err.message}`);
    }
  }

  /** The graph of a target, as Gladys takes a camera image. */
  async graphImage(path) {
    const end = Math.floor(this.now() / 1000);
    const png = await this.client.graph(path, end - this.config.graphPeriod, end);
    const image = `${CAMERA_PREFIX}${png.toString('base64')}`;
    if (image.length > MAX_CAMERA_IMAGE) {
      throw new SmokePingError(
        ERROR_KINDS.HTTP,
        `Graph too large for Gladys (${png.length} bytes): reduce the graph width`,
      );
    }
    return image;
  }

  /** Push the graphs due to the cameras of the added devices, one at a time. */
  async publishImages() {
    if (!this.client || this.readAt === 0 || this.error) {
      return;
    }
    const now = this.now();
    for (const target of this.targets.values()) {
      const externalId = targetIds(this.gladys, target.path).device;
      const last = this.imageAt.get(target.path);
      if (!this.isCreated(externalId) || (last && now - last < this.timings.imageEveryMs)) {
        continue;
      }
      this.imageAt.set(target.path, now);
      try {
        await this.gladys.publishCameraImage(externalId, await this.graphImage(target.path));
        this.problems.recover('graph', 'Graphs published again');
      } catch (err) {
        this.problems.fail('graph', `Graph of ${target.path} not published: ${err.message}`);
      }
    }
  }

  /** onGetImage: a fresh graph of a device (dashboard camera, chat). */
  async imageFor(externalId) {
    const path = parseTargetId(this.gladys, externalId);
    if (!path || !this.client) {
      throw new ActionFailure(ACTION_TEXT.unknownTarget);
    }
    try {
      return await this.graphImage(path);
    } catch (err) {
      logger.warn(`Graph of ${path}: ${err.message}`);
      throw new ActionFailure(ACTION_TEXT.noGraph);
    }
  }

  async afterChanges(widgetChanged, { publish = false } = {}) {
    await this.publishDevices({ force: publish });
    await this.publishTransports();
    await this.publishConnectionStatus();
    if (widgetChanged) {
      this.gladys.requestWidgetRefresh(WIDGET_KEY);
    }
  }

  /** The badge of the added devices: local, or unreachable. */
  async publishTransports() {
    if (!this.client || this.readAt === 0) {
      return;
    }
    const entries = [];
    for (const target of this.targets.values()) {
      const externalId = targetIds(this.gladys, target.path).device;
      // SmokePing down, or no longer measuring this target.
      const transport =
        this.error || target.stale ? DEVICE_TRANSPORTS.UNREACHABLE : DEVICE_TRANSPORTS.LOCAL;
      if (this.isCreated(externalId) && this.transports.get(externalId) !== transport) {
        entries.push({ external_id: externalId, transport });
      }
    }
    for (let at = 0; at < entries.length; at += MAX_TRANSPORTS_PER_REQUEST) {
      const batch = entries.slice(at, at + MAX_TRANSPORTS_PER_REQUEST);
      try {
        await this.gladys.publishTransports(batch);
        for (const entry of batch) {
          this.transports.set(entry.external_id, entry.transport);
        }
        this.problems.recover('transports', 'Transports accepted again');
      } catch (err) {
        this.problems.fail('transports', `Transports refused: ${err.message}`);
      }
    }
  }

  /** The status under the integration name. */
  connectionStatus() {
    if (this.config.url === '') {
      return { connected: false, message: CONNECTION_TEXT.noUrl };
    }
    if (!this.config.url || !this.config.dataUrl) {
      return { connected: false, message: CONNECTION_TEXT.invalidUrl };
    }
    if (this.error) {
      return { connected: false, message: ERROR_TEXT[this.error.kind] };
    }
    return { connected: true };
  }

  async publishConnectionStatus() {
    const status = this.connectionStatus();
    const key = JSON.stringify(status);
    if (key === this.connection) {
      return;
    }
    try {
      await this.gladys.setConnectionStatus(status.connected, status.message);
      this.connection = key;
      this.problems.recover('connection', 'Connection status accepted again');
    } catch (err) {
      this.problems.fail('connection', `Connection status refused: ${err.message}`);
    }
  }

  // --- Views and commands (widget, scene actions, report) ----------------------

  /** The target of a device external id, null when unknown. */
  find(externalId) {
    const path = parseTargetId(this.gladys, externalId);
    return (path && this.targets.get(path)) || null;
  }

  /** Throws the reason SmokePing cannot be read, if any. */
  assertReadable() {
    const status = this.connectionStatus();
    if (!status.connected) {
      throw new ActionFailure(status.message);
    }
  }

  /** "Test the connection": read the menu and every target now, one line. */
  async testConnection() {
    await this.pollNow({ publish: true, menu: true });
    this.assertReadable();
    const targets = this.list();
    const down = targets.filter((target) => target.state === 'down').length;
    const message = {};
    for (const [language, text] of Object.entries(REPORT_TEXT)) {
      const parts = [text.ok, text.targets(targets.length)];
      if (down > 0) {
        parts.push(text.down(down));
      }
      if (targets[0]) {
        parts.push(text.step(targets[0].step));
      }
      message[language] = labelled('SmokePing', parts.join(', '), language);
    }
    logger.info(`Connection tested: ${targets.length} target(s)`);
    return message;
  }
}

export { ERROR_KINDS };

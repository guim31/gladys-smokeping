// -----------------------------------------------------------------------------
// A complete test world: the SDK's fake Gladys, a fake SmokePing, a temporary
// /data and a manual clock, with the integration wired on top through
// registerHandlers. No timer runs: the tests read SmokePing with
// `world.hub.pollNow()`, or `world.step()` (one SmokePing measurement, then a
// reading). (Adapted from guim31/gladys-gatus.)
// -----------------------------------------------------------------------------

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../../src/app.js';
import { targetIds } from '../../src/devices.js';
import { Store } from '../../src/store.js';
import { BASE, CGI, DATA, FakeSmokePing, PINGS, STEP, TARGETS } from './fakeSmokePing.js';

// The integration logs every change; keep the test output readable.
process.env.LOG_LEVEL ??= 'silent';

/** A manual clock, shared by the hub and the tests. */
export function createClock(start = Date.UTC(2026, 10, 16, 10, 0, 0)) {
  const clock = {
    time: start,
    now: () => clock.time,
    advance(ms) {
      clock.time += ms;
    },
  };
  return clock;
}

export async function createWorld({
  clock = createClock(),
  smokeping = new FakeSmokePing({ start: clock.time }),
  config = { url: `${BASE}/smokeping/`, language: 'en', rounds: '1' },
  devices = [],
  connect = true,
  dataDir = mkdtempSync(join(tmpdir(), 'gladys-smokeping-')),
  timings = {},
  timers = false,
} = {}) {
  const gladys = createFakeGladys({ config, devices });
  const app = registerHandlers(gladys, {
    store: new Store(dataDir),
    request: smokeping.request,
    timers,
    timings,
    now: clock.now,
  });
  if (connect) {
    await gladys.connect();
    await app.ready;
  }
  const world = { gladys, fake: gladys.fake, smokeping, app, hub: app.hub, clock, dataDir };
  /** One SmokePing measurement, the clock moved by one step, then a reading. */
  world.step = async (count = 1) => {
    for (let i = 0; i < count; i += 1) {
      clock.advance(STEP * 1000);
      smokeping.measure();
      await app.hub.pollNow();
    }
  };
  return world;
}

/** External ids of the device of a target. */
export const idsOf = (world, path) => targetIds(world.gladys, path);

/** Add discovered devices in Gladys, as the user would (all by default). */
export async function createDevices(world, filter = () => true) {
  for (const device of world.fake.discoveredDevices.filter(filter)) {
    await world.fake.deviceCreated(device);
  }
}

export { BASE, CGI, DATA, FakeSmokePing, PINGS, STEP, TARGETS };

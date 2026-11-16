// -----------------------------------------------------------------------------
// An in-memory SmokePing, behind the `request` seam of src/smokeping/client.js:
// the menu page recorded from SmokePing 2.9.0 (test/fixtures/smokeping), RRD
// files written in the 64-bit layout of rrdtool (checked against a file
// written by the real rrdtool, test/rrd.test.js), Range requests, the graph
// PNG, and the failures the integration must survive.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';

export const BASE = 'http://192.0.2.10';
export const CGI = `${BASE}/smokeping/smokeping.cgi`;
export const DATA = `${BASE}/smokeping-data/`;
export const STEP = 60;
export const PINGS = 10;

export const MENU_HTML = readFileSync(
  new URL('../fixtures/smokeping/menu-filter.html', import.meta.url),
  'utf8',
);

// The targets of the recorded menu (DNS and Lab are groups, without file).
export const TARGETS = ['DNS.Cloudflare', 'DNS.Google', 'Lab.Dead', 'Lab.Lossy'];

// A 1×1 PNG: the client only checks the signature.
export const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const FLOAT_COOKIE = 8.642135e130;

/**
 * An RRD file as SmokePing creates it, in the 64-bit layout: DS uptime, loss,
 * median, ping1..pingN; RRA AVERAGE 1 step × `rowCount`, MAX 12 steps × 5.
 * @param {object} options
 * @param {number} options.lastUpdate epoch seconds
 * @param {{ loss: number|null, median: number|null, pings?: (number|null)[] }[]} options.rows
 *   oldest first, seconds; the last one ends at the step before lastUpdate
 */
export function buildRrd({ step = STEP, lastUpdate, rows, pings = PINGS, rowCount = 20 }) {
  const ds = [
    'uptime',
    'loss',
    'median',
    ...Array.from({ length: pings }, (_, i) => `ping${i + 1}`),
  ];
  const rras = [
    { cf: 'AVERAGE', rows: rowCount, pdp: 1 },
    { cf: 'MAX', rows: 5, pdp: 12 },
  ];
  const statHead = 128;
  const dsDef = 120;
  const rraDef = 120;
  const live = 16;
  const pdpPrep = 112;
  const cdpPrep = 80;
  const header =
    statHead +
    ds.length * dsDef +
    rras.length * rraDef +
    live +
    ds.length * pdpPrep +
    rras.length * ds.length * cdpPrep +
    rras.length * 8;
  const data = rras.reduce((sum, rra) => sum + rra.rows * ds.length * 8, 0);
  const buffer = Buffer.alloc(header + data);
  buffer.write('RRD\0', 0, 'latin1');
  buffer.write('0003\0', 4, 'latin1');
  buffer.writeDoubleLE(FLOAT_COOKIE, 16);
  buffer.writeBigUInt64LE(BigInt(ds.length), 24);
  buffer.writeBigUInt64LE(BigInt(rras.length), 32);
  buffer.writeBigUInt64LE(BigInt(step), 40);
  let at = statHead;
  for (const name of ds) {
    buffer.write(name, at, 'latin1');
    buffer.write('GAUGE', at + 20, 'latin1');
    at += dsDef;
  }
  for (const rra of rras) {
    buffer.write(rra.cf, at, 'latin1');
    buffer.writeBigUInt64LE(BigInt(rra.rows), at + 24);
    buffer.writeBigUInt64LE(BigInt(rra.pdp), at + 32);
    at += rraDef;
  }
  buffer.writeBigInt64LE(BigInt(lastUpdate), at);
  at += live + ds.length * pdpPrep + rras.length * ds.length * cdpPrep;
  // The newest row sits in the middle of the archive, so reads wrap sometimes.
  const kept = rows.slice(-rowCount);
  const currentRow = (kept.length + 7) % rowCount;
  buffer.writeBigUInt64LE(BigInt(currentRow), at);
  buffer.writeBigUInt64LE(0n, at + 8);
  // NaN everywhere: unknown, as rrdtool creates the archives.
  for (let r = header; r < buffer.length; r += 8) {
    buffer.writeDoubleLE(NaN, r);
  }
  kept.forEach((row, i) => {
    const index = (currentRow - (kept.length - 1 - i) + rowCount) % rowCount;
    const base = header + index * ds.length * 8;
    const pingValues = row.pings ?? [];
    const values = [
      null,
      row.loss,
      row.median,
      ...ds.slice(3).map((_, k) => pingValues[k] ?? null),
    ];
    values.forEach((value, k) => buffer.writeDoubleLE(value ?? NaN, base + k * 8));
  });
  return buffer;
}

/** A measurement of `pings` pings: `lost` lost, the others around `medianMs`. */
export function row({ lost = 0, medianMs = 20, spreadMs = 1 } = {}) {
  if (lost >= PINGS) {
    return { loss: PINGS, median: null, pings: [] };
  }
  const received = PINGS - lost;
  const pings = Array.from(
    { length: received },
    (_, i) => (medianMs + (i - (received - 1) / 2) * (spreadMs / received)) / 1000,
  );
  return { loss: lost, median: medianMs / 1000, pings };
}

export class FakeSmokePing {
  /** @param {{ start: number }} options start: epoch ms of the clock */
  constructor({ start }) {
    this.lastUpdate = Math.floor(start / 1000) - 11;
    // What each target measures at every tick.
    this.profiles = new Map([
      ['DNS.Cloudflare', { lost: 0, medianMs: 15.7 }],
      ['DNS.Google', { lost: 0, medianMs: 13.3 }],
      ['Lab.Dead', { lost: PINGS, medianMs: 0 }],
      ['Lab.Lossy', { lost: 2, medianMs: 41 }],
    ]);
    this.rows = new Map(TARGETS.map((path) => [path, []]));
    this.down = false;
    this.status = null; // forced HTTP status of every answer
    this.dataMissing = false; // the RRD files not served
    this.ranges = true; // Range requests honoured
    this.menu = MENU_HTML;
    this.calls = [];
    for (let i = 0; i < 5; i += 1) {
      this.measure(false);
    }
    this.request = this.request.bind(this);
  }

  /** Every target measures once more (its profile); the clock is not moved. */
  measure(advance = true) {
    if (advance) {
      this.lastUpdate += STEP;
    }
    for (const [path, profile] of this.profiles) {
      this.rows.get(path).push(row(profile));
    }
  }

  set(path, profile) {
    this.profiles.set(path, { ...this.profiles.get(path), ...profile });
  }

  file(path) {
    return buildRrd({ lastUpdate: this.lastUpdate, rows: this.rows.get(path) });
  }

  async request(url, { headers = {} } = {}) {
    this.calls.push({ url, headers });
    if (this.down) {
      const err = new TypeError('fetch failed');
      err.cause = { code: 'ECONNREFUSED' };
      throw err;
    }
    if (this.status) {
      return answer(this.status, Buffer.from('nope'));
    }
    if (url === `${CGI}?filter=.`) {
      return answer(200, Buffer.from(this.menu), 'text/html');
    }
    if (url.startsWith(`${CGI}?displaymode=a;`)) {
      return answer(200, PNG, 'image/png');
    }
    if (url.startsWith(DATA)) {
      const path = decodeURIComponent(url.slice(DATA.length).replace(/\.rrd$/, '')).replaceAll(
        '/',
        '.',
      );
      if (this.dataMissing) {
        return answer(404, Buffer.from('<html>Not Found</html>'), 'text/html');
      }
      if (!this.rows.has(path)) {
        return answer(404, Buffer.from('<html>Not Found</html>'), 'text/html');
      }
      const file = this.file(path);
      const range = /^bytes=(\d+)-(\d+)$/.exec(headers.range ?? '');
      if (!range || !this.ranges) {
        return answer(200, file, 'application/octet-stream');
      }
      const start = Number(range[1]);
      const end = Math.min(Number(range[2]), file.length - 1);
      return {
        status: 206,
        contentRange: `bytes ${start}-${end}/${file.length}`,
        contentType: 'application/octet-stream',
        body: file.subarray(start, end + 1),
      };
    }
    return answer(404, Buffer.from('<html>Not Found</html>'), 'text/html');
  }
}

function answer(status, body, contentType = 'text/plain') {
  return { status, contentRange: null, contentType, body };
}

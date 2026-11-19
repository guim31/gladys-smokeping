// -----------------------------------------------------------------------------
// The RRD reader against files written by the real rrdtool of the SmokePing
// 2.9.0 image (x86_64, test/fixtures/smokeping):
//   - small-64bit.rrd: SmokePing's data sources with 3 pings, 10 raw rows,
//     14 updates (the archive wrapped), the last three with every ping lost;
//   - target-header-64bit.bin: the header of a real SmokePing target
//     (10 pings, the 7 archives of the default Database section), 1.7 MB file.
// The fake SmokePing of the tests writes the same layout (buildRrd): checked
// here too.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  RrdFormatError,
  decodeRows,
  headerSize,
  parseHeader,
  rawArchive,
  rowRanges,
} from '../src/smokeping/rrd.js';
import { buildRrd, row } from './helpers/fakeSmokePing.js';

const fixture = (name) => readFileSync(new URL(`./fixtures/smokeping/${name}`, import.meta.url));

function readAll(file, count) {
  const header = parseHeader(file.subarray(0, headerSize(file)), file.length);
  const rra = rawArchive(header);
  const chunks = rowRanges(header, rra, count).map(({ start, end }) => file.subarray(start, end));
  return { header, rra, rows: decodeRows(header, rra, chunks) };
}

test('the header of a real SmokePing target', () => {
  const head = fixture('target-header-64bit.bin');
  assert.equal(headerSize(head.subarray(0, 64)), 11336);
  const header = parseHeader(head, 1688648);
  assert.equal(header.layout, '64-bit');
  assert.equal(header.step, 60);
  assert.deepEqual(header.ds, [
    'uptime',
    'loss',
    'median',
    ...Array.from({ length: 10 }, (_, i) => `ping${i + 1}`),
  ]);
  assert.deepEqual(
    header.rras.map((rra) => [rra.cf, rra.pdpPerRow, rra.rows]),
    [
      ['AVERAGE', 1, 1008],
      ['AVERAGE', 12, 4320],
      ['MIN', 12, 4320],
      ['MAX', 12, 4320],
      ['AVERAGE', 144, 720],
      ['MAX', 144, 720],
      ['MIN', 144, 720],
    ],
  );
  assert.equal(rawArchive(header).offset, 11336);
  // A wrong size means a wrong layout: refused, never misread.
  assert.throws(() => parseHeader(head, 1688640), RrdFormatError);
});

test('the newest rows of a file written by rrdtool, across the end of the archive', () => {
  const { header, rra, rows } = readAll(fixture('small-64bit.rrd'), 6);
  assert.equal(header.lastUpdate, 1794845640);
  assert.equal(rra.currentRow, 5);
  assert.deepEqual(
    rows.map((each) => [each.time, each.values.loss, each.values.median, each.values.ping3]),
    [
      [1794845340, 1, 0.019, 0.0192],
      [1794845400, 0, 0.02, 0.0202],
      [1794845460, 1, 0.021, 0.0212],
      [1794845520, 3, null, null],
      [1794845580, 3, null, null],
      [1794845640, 3, null, null],
    ],
  );
  // Ten rows: the whole archive, two ranges.
  assert.equal(rowRanges(header, rra, 10).length, 2);
});

test('the fake SmokePing writes what rrdtool writes', () => {
  const file = buildRrd({
    lastUpdate: 1794845651,
    rows: [row({ lost: 0, medianMs: 12 }), row({ lost: 10 }), row({ lost: 3, medianMs: 40 })],
  });
  const { header, rows } = readAll(file, 3);
  assert.equal(header.ds.length, 13);
  assert.deepEqual(
    rows.map((each) => [each.time, each.values.loss, each.values.median]),
    [
      [1794845520, 0, 0.012],
      [1794845580, 10, null],
      [1794845640, 3, 0.04],
    ],
  );
});

test('anything else is refused with a clear error', () => {
  assert.throws(() => headerSize(Buffer.from('<html><body>Not Found</body></html>'.repeat(3))), {
    name: 'Error',
    message: 'not an RRD file',
  });
  const bigEndian = Buffer.from(fixture('small-64bit.rrd'));
  bigEndian.writeDoubleBE(8.642135e130, 16);
  assert.throws(() => parseHeader(bigEndian), /byte order/);
  const truncated = fixture('small-64bit.rrd').subarray(0, 900);
  assert.throws(() => parseHeader(truncated), /truncated/);
});

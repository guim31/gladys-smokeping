// -----------------------------------------------------------------------------
// A reader of the RRD files SmokePing writes (one per target), in plain
// JavaScript: no rrdtool in the image, and only the bytes needed are read
// over HTTP (Range requests), never the whole file (1.7 MB for a default
// target).
//
// The format is the in-memory C layout of rrdtool (rrd_format.h), so it
// depends on the machine that wrote the file: the size of `unsigned long` and
// `time_t`, and the alignment of doubles. The layouts below cover 64-bit
// little-endian machines (x86_64, arm64: nearly every SmokePing) and 32-bit
// ARM (Raspberry Pi OS 32-bit); a file whose layout does not check out (the
// float cookie, the names, the row pointers, the total size) is refused rather
// than misread.
//
//   stat_head  cookie "RRD\0", version "0003\0", float_cookie, ds_cnt,
//              rra_cnt, pdp_step, par[10]
//   ds_def     ds_nam[20], dst[20], par[10]              (ds_cnt times)
//   rra_def    cf_nam[20], row_cnt, pdp_cnt, par[10]     (rra_cnt times)
//   live_head  last_up (time_t), last_up_usec (long)
//   pdp_prep   last_ds[30], scratch[10]                  (ds_cnt times)
//   cdp_prep   scratch[10]                               (rra_cnt × ds_cnt)
//   rra_ptr    cur_row                                   (rra_cnt times)
//   data       rra 0 rows, rra 1 rows... ; a row is ds_cnt doubles
// -----------------------------------------------------------------------------

const FLOAT_COOKIE = 8.642135e130;
const UNIVAL = 8; // union of unsigned long and double: 8 bytes everywhere

// `long` and `time_t` sizes; doubles are aligned on 8 bytes in all of them.
export const LAYOUTS = [
  { name: '64-bit', long: 8, time: 8 },
  { name: '32-bit ARM', long: 4, time: 4 },
  { name: '32-bit ARM, 64-bit time', long: 4, time: 8 },
];

export class RrdFormatError extends Error {}

const align = (offset, to) => Math.ceil(offset / to) * to;

function text(buffer, offset, length) {
  const raw = buffer.subarray(offset, offset + length);
  const end = raw.indexOf(0);
  return raw.subarray(0, end === -1 ? raw.length : end).toString('latin1');
}

function readUint(buffer, offset, size) {
  return size === 8 ? Number(buffer.readBigUInt64LE(offset)) : buffer.readUInt32LE(offset);
}

function readInt(buffer, offset, size) {
  return size === 8 ? Number(buffer.readBigInt64LE(offset)) : buffer.readInt32LE(offset);
}

/** Offsets of every part of the header for a layout and counts. */
function offsets(layout, dsCount, rraCount) {
  const { long, time } = layout;
  // stat_head: 9 bytes of cookie and version, the double aligned on 8.
  let at = 16 + 8 + 3 * long;
  at = align(at, 8) + 10 * UNIVAL;
  const statHead = at;
  const dsDef = 40 + 10 * UNIVAL;
  const rraDef = align(20 + 2 * long, 8) + 10 * UNIVAL;
  const dsStart = statHead;
  const rraStart = dsStart + dsCount * dsDef;
  const liveStart = rraStart + rraCount * rraDef;
  const liveSize = align(time + long, Math.max(time, long));
  // Each part is written right after the previous one (sizeof of its
  // struct, no padding between parts).
  const pdpStart = liveStart + liveSize;
  const pdpSize = 32 + 10 * UNIVAL;
  const cdpStart = pdpStart + dsCount * pdpSize;
  const ptrStart = cdpStart + rraCount * dsCount * 10 * UNIVAL;
  const dataStart = ptrStart + rraCount * long;
  return { dsStart, dsDef, rraStart, rraDef, liveStart, ptrStart, dataStart };
}

/**
 * The size of the header for the first bytes of a file (at least 64), so
 * that the next read fetches exactly the header.
 * @param {Buffer} head
 * @returns {number} bytes up to the first data row, for the largest layout
 */
export function headerSize(head) {
  const layout = detectLayout(head);
  const dsCount = readUint(head, 24, layout.long);
  const rraCount = readUint(head, 24 + layout.long, layout.long);
  const candidates = layout === LAYOUTS[0] ? [LAYOUTS[0]] : [LAYOUTS[1], LAYOUTS[2]];
  return Math.max(...candidates.map((each) => offsets(each, dsCount, rraCount).dataStart));
}

function detectLayout(head) {
  if (head.length < 64 || head.toString('latin1', 0, 4) !== 'RRD\0') {
    throw new RrdFormatError('not an RRD file');
  }
  const version = text(head, 4, 5);
  if (!['0001', '0003', '0004'].includes(version)) {
    throw new RrdFormatError(`unsupported RRD version ${version}`);
  }
  if (Math.abs(head.readDoubleLE(16) / FLOAT_COOKIE - 1) > 1e-9) {
    throw new RrdFormatError('RRD file written by an unsupported machine (byte order)');
  }
  // ds_cnt right after the float cookie: 64 bits on a 64-bit machine, where
  // the upper half of a small count is zero.
  const wide = head.readUInt32LE(28) === 0 && head.readUInt32LE(36) === 0;
  return wide ? LAYOUTS[0] : LAYOUTS[1];
}

/**
 * Parse the header of an RRD file.
 * @param {Buffer} buffer at least the header (headerSize)
 * @param {number|null} [totalSize] the size of the whole file, when known:
 *   checks the layout, and picks the 32-bit time variant
 * @returns {{ step: number, lastUpdate: number, ds: string[], rras: object[], dataStart: number, totalSize: number }}
 */
export function parseHeader(buffer, totalSize = null) {
  const first = detectLayout(buffer);
  const candidates = first === LAYOUTS[0] ? [LAYOUTS[0]] : [LAYOUTS[1], LAYOUTS[2]];
  let lastError = null;
  for (const layout of candidates) {
    try {
      return parseWith(buffer, layout, totalSize);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

function parseWith(buffer, layout, totalSize) {
  const { long, time } = layout;
  const dsCount = readUint(buffer, 24, long);
  const rraCount = readUint(buffer, 24 + long, long);
  const step = readUint(buffer, 24 + 2 * long, long);
  if (!(dsCount > 0 && dsCount < 1000 && rraCount > 0 && rraCount < 100 && step > 0)) {
    throw new RrdFormatError('RRD header not understood');
  }
  const at = offsets(layout, dsCount, rraCount);
  if (buffer.length < at.dataStart) {
    throw new RrdFormatError(`RRD header truncated (${buffer.length} < ${at.dataStart} bytes)`);
  }
  const ds = [];
  for (let i = 0; i < dsCount; i += 1) {
    const name = text(buffer, at.dsStart + i * at.dsDef, 20);
    if (!/^[A-Za-z0-9_-]{1,19}$/.test(name)) {
      throw new RrdFormatError('RRD data sources not understood');
    }
    ds.push(name);
  }
  const rras = [];
  let rowOffset = at.dataStart;
  for (let i = 0; i < rraCount; i += 1) {
    const base = at.rraStart + i * at.rraDef;
    const cf = text(buffer, base, 20);
    const rows = readUint(buffer, base + 20 + (long === 8 ? 4 : 0), long);
    const pdpPerRow = readUint(buffer, base + 20 + (long === 8 ? 4 : 0) + long, long);
    const currentRow = readUint(buffer, at.ptrStart + i * long, long);
    if (!/^[A-Z_]{3,19}$/.test(cf) || rows < 1 || pdpPerRow < 1 || currentRow >= rows) {
      throw new RrdFormatError('RRD archives not understood');
    }
    rras.push({ cf, rows, pdpPerRow, currentRow, offset: rowOffset });
    rowOffset += rows * dsCount * 8;
  }
  if (totalSize !== null && totalSize !== rowOffset) {
    throw new RrdFormatError(`RRD size ${totalSize} does not match its header (${rowOffset})`);
  }
  const lastUpdate = readInt(buffer, at.liveStart, time);
  return {
    layout: layout.name,
    step,
    lastUpdate,
    ds,
    rras,
    dataStart: at.dataStart,
    totalSize: rowOffset,
  };
}

/**
 * The archive of the raw measurements: AVERAGE, one step per row (the first
 * one of SmokePing's Database section).
 */
export function rawArchive(header) {
  return (
    header.rras.find((rra) => rra.cf === 'AVERAGE' && rra.pdpPerRow === 1) ??
    header.rras.find((rra) => rra.pdpPerRow === 1) ??
    null
  );
}

/**
 * The byte ranges holding the `count` newest rows of an archive, newest
 * last: one range, or two when the rows wrap around the end of the archive.
 * @returns {{ start: number, end: number, rows: number[] }[]} `end` exclusive
 */
export function rowRanges(header, rra, count) {
  const width = header.ds.length * 8;
  const n = Math.min(count, rra.rows);
  const indexes = [];
  for (let k = n - 1; k >= 0; k -= 1) {
    indexes.push((rra.currentRow - k + rra.rows) % rra.rows);
  }
  const ranges = [];
  for (const index of indexes) {
    const last = ranges.at(-1);
    if (last && last.rows.at(-1) + 1 === index) {
      last.rows.push(index);
      last.end += width;
    } else {
      const start = rra.offset + index * width;
      ranges.push({ start, end: start + width, rows: [index] });
    }
  }
  return ranges;
}

/**
 * Decode rows: an array of `{ time, values: { [ds]: number|null } }`, oldest
 * first. A row ends at `time` (the step boundary); NaN (unknown) is null.
 * @param {object} header
 * @param {object} rra
 * @param {Buffer[]} chunks the bytes of rowRanges(), in the same order
 */
export function decodeRows(header, rra, chunks) {
  const width = header.ds.length * 8;
  const span = header.step * rra.pdpPerRow;
  const newestTime = Math.floor(header.lastUpdate / span) * span;
  const rows = [];
  for (const chunk of chunks) {
    for (let at = 0; at + width <= chunk.length; at += width) {
      const values = {};
      header.ds.forEach((name, i) => {
        const value = chunk.readDoubleLE(at + i * 8);
        values[name] = Number.isFinite(value) ? value : null;
      });
      rows.push({ values });
    }
  }
  rows.forEach((row, i) => {
    row.time = newestTime - (rows.length - 1 - i) * span;
  });
  return rows;
}

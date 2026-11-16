// -----------------------------------------------------------------------------
// SmokePing client. SmokePing has no JSON API (checked on SmokePing 2.9.0,
// image lscr.io/linuxserver/smokeping, test/fixtures/smokeping), so two
// sources are read over HTTP:
//
//   - its web interface (smokeping.cgi):
//       ?filter=.           the menu, flat: one link per target and group
//                           (`?filter=.;target=DNS.Cloudflare`), with the
//                           `menu` label of the configuration
//       ?displaymode=a;start=<epoch>;end=<epoch>;target=<path>
//                           the graph of a target, as a PNG (the "navigator"
//                           graph, legend included): the camera image
//   - its RRD files, one per target (`data/DNS/Cloudflare.rrd`), which the
//     user exposes read-only on the same web server (one Alias line, see the
//     docs): the measurements, read by src/smokeping/rrd.js with Range
//     requests (a few KB per target and reading).
//
// Basic credentials are sent when configured (a SmokePing behind
// htpasswd). Redirects are not followed: the credentials would go wherever
// the address points.
// -----------------------------------------------------------------------------

import {
  RrdFormatError,
  decodeRows,
  headerSize,
  parseHeader,
  rawArchive,
  rowRanges,
} from './rrd.js';

export const ERROR_KINDS = Object.freeze({
  UNREACHABLE: 'unreachable', // no answer: down, wrong address, firewall
  TLS: 'tls', // the certificate does not verify
  AUTH: 'auth', // the server asks for credentials
  REDIRECT: 'redirect', // the address redirects (usually HTTP to HTTPS)
  NOT_SMOKEPING: 'not_smokeping', // something answers, not the SmokePing interface
  NO_DATA: 'no_data', // the RRD files are not served at the data address
  RRD_FORMAT: 'rrd_format', // an RRD file this reader does not understand
  HTTP: 'http', // any other HTTP error
});

export class SmokePingError extends Error {
  /**
   * @param {string} kind one of ERROR_KINDS
   * @param {string} message English, for the logs (never contains a secret)
   */
  constructor(kind, message, extra = {}) {
    super(message);
    this.name = 'SmokePingError';
    this.kind = kind;
    Object.assign(this, extra);
  }
}

const TLS_CODES = new Set([
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'CERT_HAS_EXPIRED',
  'ERR_TLS_CERT_ALTNAME_INVALID',
]);

// A whole RRD file when the server ignores Range (rare): 100 targets of 20
// pings are 1.7 MB each, a larger file is refused.
export const MAX_BODY_BYTES = 16 * 1024 * 1024;
// First bytes read of an RRD file: enough for its counts.
const PROBE_BYTES = 4096;
// Section names of SmokePing: letters, digits, `-`, `_`, `+`.
export const TARGET_PATH = /^[A-Za-z0-9_+-]+(\.[A-Za-z0-9_+-]+)*$/;

/**
 * The one function that talks to the network (fetch). The client takes it
 * as a parameter: the tests replace it with an in-memory SmokePing
 * (test/helpers/fakeSmokePing.js).
 * @returns {Promise<{ status: number, contentRange: string|null, contentType: string, body: Buffer }>}
 */
export async function httpRequest(url, { headers = {}, timeoutMs = 15_000 } = {}) {
  const response = await fetch(url, {
    headers,
    redirect: 'manual',
    signal: AbortSignal.timeout(timeoutMs),
  });
  const length = Number(response.headers.get('content-length') ?? 0);
  if (length > MAX_BODY_BYTES) {
    await response.body?.cancel();
    throw new Error('Response too large');
  }
  // Read by chunks: a chunked answer has no length to check first.
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body ?? []) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      await response.body.cancel().catch(() => {});
      throw new Error('Response too large');
    }
    chunks.push(chunk);
  }
  const body = Buffer.concat(chunks);
  return {
    status: response.status,
    contentRange: response.headers.get('content-range'),
    contentType: response.headers.get('content-type') ?? '',
    body,
  };
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** Plain text of an HTML fragment (the menu labels). */
export function htmlText(html) {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, code) => {
      if (code[0] === '#') {
        const value =
          code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : Number(code.slice(1));
        return Number.isFinite(value) && value > 0 && value < 0x110000
          ? String.fromCodePoint(value)
          : entity;
      }
      return ENTITIES[code.toLowerCase()] ?? entity;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The targets and groups of the menu page (`?filter=.`), in the order of the
 * page, without the charts (`_charts`) nor duplicates.
 * @returns {{ path: string, label: string }[]}
 */
export function parseMenu(html) {
  const entries = [];
  const seen = new Set();
  const link = /<a\b[^>]*href="[^"]*?[?;&]target=([^"&;#]+)[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
  for (const [, rawPath, rawLabel] of html.matchAll(link)) {
    let path;
    try {
      path = decodeURIComponent(rawPath.replace(/&amp;/g, '&'));
    } catch {
      continue;
    }
    if (path.startsWith('_') || !TARGET_PATH.test(path) || seen.has(path)) {
      continue;
    }
    seen.add(path);
    entries.push({ path, label: htmlText(rawLabel).slice(0, 255) || path.split('.').at(-1) });
  }
  return entries;
}

/** The ping round trip times of a row, in seconds, received ones only. */
const pingsOf = (values) =>
  Object.entries(values)
    .filter(([name, value]) => /^ping\d+$/.test(name) && value !== null)
    .map(([, value]) => value);

/**
 * One measurement of SmokePing (a row of its RRD), in the units shown to
 * the user.
 * @returns {{ time: number, pings: number, lossPercent: number|null, medianMs: number|null, jitterMs: number|null }}
 *   time in ms; null when SmokePing did not measure (unknown row)
 */
export function measurementOf(row, pingCount) {
  const { loss, median } = row.values;
  const received = pingsOf(row.values);
  let jitterMs = null;
  if (received.length >= 2) {
    // Standard deviation of the round trip times, as SmokePing's "sd".
    const mean = received.reduce((sum, value) => sum + value, 0) / received.length;
    const variance =
      received.reduce((sum, value) => sum + (value - mean) ** 2, 0) / received.length;
    jitterMs = Math.round(Math.sqrt(variance) * 1e5) / 100;
  }
  return {
    time: row.time * 1000,
    pings: pingCount,
    lossPercent:
      loss === null || pingCount === 0
        ? null
        : Math.round(Math.min(100, Math.max(0, (loss / pingCount) * 100)) * 10) / 10,
    medianMs: median === null ? null : Math.round(median * 1e5) / 100,
    jitterMs,
  };
}

export class SmokePingClient {
  /**
   * @param {object} options
   * @param {string} options.url the CGI, `http(s)://host[:port]/…/smokeping.cgi`
   * @param {string} options.dataUrl the folder of the RRD files, ending with `/`
   * @param {string} [options.username] basic credentials, if the server asks for them
   * @param {string} [options.password]
   * @param {typeof httpRequest} [options.request] test seam
   */
  constructor({ url, dataUrl, username = '', password = '', request = httpRequest }) {
    this.url = url;
    this.dataUrl = dataUrl;
    this.authorization = username
      ? `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`
      : null;
    this.request = request;
    /** @type {Map<string, number>} header size of each RRD file */
    this.headerSizes = new Map();
  }

  async call(url, headers = {}) {
    // The credentials are those of the web interface: never sent to another
    // server holding the RRD files.
    const authorized = this.authorization && new URL(url).origin === new URL(this.url).origin;
    try {
      return await this.request(url, {
        headers: {
          ...(authorized ? { authorization: this.authorization } : {}),
          ...headers,
        },
      });
    } catch (err) {
      const code = err.cause?.code ?? err.code;
      if (TLS_CODES.has(code)) {
        throw new SmokePingError(ERROR_KINDS.TLS, `Certificate refused (${code})`);
      }
      throw new SmokePingError(ERROR_KINDS.UNREACHABLE, code ?? err.name ?? err.message);
    }
  }

  check({ status }, notFoundKind = ERROR_KINDS.NOT_SMOKEPING) {
    if (status === 401 || status === 403) {
      throw new SmokePingError(ERROR_KINDS.AUTH, `Access refused (HTTP ${status})`, { status });
    }
    if (status >= 300 && status < 400) {
      throw new SmokePingError(ERROR_KINDS.REDIRECT, `Redirected (HTTP ${status})`, { status });
    }
    if (status === 404) {
      throw new SmokePingError(notFoundKind, 'Not found (HTTP 404)', { status });
    }
    if (status < 200 || status >= 300) {
      throw new SmokePingError(ERROR_KINDS.HTTP, `Unexpected answer (HTTP ${status})`, {
        status,
      });
    }
  }

  cgi(query) {
    return `${this.url}?${query}`;
  }

  /**
   * Every entry of the menu, targets and groups alike (only the files tell
   * them apart: a group has no RRD file).
   * @returns {Promise<{ path: string, label: string }[]>}
   * @throws {SmokePingError}
   */
  async menu() {
    const response = await this.call(this.cgi('filter=.'), { accept: 'text/html' });
    this.check(response);
    const html = response.body.toString('utf8');
    if (!/smokeping/i.test(html)) {
      throw new SmokePingError(ERROR_KINDS.NOT_SMOKEPING, 'The page is not SmokePing');
    }
    return parseMenu(html);
  }

  rrdUrl(path) {
    return `${this.dataUrl}${path.split('.').map(encodeURIComponent).join('/')}.rrd`;
  }

  /** Bytes [start, end) of a file; the whole file when Range is ignored. */
  async range(url, start, end) {
    const response = await this.call(url, { range: `bytes=${start}-${end - 1}` });
    if (response.status === 404) {
      return { missing: true };
    }
    if (response.status === 416) {
      throw new SmokePingError(ERROR_KINDS.RRD_FORMAT, 'RRD file shorter than its header');
    }
    this.check(response, ERROR_KINDS.NO_DATA);
    if (response.status === 206) {
      const total = Number(/\/(\d+)\s*$/.exec(response.contentRange ?? '')?.[1]);
      return { body: response.body, total: Number.isFinite(total) ? total : null };
    }
    // 200: the whole file.
    return {
      body: response.body.subarray(start, end),
      total: response.body.length,
      whole: response.body,
    };
  }

  /**
   * The `count` newest measurements of a target, oldest first, with the
   * step of SmokePing. Null when the target has no RRD file (a group, or a
   * target SmokePing has not measured yet).
   * @returns {Promise<{ step: number, lastUpdate: number, measurements: object[] }|null>}
   * @throws {SmokePingError}
   */
  async read(path, count = 1) {
    const url = this.rrdUrl(path);
    let size = this.headerSizes.get(path) ?? PROBE_BYTES;
    let part = await this.range(url, 0, size);
    if (part.missing) {
      return null;
    }
    let header;
    try {
      const needed = headerSize(part.body);
      if (part.body.length < needed) {
        part = part.whole ? part : await this.range(url, 0, needed);
        if (part.missing) {
          return null;
        }
      }
      size = needed;
      header = parseHeader(part.whole ?? part.body.subarray(0, size), part.total);
    } catch (err) {
      if (err instanceof RrdFormatError) {
        this.headerSizes.delete(path);
        // An HTML page at the data address: the files are not served there.
        const kind = /^\s*</.test(part.body.toString('latin1', 0, 64))
          ? ERROR_KINDS.NO_DATA
          : ERROR_KINDS.RRD_FORMAT;
        throw new SmokePingError(kind, `${path}: ${err.message}`);
      }
      throw err;
    }
    this.headerSizes.set(path, size);
    const rra = rawArchive(header);
    if (!rra) {
      throw new SmokePingError(ERROR_KINDS.RRD_FORMAT, `${path}: no raw archive`);
    }
    const chunks = [];
    for (const { start, end } of rowRanges(header, rra, count)) {
      const rows = part.whole
        ? { body: part.whole.subarray(start, end) }
        : await this.range(url, start, end);
      if (rows.missing || rows.body.length !== end - start) {
        throw new SmokePingError(ERROR_KINDS.RRD_FORMAT, `${path}: rows not read`);
      }
      chunks.push(rows.body);
    }
    const pingCount = header.ds.filter((name) => /^ping\d+$/.test(name)).length;
    if (!header.ds.includes('loss') || !header.ds.includes('median') || pingCount === 0) {
      throw new SmokePingError(ERROR_KINDS.RRD_FORMAT, `${path}: not a SmokePing RRD file`);
    }
    return {
      step: header.step * rra.pdpPerRow,
      lastUpdate: header.lastUpdate * 1000,
      measurements: decodeRows(header, rra, chunks).map((row) => measurementOf(row, pingCount)),
    };
  }

  /**
   * The SmokePing graph of a target, as a PNG.
   * @param {string} path target path
   * @param {number} start epoch seconds
   * @param {number} end epoch seconds
   * @returns {Promise<Buffer>}
   * @throws {SmokePingError}
   */
  async graph(path, start, end) {
    const response = await this.call(
      this.cgi(`displaymode=a;start=${start};end=${end};target=${encodeURIComponent(path)}`),
      { accept: 'image/png' },
    );
    this.check(response);
    const png = response.body;
    if (png.length < 8 || png.readUInt32BE(0) !== 0x89504e47) {
      throw new SmokePingError(ERROR_KINDS.NOT_SMOKEPING, 'The graph is not a PNG image');
    }
    return png;
  }
}

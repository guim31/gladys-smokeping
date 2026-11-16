// -----------------------------------------------------------------------------
// Integration configuration: defaults (they mirror the `default` values of the
// manifest `config_schema`, see test/manifest.test.js) and normalization, so
// the rest of the code never deals with strings, blanks or `undefined`.
//
// One SmokePing server: the address of its web interface, the address where
// its RRD files are served (by default `/smokeping-data/` on the same
// server, the Alias line of the docs), optional basic credentials, how often
// it is read, and the alert thresholds of the scene triggers.
// -----------------------------------------------------------------------------

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

// Refresh intervals offered in the configuration, in seconds. SmokePing
// measures every 5 minutes by default: reading more often only catches a
// measurement sooner.
export const POLL_INTERVALS = ['60', '120', '300'];

// Measurements in a row beyond a threshold before an alert.
export const ROUNDS = ['1', '2', '3', '5'];

// Time span of the graph shown as a camera image, in seconds.
export const GRAPH_PERIODS = { '3h': 3 * 3600, '30h': 30 * 3600, '10d': 10 * 86400 };

export const DEFAULT_CONFIG = {
  url: '',
  data_url: '',
  username: '',
  password: '',
  poll_interval: '60',
  loss_threshold: 10,
  latency_threshold: 100,
  rounds: '2',
  graph_period: '3h',
  language: 'fr',
};

// Where the docs tell the user to serve the RRD files.
export const DEFAULT_DATA_PATH = '/smokeping-data/';
// The CGI of the linuxserver.io image (and of most packages behind /smokeping/).
export const DEFAULT_CGI_PATH = '/smokeping/smokeping.cgi';

function parseUrl(raw) {
  if (typeof raw !== 'string') {
    return null;
  }
  const text = raw.trim();
  if (!text) {
    return null;
  }
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `http://${text}`;
  let url;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) {
    return null;
  }
  // Credentials in the address would end up in the logs: they have their fields.
  if (url.username || url.password) {
    return null;
  }
  return url;
}

/**
 * The CGI of SmokePing from the address typed by the user: a bare host
 * (`192.0.2.10:8080`, the linuxserver.io path is added), the folder of the
 * interface (`…/smokeping/`, `smokeping.cgi` is added), or the CGI itself
 * (`…/cgi-bin/smokeping.cgi`). The query (`?target=…`, copied from the
 * browser) is dropped.
 * @returns {string|null} null when unusable
 */
export function parseCgiUrl(raw) {
  const url = parseUrl(raw);
  if (!url) {
    return null;
  }
  let path = url.pathname;
  if (path === '/' || path === '') {
    path = DEFAULT_CGI_PATH;
  } else if (!/\.(f?cgi|pl)$/i.test(path)) {
    path = `${path.replace(/\/+$/, '')}/smokeping.cgi`;
  }
  return `${url.origin}${path}`;
}

/**
 * The folder of the RRD files, ending with `/`; by default
 * `/smokeping-data/` on the server of the interface.
 * @returns {string|null}
 */
export function parseDataUrl(raw, cgiUrl) {
  if (typeof raw !== 'string' || !raw.trim()) {
    return cgiUrl ? `${new URL(cgiUrl).origin}${DEFAULT_DATA_PATH}` : null;
  }
  const url = parseUrl(raw);
  if (!url) {
    return null;
  }
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}/`;
}

/** Host part shown to the user (no scheme). */
export const hostOf = (url) => url.replace(/^https?:\/\//, '').replace(/\/.*$/, '');

const integerIn = (value, min, max, fallback) => {
  const number = typeof value === 'string' ? Number(value.replace(',', '.')) : value;
  return Number.isFinite(number) && number >= min && number <= max ? Math.round(number) : fallback;
};

/**
 * @param {Record<string, unknown>} raw the configuration returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const text = (key) => (typeof source[key] === 'string' ? source[key].trim() : '');
  const choice = (key, options) =>
    options.includes(String(source[key])) ? String(source[key]) : DEFAULT_CONFIG[key];
  const typed = text('url');
  // Empty: not configured yet; null: typed but not understood.
  const url = typed ? parseCgiUrl(typed) : '';
  return {
    url,
    dataUrl: url ? parseDataUrl(text('data_url'), url) : null,
    username: text('username'),
    // A password may start or end with a space: kept as typed.
    password: typeof source.password === 'string' ? source.password : '',
    pollIntervalMs: Number(choice('poll_interval', POLL_INTERVALS)) * 1000,
    lossThreshold: integerIn(source.loss_threshold, 1, 100, DEFAULT_CONFIG.loss_threshold),
    latencyThreshold: integerIn(
      source.latency_threshold,
      1,
      60_000,
      DEFAULT_CONFIG.latency_threshold,
    ),
    rounds: Number(choice('rounds', ROUNDS)),
    graphPeriod: GRAPH_PERIODS[choice('graph_period', Object.keys(GRAPH_PERIODS))],
    language: LANGUAGES.includes(source.language) ? source.language : DEFAULT_CONFIG.language,
  };
}

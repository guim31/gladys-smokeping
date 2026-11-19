// -----------------------------------------------------------------------------
// Gladys devices, proposed in the Discovery tab (the user adds the ones to
// follow): one per SmokePing target, identified by its path in the SmokePing
// configuration (`DNS.Cloudflare`):
//
//   reachable         input/binary          1 when a ping answered in the last
//                                           measurement, 0 when all were lost
//   median_latency    duration/decimal ms   median round trip time
//   packet_loss       unknown/unknown %     share of pings lost
//   jitter            duration/decimal ms   standard deviation of the pings
//   last_measurement  text/text             when SmokePing measured, local time
//   graph             camera/image          the SmokePing graph (PNG)
//
// The core has no "percent" category: the loss is `unknown/unknown` with the
// percent unit (as gladys-gatus does for its uptimes), so its name shows.
//
// Published with should_poll: false: the integration reads SmokePing on its
// own timer (src/hub.js).
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';
import { TARGET_PATH } from './smokeping/client.js';
import { formatDateTime } from './texts.js';

export const TARGET_TYPE = 'target';
export const MODEL = 'SmokePing';

// Suffixes of the feature external ids: permanent once published.
export const FEATURE_KEYS = Object.freeze({
  REACHABLE: 'reachable',
  MEDIAN_LATENCY: 'median_latency',
  PACKET_LOSS: 'packet_loss',
  JITTER: 'jitter',
  LAST_MEASUREMENT: 'last_measurement',
  GRAPH: 'graph',
});

// Feature names, in the language chosen in the configuration (Gladys does not
// tell a device integration the user's language). Frozen at creation in Gladys.
export const NAMES = {
  en: {
    [FEATURE_KEYS.REACHABLE]: 'Reachable',
    [FEATURE_KEYS.MEDIAN_LATENCY]: 'Median latency',
    [FEATURE_KEYS.PACKET_LOSS]: 'Packet loss',
    [FEATURE_KEYS.JITTER]: 'Jitter',
    [FEATURE_KEYS.LAST_MEASUREMENT]: 'Last measurement',
    [FEATURE_KEYS.GRAPH]: 'SmokePing graph',
  },
  fr: {
    [FEATURE_KEYS.REACHABLE]: 'Joignable',
    [FEATURE_KEYS.MEDIAN_LATENCY]: 'Latence médiane',
    [FEATURE_KEYS.PACKET_LOSS]: 'Pertes de paquets',
    [FEATURE_KEYS.JITTER]: 'Gigue',
    [FEATURE_KEYS.LAST_MEASUREMENT]: 'Dernière mesure',
    [FEATURE_KEYS.GRAPH]: 'Graphique SmokePing',
  },
  de: {
    [FEATURE_KEYS.REACHABLE]: 'Erreichbar',
    [FEATURE_KEYS.MEDIAN_LATENCY]: 'Median-Latenz',
    [FEATURE_KEYS.PACKET_LOSS]: 'Paketverlust',
    [FEATURE_KEYS.JITTER]: 'Jitter',
    [FEATURE_KEYS.LAST_MEASUREMENT]: 'Letzte Messung',
    [FEATURE_KEYS.GRAPH]: 'SmokePing-Grafik',
  },
  es: {
    [FEATURE_KEYS.REACHABLE]: 'Accesible',
    [FEATURE_KEYS.MEDIAN_LATENCY]: 'Latencia mediana',
    [FEATURE_KEYS.PACKET_LOSS]: 'Pérdida de paquetes',
    [FEATURE_KEYS.JITTER]: 'Jitter',
    [FEATURE_KEYS.LAST_MEASUREMENT]: 'Última medición',
    [FEATURE_KEYS.GRAPH]: 'Gráfico de SmokePing',
  },
};

// Display bounds (the core never applies them on write). The FPing timeout
// of SmokePing is a few seconds; other probes (DNS, HTTP) stay below a minute.
export const MAX_LATENCY_MS = 60_000;

// Change at every measurement: published at most every few minutes
// (src/hub.js), at once with a change of state or when the device is added.
export const VOLATILE = new Set([
  FEATURE_KEYS.MEDIAN_LATENCY,
  FEATURE_KEYS.PACKET_LOSS,
  FEATURE_KEYS.JITTER,
  FEATURE_KEYS.LAST_MEASUREMENT,
]);

export const targetIds = (gladys, path) => gladys.externalIds(TARGET_TYPE, path);

/** The target path of a device external id, null when it is not a target of ours. */
export function parseTargetId(gladys, externalId) {
  const prefix = targetIds(gladys, '').device;
  if (typeof externalId !== 'string' || !externalId.startsWith(prefix)) {
    return null;
  }
  const path = externalId.slice(prefix.length);
  return path.length <= 200 && TARGET_PATH.test(path) ? path : null;
}

const sensor = (name, externalId, category, type, extra) => ({
  name,
  external_id: externalId,
  category,
  type,
  read_only: true,
  has_feedback: false,
  ...extra,
});

const milliseconds = (name, externalId) =>
  sensor(
    name,
    externalId,
    DEVICE_FEATURE_CATEGORIES.DURATION,
    DEVICE_FEATURE_TYPES.DURATION.DECIMAL,
    {
      unit: DEVICE_FEATURE_UNITS.MILLISECONDS,
      keep_history: true,
      min: 0,
      max: MAX_LATENCY_MS,
    },
  );

/** The discovery payload of a target. */
export function buildTargetDevice(gladys, target, language = 'en') {
  const ids = targetIds(gladys, target.path);
  const names = NAMES[language] ?? NAMES.en;
  const params = [{ name: 'SMOKEPING_TARGET', value: target.path.slice(0, 255) }];
  if (target.group) {
    params.push({ name: 'SMOKEPING_GROUP', value: target.group.slice(0, 255) });
  }
  return {
    name: target.name,
    external_id: ids.device,
    model: MODEL,
    should_poll: false,
    params,
    features: [
      sensor(
        names[FEATURE_KEYS.REACHABLE],
        ids.feature(FEATURE_KEYS.REACHABLE),
        DEVICE_FEATURE_CATEGORIES.INPUT,
        DEVICE_FEATURE_TYPES.SENSOR.BINARY,
        { keep_history: true, min: 0, max: 1 },
      ),
      milliseconds(names[FEATURE_KEYS.MEDIAN_LATENCY], ids.feature(FEATURE_KEYS.MEDIAN_LATENCY)),
      sensor(
        names[FEATURE_KEYS.PACKET_LOSS],
        ids.feature(FEATURE_KEYS.PACKET_LOSS),
        DEVICE_FEATURE_CATEGORIES.UNKNOWN,
        DEVICE_FEATURE_TYPES.UNKNOWN.UNKNOWN,
        { unit: DEVICE_FEATURE_UNITS.PERCENT, keep_history: true, min: 0, max: 100 },
      ),
      milliseconds(names[FEATURE_KEYS.JITTER], ids.feature(FEATURE_KEYS.JITTER)),
      sensor(
        names[FEATURE_KEYS.LAST_MEASUREMENT],
        ids.feature(FEATURE_KEYS.LAST_MEASUREMENT),
        DEVICE_FEATURE_CATEGORIES.TEXT,
        DEVICE_FEATURE_TYPES.TEXT.TEXT,
        { keep_history: false, min: 0, max: 0 },
      ),
      sensor(
        names[FEATURE_KEYS.GRAPH],
        ids.feature(FEATURE_KEYS.GRAPH),
        DEVICE_FEATURE_CATEGORIES.CAMERA,
        DEVICE_FEATURE_TYPES.CAMERA.IMAGE,
        { keep_history: false, min: 0, max: 0 },
      ),
    ],
  };
}

/**
 * The value of every known feature of a target: `{ key, device_feature_external_id, state }`
 * (`text` instead of `state` for the date).
 * Nothing for a target without a recent measurement.
 * @param {object} target as the hub views it (`state`, `stale`, `latest`)
 * @param {string} language of the date
 */
export function targetValues(gladys, target, language = 'en') {
  const ids = targetIds(gladys, target.path);
  const latest = target.latest;
  const values = [];
  if (!target.stale && latest) {
    if (target.state !== 'unknown') {
      values.push({ key: FEATURE_KEYS.REACHABLE, state: target.state === 'up' ? 1 : 0 });
    }
    if (latest.medianMs !== null) {
      values.push({
        key: FEATURE_KEYS.MEDIAN_LATENCY,
        state: Math.min(latest.medianMs, MAX_LATENCY_MS),
      });
    }
    if (latest.lossPercent !== null) {
      values.push({ key: FEATURE_KEYS.PACKET_LOSS, state: latest.lossPercent });
    }
    if (latest.jitterMs !== null) {
      values.push({ key: FEATURE_KEYS.JITTER, state: Math.min(latest.jitterMs, MAX_LATENCY_MS) });
    }
  }
  if (target.lastUpdate) {
    values.push({
      key: FEATURE_KEYS.LAST_MEASUREMENT,
      text: formatDateTime(target.lastUpdate, language),
    });
  }
  return values.map(({ key, ...value }) => ({
    key,
    device_feature_external_id: ids.feature(key),
    ...value,
  }));
}

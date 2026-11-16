// -----------------------------------------------------------------------------
// Dashboard widget (manifest `widgets`, Gladys 5.1+): `smokeping`.
//
// The use case: a glance at the wall tablet tells whether the connection is
// healthy, and which target is not. Three tiles (targets unreachable,
// degraded — loss or latency beyond the thresholds —, the median latency
// across the targets), then one status row per target, the ones needing
// attention first, with their latency and loss, and a Refresh button.
//
// Every target by default, or one group, or the devices chosen in the
// widget settings. The tiles and the button can be hidden.
//
// Budget (8 components, 2 texts, 1 status): three tiles, one text when
// SmokePing does not answer, the status list, a Refresh button.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { WIDGET_KEY } from './hub.js';
import { CONNECTION_TEXT, ERROR_TEXT, STATE_TEXT, formatNumber, pick } from './texts.js';

// Action key of the button: permanent once published.
export const ACTIONS = Object.freeze({ REFRESH: 'refresh' });

export const MAX_ROWS = 10;

export const TEXT = {
  pick: {
    en: 'Enter the address of your SmokePing in the configuration of the integration.',
    fr: "Saisissez l'adresse de votre SmokePing dans la configuration de l'intégration.",
    de: 'Gib die Adresse deines SmokePing in der Konfiguration der Integration ein.',
    es: 'Introduzca la dirección de su SmokePing en la configuración de la integración.',
  },
  empty: {
    en: 'No target to show: check the group chosen, or the SmokePing configuration.',
    fr: 'Aucune cible à afficher : vérifiez le groupe choisi, ou la configuration de SmokePing.',
    de: 'Kein Ziel anzuzeigen: Prüfe die gewählte Gruppe oder die SmokePing-Konfiguration.',
    es: 'Ningún objetivo que mostrar: compruebe el grupo elegido o la configuración de SmokePing.',
  },
  down: { en: 'Unreachable', fr: 'Injoignables', de: 'Unerreichbar', es: 'Inaccesibles' },
  degraded: { en: 'Degraded', fr: 'Dégradées', de: 'Gestört', es: 'Degradados' },
  latency: { en: 'Median latency', fr: 'Latence médiane', de: 'Median-Latenz', es: 'Latencia' },
  loss: { en: 'loss', fr: 'pertes', de: 'Verlust', es: 'pérdidas' },
  more: { en: 'Others', fr: 'Autres', de: 'Weitere', es: 'Otros' },
  refresh: { en: 'Refresh', fr: 'Actualiser', de: 'Aktualisieren', es: 'Actualizar' },
  refreshed: {
    en: 'SmokePing read again.',
    fr: 'SmokePing relu.',
    de: 'SmokePing neu gelesen.',
    es: 'SmokePing leído de nuevo.',
  },
};

// Row order: what needs attention first.
const SEVERITY = ['down', 'degraded', 'stale', 'unknown', 'up'];

const ROW_STYLE = {
  down: { icon: 'x-circle', color: WIDGET_COLORS.DANGER },
  degraded: { icon: 'alert-triangle', color: WIDGET_COLORS.WARNING },
  stale: { icon: 'clock', color: WIDGET_COLORS.NEUTRAL },
  unknown: { icon: 'circle', color: WIDGET_COLORS.NEUTRAL },
  up: { icon: 'check-circle', color: WIDGET_COLORS.SUCCESS },
};

/** What the widget says of a target. */
export function healthOf(target) {
  if (target.stale) {
    return 'stale';
  }
  if (target.state === 'up' && (target.lossHigh || target.latencyHigh)) {
    return 'degraded';
  }
  return target.state;
}

const fit = (text, max) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

const flag = (value) => value === true || value === 'true' || value === 1 || value === '1';

function message(text, language) {
  return {
    ttl_seconds: 300,
    components: [{ type: 'text', variant: 'body', text: pick(text, language) }],
  };
}

/** The targets the widget shows: the chosen devices, else a group, else all. */
export function selectTargets(hub, settings) {
  const chosen = [settings?.targets ?? []].flat().filter((id) => typeof id === 'string' && id);
  if (chosen.length > 0) {
    return [...new Set(chosen)].map((id) => hub.find(id)).filter(Boolean);
  }
  const group = typeof settings?.group === 'string' ? settings.group.trim().toLowerCase() : '';
  return hub
    .list()
    .filter(
      (target) =>
        !group ||
        target.group.toLowerCase() === group ||
        target.path.split('.')[0].toLowerCase() === group,
    );
}

function targetRow(hub, target, language) {
  const health = healthOf(target);
  const latest = target.latest;
  let value;
  if (health === 'up' || health === 'degraded') {
    const parts = [];
    if (latest.medianMs !== null) {
      parts.push(`${formatNumber(latest.medianMs, language)} ms`);
    }
    parts.push(`${formatNumber(latest.lossPercent, language)} % ${pick(TEXT.loss, language)}`);
    value = parts.join(' · ');
  } else {
    value = pick(STATE_TEXT[health], language);
  }
  return {
    label: fit(hub.displayName(target), 40),
    value: fit(value, 40),
    ...ROW_STYLE[health],
  };
}

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

async function get(hub, { settings = {}, language = 'en' }) {
  if (!hub.client) {
    return message(hub.config.url === '' ? TEXT.pick : CONNECTION_TEXT.invalidUrl, language);
  }
  const targets = selectTargets(hub, settings).sort(
    (a, b) =>
      SEVERITY.indexOf(healthOf(a)) - SEVERITY.indexOf(healthOf(b)) ||
      hub.displayName(a).localeCompare(hub.displayName(b)),
  );
  if (targets.length === 0 && !hub.error) {
    return message(TEXT.empty, language);
  }

  const components = [];
  const down = targets.filter((target) => healthOf(target) === 'down').length;
  const degraded = targets.filter((target) => healthOf(target) === 'degraded').length;
  if (!flag(settings.hide_summary)) {
    components.push(
      {
        type: 'value',
        value: down,
        label: pick(TEXT.down, language),
        icon: 'x-circle',
        color: down > 0 ? WIDGET_COLORS.DANGER : WIDGET_COLORS.NEUTRAL,
      },
      {
        type: 'value',
        value: degraded,
        label: pick(TEXT.degraded, language),
        icon: 'alert-triangle',
        color: degraded > 0 ? WIDGET_COLORS.WARNING : WIDGET_COLORS.NEUTRAL,
      },
    );
    const latencies = targets
      .filter((target) => !target.stale && target.latest?.medianMs !== null && target.latest)
      .map((target) => target.latest.medianMs);
    if (latencies.length > 0) {
      components.push({
        type: 'value',
        value: Math.round(median(latencies) * 10) / 10,
        unit: 'ms',
        label: pick(TEXT.latency, language),
        icon: 'activity',
        color: WIDGET_COLORS.NEUTRAL,
      });
    }
  }

  if (hub.error) {
    components.push({
      type: 'text',
      variant: 'body',
      text: pick(ERROR_TEXT[hub.error.kind], language),
    });
  }

  if (targets.length > 0) {
    let rows = targets.map((target) => targetRow(hub, target, language));
    if (rows.length > MAX_ROWS) {
      const hidden = rows.length - (MAX_ROWS - 1);
      rows = [
        ...rows.slice(0, MAX_ROWS - 1),
        {
          label: pick(TEXT.more, language),
          value: `+${hidden}`,
          icon: 'more-horizontal',
          color: WIDGET_COLORS.NEUTRAL,
        },
      ];
    }
    components.push({ type: 'status', items: rows });
  }

  if (!flag(settings.hide_refresh)) {
    components.push({
      type: 'button',
      label: pick(TEXT.refresh, language),
      icon: 'refresh-cw',
      style: 'secondary',
      action: { key: ACTIONS.REFRESH },
    });
  }

  return { ttl_seconds: hub.error || down > 0 ? 30 : 60, components };
}

async function action(hub, { actionKey }) {
  if (actionKey !== ACTIONS.REFRESH) {
    throw new Error(`Unknown action ${actionKey}`);
  }
  await hub.pollNow();
  hub.assertReadable();
  return { message: TEXT.refreshed };
}

export const WIDGETS = {
  [WIDGET_KEY]: { get, action },
};

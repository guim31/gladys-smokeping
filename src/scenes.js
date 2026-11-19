// -----------------------------------------------------------------------------
// Scene action handlers (manifest `scene_actions`, Gladys 5.1+).
//
// "Is this target reachable?" is already a scene condition on the device
// feature. The actions are about what a condition cannot do: put the
// measurements in a message ("Box: Reachable, 23.4 ms, 12 % loss, jitter
// 3.1 ms"), and count the targets unreachable or degraded across the server
// or a group, added to Gladys or not. Both read SmokePing again when the
// last read is older than 30 seconds.
// -----------------------------------------------------------------------------

import {
  ACTION_TEXT,
  ActionFailure,
  SENTENCE_TEXT,
  STATE_TEXT,
  formatNumber,
  labelled,
  pick,
} from './texts.js';

// Names listed in the `names` output, at most (the rest is counted).
export const MAX_LISTED_NAMES = 20;

const stateKey = (target) => (target.stale ? 'stale' : target.state);

async function readFresh(hub) {
  // An error of the last reading is not final: read again first.
  if (!hub.client) {
    hub.assertReadable();
  }
  await hub.refreshIfStale();
  hub.assertReadable();
}

export const SCENE_ACTIONS = {
  async get_target_status(hub, { fields = {} }) {
    await readFresh(hub);
    const language = hub.config.language;
    const target = hub.find(fields.device);
    if (!target) {
      throw new ActionFailure(ACTION_TEXT.unknownTarget);
    }
    const name = hub.displayName(target);
    const latest = target.stale ? null : target.latest;
    const stateText = pick(STATE_TEXT[stateKey(target)], language);
    const parts = [stateText];
    if (latest?.medianMs !== null && latest?.medianMs !== undefined) {
      parts.push(`${formatNumber(latest.medianMs, language)} ms`);
    }
    if (latest?.lossPercent !== null && latest?.lossPercent !== undefined) {
      parts.push(SENTENCE_TEXT[language].loss(formatNumber(latest.lossPercent, language)));
    }
    if (latest?.jitterMs !== null && latest?.jitterMs !== undefined) {
      parts.push(SENTENCE_TEXT[language].jitter(formatNumber(latest.jitterMs, language)));
    }
    return {
      reachable: !target.stale && target.state === 'up',
      state: stateText,
      name,
      group: target.group,
      latency: latest?.medianMs ?? 0,
      packet_loss: latest?.lossPercent ?? 0,
      jitter: latest?.jitterMs ?? 0,
      sentence: `${labelled(name, parts.join(', '), language)}.`,
    };
  },

  async count_unreachable_targets(hub, { fields = {} }) {
    await readFresh(hub);
    const group = typeof fields.group === 'string' ? fields.group.trim().toLowerCase() : '';
    const targets = hub
      .list()
      .filter(
        (target) =>
          !group ||
          target.group.toLowerCase() === group ||
          target.path.split('.')[0].toLowerCase() === group,
      );
    const down = targets
      .filter((target) => !target.stale && target.state === 'down')
      .map((target) => hub.displayName(target))
      .sort((a, b) => a.localeCompare(b));
    const listed = down.slice(0, MAX_LISTED_NAMES);
    return {
      unreachable: down.length,
      degraded: targets.filter(
        (target) =>
          !target.stale && target.state === 'up' && (target.lossHigh || target.latencyHigh),
      ).length,
      total: targets.length,
      names:
        down.length > listed.length
          ? `${listed.join(', ')}, +${down.length - listed.length}`
          : listed.join(', '),
    };
  },
};

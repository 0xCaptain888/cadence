// src/core/antifraud.js
// -----------------------------------------------------------------------------
// The agent's first autonomous judgement: is this a genuine act of attention,
// or noise we should refuse to pay for? It decides WHETHER to pay before we
// ever decide WHO to pay. Returns structured evidence so the reasoning trace
// can explain the call.
// -----------------------------------------------------------------------------

import { config } from './config.js';
import { store } from './store.js';

const BOT_CLIENT_HINTS = ['curl', 'python-requests', 'bot', 'spider', 'headless', 'libwww', 'okhttp/replay'];

/**
 * @param {import('./types.js').CadenceEvent} ev
 * @returns {{eligible:boolean, verdict:'ok'|'skip'|'wash'|'bot', risk:number, evidence:string[]}}
 */
export function assessFraud(ev) {
  const evidence = [];
  let risk = 0;

  // 1) Skip gate — too little of the track was actually heard.
  if ((ev.playedSeconds || 0) < config.minPlaySeconds) {
    return {
      eligible: false,
      verdict: 'skip',
      risk: 0.2,
      evidence: [`played ${ev.playedSeconds}s < ${config.minPlaySeconds}s floor → skip, not a real listen`],
    };
  }

  // 2) Bot client signal.
  const client = String(ev.clientId || '').toLowerCase();
  if (BOT_CLIENT_HINTS.some((h) => client.includes(h))) {
    risk += 0.6;
    evidence.push(`client "${ev.clientId}" matches automated-agent signature`);
  }

  // 3) Wash / sybil — replay velocity on the same track by the same user.
  const windowStart = ev.timestamp - config.fraud.loopWindowSeconds * 1000;
  const recent = store.getRecentPlays(ev.userId, ev.mediaFileId, windowStart);
  const playsInWindow = recent.length; // excludes the current event (recorded after assessment)

  if (playsInWindow + 1 > config.fraud.maxPlaysPerTrackPerHour) {
    risk += 0.5;
    evidence.push(
      `${playsInWindow + 1} plays of one track in ${config.fraud.loopWindowSeconds / 60}min ` +
      `> ${config.fraud.maxPlaysPerTrackPerHour} cap → wash-listening pattern`,
    );
  }

  // 4) Machine-gun interval — last play too close in time.
  if (recent.length) {
    const last = Math.max(...recent.map((p) => p.ts));
    const gap = (ev.timestamp - last) / 1000;
    if (gap >= 0 && gap < config.fraud.minIntervalSeconds) {
      risk += 0.3;
      evidence.push(`only ${gap.toFixed(1)}s since previous play < ${config.fraud.minIntervalSeconds}s → non-human cadence`);
    }
  }

  // Record AFTER assessment so the current event isn't counted against itself.
  store.recordPlayForFraud(ev);

  let verdict = 'ok';
  let eligible = true;
  if (risk >= 0.6 && evidence.some((e) => e.includes('automated-agent'))) {
    verdict = 'bot';
    eligible = false;
  } else if (risk >= 0.5) {
    verdict = 'wash';
    eligible = false;
  }

  return { eligible, verdict, risk: Math.min(1, Number(risk.toFixed(2))), evidence };
}

export default assessFraud;

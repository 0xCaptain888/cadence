// src/core/seedExpand.js
// -----------------------------------------------------------------------------
// Turns the compact seed file (data/seed-plays.json) into a time-ordered list
// of normalised CadenceEvents. Timestamps are RELATIVE to "now" so the demo
// always looks fresh and fraud windows stay valid whenever a reviewer runs it.
// A `repeat`/`intervalSeconds` pair expands into a burst (used by the wash
// case) without bloating the JSON.
// -----------------------------------------------------------------------------

import { normalizeScrobble } from './adapters/subsonic.js';

/**
 * @param {Array} seed   raw items from seed-plays.json
 * @param {number} [now] reference time (ms)
 * @returns {import('./types.js').CadenceEvent[]} ascending by timestamp
 */
export function expandSeed(seed, now = Date.now()) {
  const events = [];
  for (const item of seed) {
    const repeat = Math.max(1, Number(item.repeat || 1));
    const interval = Number(item.intervalSeconds || 0);
    for (let i = 0; i < repeat; i++) {
      const secondsAgo = Number(item.secondsAgo || 0) + i * interval;
      const time = now - secondsAgo * 1000;
      events.push(normalizeScrobble({
        id: item.id,
        user: item.user,
        playedSeconds: item.playedSeconds,
        trackDuration: item.trackDuration,
        client: item.client,
        artist: item.artist,
        title: item.title,
        time,
      }));
    }
  }
  events.sort((a, b) => a.timestamp - b.timestamp);
  return events;
}

export default expandSeed;

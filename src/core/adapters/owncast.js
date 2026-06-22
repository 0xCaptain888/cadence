// src/core/adapters/owncast.js
// -----------------------------------------------------------------------------
// PORTABILITY STUB. Owncast is open-source live video. This adapter shows how
// the SAME attribution + settlement core powers a different medium: a watched
// second of a stream is just another value-event. "Build the settlement core
// once, distribute it three times."
//
// Wire-up (future): subscribe to Owncast's webhook for USER_JOINED /
// USER_PARTED (or chat heartbeat) and emit one 'stream' event per watched
// interval. Nothing in src/core changes.
// -----------------------------------------------------------------------------

/**
 * @param {Object} raw  Owncast webhook event
 * @returns {import('../types.js').CadenceEvent}
 */
export function normalizeStream(raw) {
  const now = raw.timestamp ? Date.parse(raw.timestamp) : Date.now();
  const seconds = Number(raw.watchedSeconds ?? raw.intervalSeconds ?? 60);
  return {
    type: 'stream',
    mediaFileId: String(raw.streamId || raw.channel || 'owncast-live'),
    userId: String(raw.user?.id || raw.clientId || 'viewer'),
    timestamp: now,
    playedSeconds: seconds,
    trackDuration: seconds,
    clientId: String(raw.user?.userAgent || 'owncast'),
    raw: { artist: raw.streamerName || raw.channel || '', title: raw.streamTitle || 'Live stream' },
    source: 'owncast',
  };
}

export const owncast = {
  name: 'owncast',
  normalize: normalizeStream,
  status: 'stub', // interface proven; wiring is a follow-up
};

export default owncast;

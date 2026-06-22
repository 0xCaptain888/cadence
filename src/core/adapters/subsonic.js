// src/core/adapters/subsonic.js
// -----------------------------------------------------------------------------
// PRIMARY adapter. Converts a Subsonic/Navidrome scrobble into a normalised
// CadenceEvent. This directly answers Canteen's Request for Payments Founders
// #1: "a Subsonic scrobble sidecar".
//
// Three ways to capture scrobbles (all produce the same event):
//   1. External scrobbler — point an ListenBrainz/Last.fm-style scrobbler at
//      Cadence's /api/scrobble endpoint.
//   2. Proxy — sit in front of Navidrome and tee its `scrobble.view` calls.
//   3. SQLite sidecar — tail Navidrome's annotation table for play_count bumps.
// -----------------------------------------------------------------------------

/**
 * @param {Object} raw  a Subsonic scrobble payload (or our normalised proxy form)
 * @returns {import('../types.js').CadenceEvent}
 */
export function normalizeScrobble(raw) {
  const now = raw.time ? Number(raw.time) : Date.now();
  return {
    type: 'play',
    mediaFileId: String(raw.id || raw.mediaFileId || raw.songId || ''),
    userId: String(raw.user || raw.userId || raw.u || 'anonymous'),
    timestamp: now,
    playedSeconds: Number(raw.playedSeconds ?? raw.duration ?? raw.position ?? 0),
    trackDuration: Number(raw.trackDuration ?? raw.songDuration ?? 0),
    clientId: String(raw.client || raw.c || raw.clientId || 'unknown'),
    raw: { artist: raw.artist || '', title: raw.title || raw.track || '', album: raw.album || '' },
    source: 'subsonic',
  };
}

export const subsonic = {
  name: 'subsonic',
  normalize: normalizeScrobble,
};

export default subsonic;

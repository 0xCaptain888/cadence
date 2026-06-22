// src/core/musicbrainz.js
// -----------------------------------------------------------------------------
// Resolves a raw play into structured work metadata. Offline by default: we
// ship a small MusicBrainz cache (data/metadata-cache.json) that covers the
// seeded long-tail cases. With CADENCE_MUSICBRAINZ=on the same function will
// hit the live MusicBrainz API, but the offline path keeps the demo fully
// deterministic and reviewable with no network.
//
// "Attribution metadata IS settlement logic" — so this step feeds directly
// into who gets paid.
// -----------------------------------------------------------------------------

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_FILE = join(__dirname, '..', '..', 'data', 'metadata-cache.json');

let CACHE = { byId: {}, byKey: {} };
try {
  if (existsSync(CACHE_FILE)) CACHE = JSON.parse(readFileSync(CACHE_FILE, 'utf8'));
} catch { /* empty cache is fine */ }

function norm(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Build a fuzzy key from artist + title for cache lookup. */
function matchKey(artist, title) {
  return `${norm(artist)}::${norm(title)}`;
}

/**
 * @param {import('./types.js').CadenceEvent} ev
 * @returns {Promise<Object>} resolved metadata
 */
export async function resolveMetadata(ev) {
  const raw = ev.raw || {};
  const rawArtist = raw.artist || '';
  const rawTitle = raw.title || '';

  // 1) Strongest match: by mediaFileId.
  let hit = CACHE.byId[ev.mediaFileId];

  // 2) Fuzzy match: by normalised artist::title, tolerating typos/casing.
  if (!hit) {
    const key = matchKey(rawArtist, rawTitle);
    hit = CACHE.byKey[key];
    if (!hit) {
      // token-overlap fuzzy match for typos / missing articles, e.g.
      // "beatles hey jude" -> "the beatles::hey jude".
      const STOP = new Set(['the', 'a', 'an', 'of', 'feat', 'ft', 'and', '&']);
      const qTokens = new Set(norm(`${rawArtist} ${rawTitle}`).split(' ').filter((t) => t && !STOP.has(t)));
      let best = null;
      let bestScore = 0;
      for (const [k, v] of Object.entries(CACHE.byKey)) {
        const kTokens = k.replace('::', ' ').split(' ').filter((t) => t && !STOP.has(t));
        if (!kTokens.length) continue;
        const inter = kTokens.filter((t) => qTokens.has(t)).length;
        const score = inter / kTokens.length;
        if (score > bestScore) { bestScore = score; best = v; }
      }
      if (bestScore >= 0.6) hit = best;
    }
  }

  // 3) Live MusicBrainz (optional) — only if explicitly enabled.
  if (!hit && config_musicbrainzLive()) {
    hit = await fetchLive(rawArtist, rawTitle);
  }

  if (hit) {
    return {
      title: hit.title || rawTitle,
      artist: hit.artist || rawArtist,
      mbid: hit.mbid || null,
      credits: hit.credits || [],
      releaseType: hit.releaseType || 'album',
      isLive: Boolean(hit.isLive),
      isCompilation: Boolean(hit.isCompilation),
      isRemix: Boolean(hit.isRemix),
      original: hit.original || null,
      matched: 'cache',
    };
  }

  // 4) Unknown work — hand a low-confidence stub to the reasoner.
  return {
    title: rawTitle || ev.mediaFileId,
    artist: rawArtist || 'Unknown Artist',
    mbid: null,
    credits: [],
    releaseType: 'unknown',
    isLive: false,
    isCompilation: false,
    isRemix: false,
    original: null,
    matched: 'none',
  };
}

// Lazy import of config to avoid a require cycle at module load.
function config_musicbrainzLive() {
  try {
    // eslint-disable-next-line global-require
    return Boolean(process.env.CADENCE_MUSICBRAINZ && process.env.CADENCE_MUSICBRAINZ.toLowerCase() === 'on');
  } catch { return false; }
}

async function fetchLive(artist, title) {
  try {
    const q = encodeURIComponent(`recording:"${title}" AND artist:"${artist}"`);
    const url = `https://musicbrainz.org/ws/2/recording?query=${q}&fmt=json&limit=1`;
    const res = await fetch(url, { headers: { 'User-Agent': 'Cadence/1.0 (hackathon)' } });
    if (!res.ok) return null;
    const data = await res.json();
    const rec = data.recordings && data.recordings[0];
    if (!rec) return null;
    const credits = (rec['artist-credit'] || []).map((c) => ({
      name: c.name || (c.artist && c.artist.name),
      role: 'performer',
      mbid: c.artist && c.artist.id,
    }));
    return { title: rec.title, artist: credits[0] && credits[0].name, mbid: rec.id, credits };
  } catch {
    return null;
  }
}

export default resolveMetadata;

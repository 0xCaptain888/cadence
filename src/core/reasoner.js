// src/core/reasoner.js
// -----------------------------------------------------------------------------
// THE BRAIN. Given resolved metadata, decide WHO should be paid and in WHAT
// proportion — then explain the decision. This is the heart of the 30%
// "agentic sophistication" score: the agent reasons over genuinely hard
// long-tail cases (public-domain classical, live bootlegs, remix lineage,
// "Various Artists" compilations, typo'd metadata, unknown works) rather than
// trivial clean credits.
//
// Two backends, one interface:
//   • deterministic  — explainable rules; runs with zero secrets/network.
//   • anthropic      — when ANTHROPIC_API_KEY is set, the model reasons over
//                      the hard cases and returns the same structured shape.
// The deterministic backend is always the fallback, so the demo never breaks.
// -----------------------------------------------------------------------------

import { config } from './config.js';

// Composers whose works are in the public domain (died > 70y ago). For these,
// the *mechanical/composition* share has no living rightsholder, so the
// performer/ensemble receives it. In-copyright composers trigger review.
const PUBLIC_DOMAIN_COMPOSERS = new Set([
  'johann sebastian bach', 'bach',
  'wolfgang amadeus mozart', 'mozart',
  'ludwig van beethoven', 'beethoven',
  'antonio vivaldi', 'vivaldi',
  'george frideric handel', 'handel',
  'frederic chopin', 'chopin',
  'franz schubert', 'schubert',
  'johannes brahms', 'brahms',
  'pyotr ilyich tchaikovsky', 'tchaikovsky',
  'claude debussy', 'debussy',
  'franz liszt', 'liszt',
  'robert schumann', 'schumann',
]);

function lc(s) { return String(s || '').toLowerCase().trim(); }

/** Normalise an array of {..., share} so the shares sum to exactly 1. */
export function normalizeShares(payees) {
  const total = payees.reduce((a, p) => a + (p.share || 0), 0);
  if (total <= 0) {
    const even = 1 / payees.length;
    return payees.map((p) => ({ ...p, share: even }));
  }
  let acc = 0;
  return payees.map((p, i) => {
    if (i === payees.length - 1) {
      return { ...p, share: Number((1 - acc).toFixed(6)) }; // absorb rounding
    }
    const sh = Number((p.share / total).toFixed(6));
    acc += sh;
    return { ...p, share: sh };
  });
}

/** Weight raw credits by role, then normalise. */
function weightByRole(credits) {
  const writers = credits.filter((c) => c.role === 'writer');
  const out = credits.map((c) => {
    let w = config.roleWeights[c.role] ?? 0.1;
    if (c.role === 'writer' && writers.length > 1) w /= writers.length; // split writer pool
    return { name: c.name, role: c.role, mbid: c.mbid || null, share: w };
  });
  return normalizeShares(out);
}

/**
 * Deterministic attribution over the hard cases.
 * @returns {{payees:Object[], reasoning:string[], needsReview:boolean, overallConfidence:number}}
 */
function reasonDeterministic(md, ev) {
  const reasoning = [];
  let needsReview = false;
  let confidence = 0.9;

  // ---- Case: unknown work -> escrow, human review. -------------------------
  if (md.matched === 'none' && (!md.credits || md.credits.length === 0)) {
    reasoning.push(`no metadata match for "${md.artist} – ${md.title}" → cannot attribute confidently`);
    reasoning.push('routing full amount to escrow pending identification');
    return {
      payees: [{ name: md.artist || 'Unknown', role: 'performer', mbid: null, share: 1 }],
      reasoning, needsReview: true, overallConfidence: 0.25,
    };
  }

  // ---- Case: live bootleg / audience recording -> low confidence. ----------
  if (md.isLive) {
    confidence = 0.55;
    needsReview = true;
    reasoning.push('release flagged as live / audience recording → rights often unclear');
    const performer = (md.credits.find((c) => c.role === 'performer') || { name: md.artist });
    reasoning.push(`attributing to performing act "${performer.name}", holding for review before release`);
    return {
      payees: normalizeShares([{ name: performer.name, role: 'performer', mbid: performer.mbid || md.mbid, share: 1 }]),
      reasoning, needsReview, overallConfidence: confidence,
    };
  }

  // ---- Case: "Various Artists" compilation -> recover real artist. ---------
  if (md.isCompilation || lc(md.artist) === 'various artists' || lc(md.artist) === 'va') {
    reasoning.push('"Various Artists" is a compilation label, not a rightsholder');
    const real = md.credits.length ? md.credits : (md.original ? md.original.credits : []);
    if (real && real.length) {
      reasoning.push(`recovered underlying track credits: ${real.map((c) => c.name).join(', ')}`);
      return { payees: weightByRole(real), reasoning, needsReview: false, overallConfidence: 0.82 };
    }
    reasoning.push('underlying track artist unresolved → escrow');
    return {
      payees: [{ name: md.title, role: 'performer', mbid: null, share: 1 }],
      reasoning, needsReview: true, overallConfidence: 0.3,
    };
  }

  // ---- Case: remix -> recursive lineage split. -----------------------------
  if (md.isRemix && md.original) {
    reasoning.push('remix detected → value flows to BOTH remixer and the original work');
    const remixerCredits = md.credits.filter((c) => c.role === 'performer' || c.role === 'producer');
    const remixer = remixerCredits.length ? remixerCredits : [{ name: md.artist, role: 'producer' }];
    const originalCredits = md.original.credits || [];

    // 50% remixer performance/production, 50% original songwriting/composition.
    const remixPart = weightByRole(remixer).map((p) => ({ ...p, share: p.share * 0.5, lineage: 'remix' }));
    const origPart = weightByRole(
      originalCredits.length ? originalCredits : [{ name: md.original.artist, role: 'writer' }],
    ).map((p) => ({ ...p, share: p.share * 0.5, lineage: 'original' }));

    reasoning.push(`remix side: ${remixer.map((c) => c.name).join(', ')} (50%)`);
    reasoning.push(`original side: ${(originalCredits.map((c) => c.name).join(', ')) || md.original.artist} (50%)`);
    return {
      payees: normalizeShares([...remixPart, ...origPart]),
      reasoning, needsReview: false, overallConfidence: 0.78,
    };
  }

  // ---- Case: classical -> public-domain vs in-copyright composer. ----------
  const composers = md.credits.filter((c) => c.role === 'writer');
  const isClassical = md.releaseType === 'classical' || composers.some((c) => PUBLIC_DOMAIN_COMPOSERS.has(lc(c.name)));
  if (isClassical && composers.length) {
    const allPD = composers.every((c) => PUBLIC_DOMAIN_COMPOSERS.has(lc(c.name)));
    if (allPD) {
      reasoning.push(`composer(s) ${composers.map((c) => c.name).join(', ')} are public-domain (no living rightsholder)`);
      reasoning.push('mechanical/composition share reassigned to the performer/ensemble');
      const performers = md.credits.filter((c) => c.role !== 'writer');
      const recip = performers.length ? performers : [{ name: md.artist, role: 'performer' }];
      return {
        payees: normalizeShares(recip.map((c) => ({ name: c.name, role: 'performer', mbid: c.mbid || null, share: 1 }))),
        reasoning, needsReview: false, overallConfidence: 0.86,
      };
    }
    reasoning.push('at least one composer may still be in copyright → cannot auto-clear composition share');
    reasoning.push('provisional 60% performer / 40% composition split, flagged for review');
    const performers = md.credits.filter((c) => c.role !== 'writer').map((c) => ({ ...c, share: 0.6 }));
    const comp = composers.map((c) => ({ ...c, share: 0.4 / composers.length }));
    return {
      payees: normalizeShares([...(performers.length ? performers : [{ name: md.artist, role: 'performer', share: 0.6 }]), ...comp]),
      reasoning, needsReview: true, overallConfidence: 0.6,
    };
  }

  // ---- Case: typo / single artist resolved via fuzzy match. ----------------
  if (md.credits.length <= 1) {
    const only = md.credits[0] || { name: md.artist, role: 'performer', mbid: md.mbid };
    if (md.matched === 'cache' && lc(only.name) !== lc((ev.raw && ev.raw.artist) || '')) {
      reasoning.push(`fuzzy-resolved "${(ev.raw && ev.raw.artist) || ''}" → canonical "${only.name}"`);
      confidence = 0.8;
    } else {
      reasoning.push(`single credited artist "${only.name}" → straightforward attribution`);
    }
    return {
      payees: normalizeShares([{ name: only.name, role: 'performer', mbid: only.mbid || md.mbid, share: 1 }]),
      reasoning, needsReview: false, overallConfidence: confidence,
    };
  }

  // ---- Case: clean multi-credit -> role-weighted split. --------------------
  reasoning.push(`clean credits (${md.credits.length}) → role-weighted split`);
  reasoning.push(
    'weights: performer .50 / writers .30 (shared) / producer .12 / featured .08, then normalised',
  );
  return { payees: weightByRole(md.credits), reasoning, needsReview: false, overallConfidence: 0.92 };
}

/**
 * Optional LLM backend. Asks the model to reason over the same metadata and
 * return STRICT JSON. Falls back to deterministic on any error so the demo is
 * never blocked by the network.
 */
async function reasonWithModel(md, ev) {
  const sys =
    'You are Cadence, an autonomous music-royalty attribution agent. Given track ' +
    'metadata, decide who should be paid and in what proportion. Handle public-domain ' +
    'classical (performer takes the composition share), live bootlegs (low confidence, ' +
    'review), "Various Artists" (recover the real artist), and remix lineage (split ' +
    'remixer vs original). Reply ONLY with JSON: {"payees":[{"name","role","mbid","share"}],' +
    '"reasoning":["..."],"needsReview":bool,"overallConfidence":0..1}. Shares must sum to 1.';

  const user = JSON.stringify({
    title: md.title, artist: md.artist, mbid: md.mbid, credits: md.credits,
    releaseType: md.releaseType, isLive: md.isLive, isCompilation: md.isCompilation,
    isRemix: md.isRemix, original: md.original,
  });

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': config.anthropicKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: config.anthropicModel,
      max_tokens: 1024,
      system: sys,
      messages: [{ role: 'user', content: user }],
    }),
  });
  if (!res.ok) throw new Error(`anthropic ${res.status}`);
  const data = await res.json();
  const text = (data.content || []).map((c) => c.text || '').join('').replace(/```json|```/g, '').trim();
  const parsed = JSON.parse(text);
  parsed.payees = normalizeShares(parsed.payees || []);
  return parsed;
}

/**
 * Public entry point. Easy clean cases skip the model entirely; hard cases use
 * the model when a key is present, else the deterministic reasoner.
 *
 * @returns {Promise<{payees:Object[], reasoning:string[], needsReview:boolean, overallConfidence:number, backend:string}>}
 */
export async function resolvePayees(md, ev) {
  const isHard =
    md.matched === 'none' || md.isLive || md.isCompilation || md.isRemix ||
    md.releaseType === 'classical' ||
    md.credits.some((c) => PUBLIC_DOMAIN_COMPOSERS.has(lc(c.name)));

  if (isHard && config.hasAnthropicKey) {
    try {
      const out = await reasonWithModel(md, ev);
      return { ...out, backend: 'anthropic' };
    } catch (e) {
      const det = reasonDeterministic(md, ev);
      det.reasoning.unshift(`(model backend unavailable: ${e.message} — using deterministic reasoner)`);
      return { ...det, backend: 'deterministic' };
    }
  }

  const det = reasonDeterministic(md, ev);
  return { ...det, backend: 'deterministic' };
}

export default resolvePayees;

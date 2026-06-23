#!/usr/bin/env node
// scripts/verify-core.mjs
// -----------------------------------------------------------------------------
// ZERO-DEPENDENCY end-to-end verification of the Cadence decision engine.
// Runs every seeded long-tail case through the real pipeline (processPlay) and
// asserts the agent's verdicts. No network, no chain, no secrets required:
//
//     node scripts/verify-core.mjs
//
// This is the proof that "the brain works" independent of the UI or any
// external service.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Force MOCK mode for verification — the verify script proves the brain works
// without any chain/network dependency, regardless of .env settings.
// Must be set BEFORE any core imports (ESM hoists static imports).
process.env.CADENCE_SETTLEMENT_MODE = 'mock';
delete process.env.CADENCE_SPLITTER_ADDRESS;

const { processPlay, reset, getMetrics, modeLabel } = await import('../src/core/index.js');
const { expandSeed } = await import('../src/core/seedExpand.js');

const __dirname = dirname(fileURLToPath(import.meta.url));
const seed = JSON.parse(readFileSync(join(__dirname, '..', 'data', 'seed-plays.json'), 'utf8'));

let pass = 0;
let fail = 0;
function ok(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  \u2713 ${name}`); }
  else { fail++; console.log(`  \u2717 ${name}${detail ? '  — ' + detail : ''}`); }
}
function approx(a, b, eps = 1e-6) { return Math.abs(a - b) <= eps; }

const run = async () => {
  console.log(`\nCadence core verification — mode: ${modeLabel()}\n`);
  reset();

  const events = expandSeed(seed, Date.now());
  const records = [];
  for (const ev of events) {
    const decision = await processPlay(ev);
    records.push({ ev, decision });
  }
  console.log(`Processed ${records.length} events.\n`);

  const byTrackUser = (artistIncludes, user) =>
    records.find((r) =>
      (!artistIncludes || (r.decision.track.artist || '').toLowerCase().includes(artistIncludes.toLowerCase())) &&
      (!user || r.ev.userId === user));
  const byMediaUser = (mediaFileId, user, pred) =>
    records.find((r) => r.ev.mediaFileId === mediaFileId && (!user || r.ev.userId === user) && (!pred || pred(r)));

  // ---- 1. public-domain classical -----------------------------------------
  console.log('Case 1 — public-domain classical (Bach / Glenn Gould)');
  {
    const r = byTrackUser('glenn gould');
    ok('settles', r && r.decision.verdict === 'settled', r && r.decision.verdict);
    ok('single performer payee (composition reassigned)', r && r.decision.payees.length === 1 && r.decision.payees[0].name === 'Glenn Gould');
    ok('reasoning cites public domain', r && r.decision.reasoning.some((x) => /public-domain/i.test(x)));
  }

  // ---- 2. live bootleg -> escrow + review ----------------------------------
  console.log('Case 2 — live bootleg (Radiohead, audience recording)');
  {
    const r = byTrackUser('radiohead');
    ok('escrowed (no wallet)', r && r.decision.verdict === 'escrowed', r && r.decision.verdict);
    ok('flagged needsReview', r && r.decision.needsReview === true);
  }

  // ---- 3. compilation -> recover real artist -------------------------------
  console.log('Case 3 — compilation ("Various Artists" -> Dua Lipa)');
  {
    const r = byMediaUser('mf_now50_t07', 'u_mina');
    ok('settles', r && r.decision.verdict === 'settled', r && r.decision.verdict);
    ok('recovered Dua Lipa as payee', r && r.decision.payees.some((p) => p.name === 'Dua Lipa'));
    ok('no "Various Artists" payee', r && !r.decision.payees.some((p) => /various/i.test(p.name)));
  }

  // ---- 4. remix lineage -> partial escrow ----------------------------------
  console.log('Case 4 — remix lineage (Solour remix of Maya Lin Trio)');
  {
    const r = byMediaUser('mf_midnight_remix');
    ok('settles (partial)', r && r.decision.verdict === 'settled', r && r.decision.verdict);
    ok('remixer Solour paid', r && r.decision.payees.some((p) => p.name === 'Solour' && !p.escrowed && p.amountUsd > 0));
    ok('original side escrowed', r && r.decision.payees.some((p) => p.escrowed));
  }

  // ---- 5. typo / fuzzy resolution ------------------------------------------
  console.log('Case 5 — typo / no mbid ("beatles hey jude")');
  {
    const r = byMediaUser('mf_unknown_hj');
    ok('settles', r && r.decision.verdict === 'settled', r && r.decision.verdict);
    ok('canonicalised to The Beatles', r && r.decision.track.artist === 'The Beatles', r && r.decision.track.artist);
  }

  // ---- 6. wash / sybil ------------------------------------------------------
  console.log('Case 6 — wash / sybil (24 replays by one user)');
  {
    const wash = records.filter((r) => r.ev.userId === 'u_washbot' && r.ev.mediaFileId === 'mf_aurora_skyline');
    const rejected = wash.filter((r) => r.decision.verdict === 'rejected' && r.decision.fraud.verdict === 'wash');
    const settled = wash.filter((r) => r.decision.verdict === 'settled');
    ok('detects wash and rejects the excess', rejected.length > 0, `rejected=${rejected.length}`);
    ok('lets the genuine early plays through', settled.length > 0, `settled=${settled.length}`);
  }

  // ---- 7. skip --------------------------------------------------------------
  console.log('Case 7 — skip (12s play)');
  {
    const r = byMediaUser('mf_kwame_horizon', 'u_mina', (x) => x.ev.playedSeconds < 30);
    ok('rejected as skip', r && r.decision.verdict === 'rejected' && r.decision.fraud.verdict === 'skip', r && r.decision.fraud.verdict);
  }

  // ---- 8. long-tail no wallet ----------------------------------------------
  console.log('Case 8 — long-tail no wallet (Sofia Reyes Quartet)');
  {
    const r = byMediaUser('mf_sofia_quartet_dawn');
    ok('escrowed', r && r.decision.verdict === 'escrowed', r && r.decision.verdict);
    ok('all payees escrowed', r && r.decision.payees.every((p) => p.escrowed));
    ok('has an ERC-8004 identity hash', r && r.decision.payees.every((p) => /^0x[0-9a-f]+$/.test(p.identityHash)));
  }

  // ---- 9. clean multi-credit -----------------------------------------------
  console.log('Case 9 — clean multi-credit (4-way split)');
  {
    const r = byMediaUser('mf_allstars_open_road', 'u_theo');
    ok('settles', r && r.decision.verdict === 'settled', r && r.decision.verdict);
    ok('four payees', r && r.decision.payees.length === 4, r && String(r.decision.payees.length));
  }

  // ---- global invariants ----------------------------------------------------
  console.log('Global invariants');
  {
    const paying = records.filter((r) => r.decision.verdict !== 'rejected');
    const sharesOk = paying.every((r) => approx(r.decision.payees.reduce((a, p) => a + p.share, 0), 1, 1e-3));
    ok('every paying decision: shares sum to 1', sharesOk);

    const amountOk = records.filter((r) => r.decision.verdict === 'settled')
      .every((r) => approx(r.decision.payees.reduce((a, p) => a + p.amountUsd, 0), r.decision.amountUsd, 1e-6));
    ok('settled amounts reconcile to payee splits', amountOk);

    const m = getMetrics();
    ok('metrics: settled + escrowed + rejected = total', m.totals.settledPlays + m.totals.escrowedPlays + m.totals.rejectedPlays === m.totals.totalPlays,
      `${m.totals.settledPlays}+${m.totals.escrowedPlays}+${m.totals.rejectedPlays} vs ${m.totals.totalPlays}`);
    ok('money actually moved (paid > 0)', m.totals.totalPaidUsd > 0, `paid=$${m.totals.totalPaidUsd}`);
    ok('escrow accrued (> 0)', m.totals.totalEscrowUsd > 0, `escrow=$${m.totals.totalEscrowUsd}`);

    console.log(`\n  metrics: plays=${m.totals.totalPlays} settled=${m.totals.settledPlays} escrowed=${m.totals.escrowedPlays} rejected=${m.totals.rejectedPlays}`);
    console.log(`           paid=$${m.totals.totalPaidUsd.toFixed(6)} escrow=$${m.totals.totalEscrowUsd.toFixed(6)} artists=${m.uniqueArtists} users=${m.uniqueUsers} batches=${m.operators}`);
  }

  console.log(`\n${fail === 0 ? '\u2713 ALL PASSED' : '\u2717 FAILURES'} — ${pass} passed, ${fail} failed\n`);
  reset();
  process.exit(fail === 0 ? 0 : 1);
};

run().catch((e) => { console.error('verify-core crashed:', e); process.exit(2); });

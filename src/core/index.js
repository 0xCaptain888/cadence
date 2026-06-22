// src/core/index.js
// -----------------------------------------------------------------------------
// THE PIPELINE. One call — processPlay(event) — runs the full autonomous loop:
//
//   resolveMetadata  →  assessFraud  →  resolvePayees  →  mapWallets
//                    →  allocate(budget)  →  settle  →  Decision
//
// The agent autonomously decides WHETHER to pay (fraud), WHO to pay
// (attribution + registry), and HOW MUCH (budget), then settles and records a
// fully-explained Decision. This file is the single import surface for every
// transport (HTTP server, simulator, verify script).
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { resolveMetadata } from './musicbrainz.js';
import { assessFraud } from './antifraud.js';
import { resolvePayees } from './reasoner.js';
import { mapWallets } from './registry.js';
import { allocate } from './budget.js';
import { settle } from './settlement.js';
import { store } from './store.js';
import { modeLabel, summarize } from './config.js';

function decisionId(ev) {
  return 'dec_' + createHash('sha256')
    .update(`${ev.userId}:${ev.mediaFileId}:${ev.timestamp}`)
    .digest('hex').slice(0, 12);
}

/**
 * Process one normalised value-event end to end.
 * @param {import('./types.js').CadenceEvent} ev
 * @returns {Promise<import('./types.js').Decision>}
 */
export async function processPlay(ev) {
  const reasoning = [];

  // 1) Identify the work.
  const md = await resolveMetadata(ev);
  reasoning.push(`[meta] resolved "${md.artist} – ${md.title}"${md.mbid ? ` (mbid ${md.mbid.slice(0, 8)}…)` : ' (no mbid)'} via ${md.matched}`);

  // 2) Decide WHETHER this attention is real.
  const fraud = assessFraud(ev);
  for (const e of fraud.evidence) reasoning.push(`[fraud] ${e}`);
  if (!fraud.eligible) {
    reasoning.push(`[fraud] verdict=${fraud.verdict} risk=${fraud.risk} → refusing payment`);
    const rejected = {
      id: decisionId(ev),
      timestamp: ev.timestamp,
      verdict: 'rejected',
      track: { title: md.title, artist: md.artist, mbid: md.mbid },
      user: ev.userId,
      amountUsd: 0,
      payees: [],
      reasoning,
      needsReview: false,
      confidence: 1,
      backend: 'rules',
      fraud: { verdict: fraud.verdict, risk: fraud.risk },
      txHash: null,
      batchId: null,
    };
    return store.recordDecision(rejected);
  }
  reasoning.push(`[fraud] verdict=ok risk=${fraud.risk} → genuine attention`);

  // 3) Decide WHO to pay.
  const attribution = await resolvePayees(md, ev);
  for (const r of attribution.reasoning) reasoning.push(`[payee] ${r}`);
  reasoning.push(`[payee] backend=${attribution.backend} confidence=${attribution.overallConfidence}`);

  // 4) Resolve wallets (or escrow).
  let payees = mapWallets(attribution.payees);
  for (const p of payees) {
    if (p.routedToEscrow) reasoning.push(`[wallet] "${p.name}" has no registered wallet → escrow (id ${p.identityHash.slice(0, 10)}…)`);
    else reasoning.push(`[wallet] "${p.name}" → ${p.wallet.slice(0, 10)}…${p.erc8004Claimed ? ' (ERC-8004 verified)' : ''}`);
  }

  // 5) Decide HOW MUCH (budget-capped nanopayment).
  const budget = allocate(ev.userId);
  reasoning.push(`[budget] drawing $${budget.amountUsd} from ${ev.userId} (remaining $${budget.remainingBudget}${budget.capped ? ', monthly cap reached' : ''})`);

  if (budget.amountUsd <= 0) {
    const capped = {
      id: decisionId(ev),
      timestamp: ev.timestamp,
      verdict: 'rejected',
      track: { title: md.title, artist: md.artist, mbid: md.mbid },
      user: ev.userId,
      amountUsd: 0,
      payees: payees.map((p) => ({ name: p.name, role: p.role, share: p.share, amountUsd: 0, wallet: p.wallet, escrowed: p.routedToEscrow })),
      reasoning: [...reasoning, '[budget] monthly budget exhausted → recorded for analytics, settled $0'],
      needsReview: attribution.needsReview,
      confidence: attribution.overallConfidence,
      backend: attribution.backend,
      fraud: { verdict: fraud.verdict, risk: fraud.risk },
      txHash: null,
      batchId: null,
    };
    return store.recordDecision(capped);
  }

  // 6) Settle (mock or live on Arc via Circle).
  const result = await settle(budget.amountUsd, payees, ev.timestamp);
  reasoning.push(`[settle] mode=${result.mode} batch=${result.batchId} tx=${result.txHash.slice(0, 12)}… paid=$${result.paidUsd} escrow=$${result.escrowedUsd}`);

  // Attach per-payee amounts back onto the payee list. settle() builds `splits`
  // 1:1 from `payees` in the same order, so we zip positionally. Keying by name
  // would collapse payees that share a name (e.g. one artist credited as both
  // performer and writer), handing every duplicate the last split's amount.
  const finalPayees = payees.map((p, i) => {
    const s = result.splits[i] || {};
    return {
      name: p.name,
      role: p.role,
      mbid: p.mbid || null,
      share: p.share,
      wallet: p.wallet || null,
      escrowed: Boolean(p.routedToEscrow),
      amountUsd: s.amountUsd || 0,
      identityHash: p.identityHash,
    };
  });

  const anyEscrow = finalPayees.some((p) => p.escrowed);
  const allEscrow = finalPayees.every((p) => p.escrowed);
  const verdict = allEscrow ? 'escrowed' : 'settled';
  if (anyEscrow && !allEscrow) reasoning.push('[settle] partial escrow: paid registered payees, held the rest');
  if (attribution.needsReview) reasoning.push('[review] flagged for human review before final release');

  const decision = {
    id: decisionId(ev),
    timestamp: ev.timestamp,
    verdict,
    track: { title: md.title, artist: md.artist, mbid: md.mbid },
    user: ev.userId,
    amountUsd: budget.amountUsd,
    payees: finalPayees,
    reasoning,
    needsReview: attribution.needsReview,
    confidence: attribution.overallConfidence,
    backend: attribution.backend,
    fraud: { verdict: fraud.verdict, risk: fraud.risk },
    txHash: result.txHash,
    batchId: result.batchId,
  };
  return store.recordDecision(decision);
}

// Re-exports so transports import everything from one place.
export { modeLabel, summarize } from './config.js';
export function getMetrics() { return store.getMetrics(); }
export function getRecentDecisions(limit) { return store.getRecentDecisions(limit); }
export function listEscrow() { return store.listEscrow(); }
export function claimEscrow(identityHash, wallet) { return store.claimEscrow(identityHash, wallet); }
export function bumpOperators(n) { return store.bumpOperators(n); }
export function reset() { return store.reset(); }

export default processPlay;

// src/core/store.js
// -----------------------------------------------------------------------------
// In-memory state for the live dashboard, persisted to disk so a reviewer who
// restarts the server keeps their history. A single instance is shared across
// the whole process via globalThis (so the HTTP server, the simulator and the
// verify script all see the same numbers).
// -----------------------------------------------------------------------------

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', '..', '.data');
const STATE_FILE = join(DATA_DIR, 'state.json');

function emptyState() {
  return {
    decisions: [],          // newest first, capped
    plays: [],              // {userId, mediaFileId, ts} fraud window
    userSpend: {},          // userId -> usd spent this cycle
    settlementSeries: [],   // {ts, usd} for the sparkline
    operators: 0,           // settlement batches submitted
    escrow: {},             // identityHash -> {name, mbid, usd, claimed, wallet}
    totals: {
      totalPlays: 0,
      settledPlays: 0,
      escrowedPlays: 0,
      rejectedPlays: 0,
      totalPaidUsd: 0,
      totalEscrowUsd: 0,
    },
  };
}

function load() {
  try {
    if (existsSync(STATE_FILE)) {
      return { ...emptyState(), ...JSON.parse(readFileSync(STATE_FILE, 'utf8')) };
    }
  } catch { /* fall through to fresh state */ }
  return emptyState();
}

class Store {
  constructor() {
    this.state = load();
    this._dirty = false;
  }

  persist() {
    try {
      if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
      writeFileSync(STATE_FILE, JSON.stringify(this.state));
    } catch { /* non-fatal: dashboard still works from memory */ }
  }

  // ---- decisions ----------------------------------------------------------
  recordDecision(decision) {
    const s = this.state;
    s.decisions.unshift(decision);
    if (s.decisions.length > 500) s.decisions.length = 500;

    s.totals.totalPlays += 1;
    if (decision.verdict === 'settled') {
      s.totals.settledPlays += 1;
      s.totals.totalPaidUsd += decision.amountUsd || 0;
      s.settlementSeries.push({ ts: decision.timestamp, usd: decision.amountUsd || 0 });
    } else if (decision.verdict === 'escrowed') {
      s.totals.escrowedPlays += 1;
      // escrowed value is tracked via addEscrow()
      s.settlementSeries.push({ ts: decision.timestamp, usd: decision.amountUsd || 0 });
    } else {
      s.totals.rejectedPlays += 1;
    }
    if (s.settlementSeries.length > 240) s.settlementSeries.splice(0, s.settlementSeries.length - 240);

    this.persist();
    return decision;
  }

  getRecentDecisions(limit = 40) {
    return this.state.decisions.slice(0, limit);
  }

  // ---- fraud window -------------------------------------------------------
  recordPlayForFraud(ev) {
    this.state.plays.push({ userId: ev.userId, mediaFileId: ev.mediaFileId, ts: ev.timestamp });
    // keep only the last 6 hours of events
    const cutoff = ev.timestamp - 6 * 3600 * 1000;
    this.state.plays = this.state.plays.filter((p) => p.ts >= cutoff);
  }

  getRecentPlays(userId, mediaFileId, sinceMs) {
    return this.state.plays.filter(
      (p) => p.userId === userId && p.mediaFileId === mediaFileId && p.ts >= sinceMs,
    );
  }

  // ---- per-listener budget ------------------------------------------------
  getUserSpend(userId) {
    return this.state.userSpend[userId] || 0;
  }

  addUserSpend(userId, usd) {
    this.state.userSpend[userId] = (this.state.userSpend[userId] || 0) + usd;
  }

  // ---- settlement operators (batches) -------------------------------------
  bumpOperators(n = 1) {
    this.state.operators += n;
  }

  // ---- escrow + claims ----------------------------------------------------
  addEscrow(identityHash, name, mbid, usd) {
    const e = this.state.escrow[identityHash] || { name, mbid, usd: 0, claimed: false, wallet: null };
    e.usd += usd;
    e.name = name || e.name;
    e.mbid = mbid || e.mbid;
    this.state.escrow[identityHash] = e;
    this.state.totals.totalEscrowUsd += usd;
    this.persist();
  }

  claimEscrow(identityHash, wallet) {
    const e = this.state.escrow[identityHash];
    if (!e) return null;
    const released = e.usd;
    e.usd = 0;
    e.claimed = true;
    e.wallet = wallet;
    this.persist();
    return { identityHash, released, wallet, name: e.name, mbid: e.mbid };
  }

  listEscrow() {
    return Object.entries(this.state.escrow).map(([identityHash, e]) => ({ identityHash, ...e }));
  }

  // ---- metrics for the dashboard ------------------------------------------
  getMetrics() {
    const s = this.state;
    const users = new Set();
    const artistPaid = new Map();   // name -> {paidUsd, plays}

    for (const d of s.decisions) {
      users.add(d.user);
      if (d.verdict === 'settled') {
        for (const p of d.payees) {
          const cur = artistPaid.get(p.name) || { name: p.name, paidUsd: 0, plays: 0 };
          cur.paidUsd += p.amountUsd || 0;
          cur.plays += 1;
          artistPaid.set(p.name, cur);
        }
      }
    }

    const topArtists = [...artistPaid.values()]
      .sort((a, b) => b.paidUsd - a.paidUsd)
      .slice(0, 8);

    // sparkline: paid USD bucketed per recent settlement event
    const series = s.settlementSeries.slice(-60).map((p) => p.usd);

    return {
      totals: s.totals,
      uniqueUsers: users.size,
      uniqueArtists: artistPaid.size,
      operators: s.operators,
      escrowOpen: this.listEscrow().filter((e) => e.usd > 0).length,
      topArtists,
      series,
    };
  }

  reset() {
    this.state = emptyState();
    this.persist();
  }
}

// Share one instance across the whole process (survives ESM re-import).
const g = globalThis;
if (!g.__cadenceStore) g.__cadenceStore = new Store();

/** @type {Store} */
export const store = g.__cadenceStore;
export default store;

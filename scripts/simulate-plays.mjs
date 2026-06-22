// ─────────────────────────────────────────────────────────────────────────────
// Cadence — play simulator
//
//   node scripts/simulate-plays.mjs            replay the seed through the core,
//                                              paced, with a live terminal log
//   node scripts/simulate-plays.mjs --fast     no delay between plays
//   node scripts/simulate-plays.mjs --server   instead, trigger /api/simulate on
//                                              a running server so the dashboard
//                                              animates (default URL :3000)
//   node scripts/simulate-plays.mjs --server=http://localhost:4000
//
// Offline-first: the default mode needs no network and no running server.
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import http from 'node:http';

import { reset, processPlay, getMetrics } from '../src/core/index.js';
import { expandSeed } from '../src/core/seedExpand.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SEED_PATH = join(__dirname, '..', 'data', 'seed-plays.json');

const argv = process.argv.slice(2);
const FAST = argv.includes('--fast');
const serverArg = argv.find((a) => a.startsWith('--server'));

const C = {
  reset: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m',
  teal: '\x1b[38;5;79m', amber: '\x1b[38;5;179m', red: '\x1b[38;5;167m',
  gold: '\x1b[38;5;179m', gray: '\x1b[38;5;245m', ink: '\x1b[38;5;250m',
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function verdictColor(v) {
  return v === 'settled' ? C.teal : v === 'escrowed' ? C.amber : C.red;
}

function printDecision(d) {
  const col = verdictColor(d.verdict);
  const tag = d.verdict.toUpperCase().padEnd(8);
  const amt = `$${Number(d.amountUsd || 0).toFixed(6)}`.padStart(10);
  const track = `${d.track?.artist || '?'} — ${d.track?.title || '?'}`;
  const review = d.needsReview ? `${C.gold} ⚑review${C.reset}` : '';
  console.log(`${col}${tag}${C.reset} ${amt}  ${C.ink}${track}${C.reset}  ${C.dim}${d.user}${C.reset}${review}`);
  const payees = (d.payees || []).filter((p) => p.amountUsd > 0 || p.escrowed);
  for (const p of payees) {
    const where = p.escrowed ? `${C.amber}escrow${C.reset}` : `${C.gray}${p.wallet || '—'}${C.reset}`;
    console.log(`         ${C.dim}↳ ${(p.share * 100).toFixed(1)}% ${p.role.padEnd(9)}${C.reset} ${C.gray}$${Number(p.amountUsd).toFixed(6)}${C.reset} ${p.name} ${where}`);
  }
}

function postSimulate(baseUrl) {
  return new Promise((resolve, reject) => {
    const u = new URL('/api/simulate', baseUrl);
    const req = http.request(u, { method: 'POST' }, (res) => {
      let raw = '';
      res.on('data', (c) => (raw += c));
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); } catch { resolve({ raw }); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function main() {
  if (serverArg) {
    const url = serverArg.includes('=') ? serverArg.split('=')[1] : 'http://localhost:3000';
    process.stdout.write(`${C.dim}triggering /api/simulate on ${url} …${C.reset}\n`);
    try {
      const out = await postSimulate(url);
      console.log(`${C.teal}done${C.reset} — server processed ${out.processed} plays. Watch the dashboard.`);
    } catch (e) {
      console.error(`${C.red}could not reach the server.${C.reset} Is it running? (npm start)\n  ${e.message}`);
      process.exit(1);
    }
    return;
  }

  const seed = JSON.parse(readFileSync(SEED_PATH, 'utf8'));
  reset();
  const events = expandSeed(seed, Date.now());

  console.log(`\n${C.bold}Cadence — replaying ${events.length} plays through the agent${C.reset}  ${C.dim}(MOCK · deterministic)${C.reset}\n`);
  for (const ev of events) {
    const d = await processPlay(ev);
    printDecision(d);
    if (!FAST) await sleep(220);
  }

  const m = getMetrics();
  const t = m.totals;
  console.log(`\n${C.bold}Ledger${C.reset}`);
  console.log(`  ${C.teal}paid${C.reset}     $${t.totalPaidUsd.toFixed(6)}  (${t.settledPlays} settled)`);
  console.log(`  ${C.amber}escrow${C.reset}   $${t.totalEscrowUsd.toFixed(6)}  (${m.escrowOpen} artists awaiting a wallet)`);
  console.log(`  ${C.red}withheld${C.reset} ${t.rejectedPlays} plays`);
  console.log(`  ${C.gray}reach${C.reset}    ${m.uniqueArtists} artists · ${m.uniqueUsers} listeners · ${m.operators} batches\n`);
  reset();
}

main().catch((e) => { console.error(e); process.exit(1); });

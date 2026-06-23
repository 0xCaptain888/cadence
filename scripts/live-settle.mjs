// scripts/live-settle.mjs
// Run a LIVE settlement through the Cadence pipeline on Arc Testnet.
// Processes a few plays from the seed and settles them on-chain.

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const __envPath = join(__dirname, '..', '.env');
if (existsSync(__envPath)) {
  const env = readFileSync(__envPath, 'utf8');
  for (const line of env.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq);
    const val = trimmed.slice(eq + 1);
    if (val && !process.env[key]) process.env[key] = val;
  }
}

const { processPlay, reset, getMetrics } = await import('../src/core/index.js');
const { expandSeed } = await import('../src/core/seedExpand.js');
const { createPublicClient, http } = await import('viem');

async function main() {
  console.log('Cadence LIVE settlement — Arc Testnet');
  console.log(`Mode: ${process.env.CADENCE_SETTLEMENT_MODE}`);
  console.log(`Splitter: ${process.env.CADENCE_SPLITTER_ADDRESS}\n`);

  reset();

  // Load seed and expand
  const seed = JSON.parse(readFileSync(join(__dirname, '..', 'data', 'seed-plays.json'), 'utf8'));
  const events = expandSeed(seed, Date.now());

  // Process first 5 events (to keep gas costs low for demo)
  const toProcess = events.slice(0, 5);
  console.log(`Processing ${toProcess.length} plays...\n`);

  const decisions = [];
  for (const ev of toProcess) {
    const decision = await processPlay(ev);
    decisions.push(decision);
    const status = decision.verdict.toUpperCase();
    const amount = decision.amountUsd ? `$${decision.amountUsd.toFixed(6)}` : '$0.000000';
    console.log(`${status.padEnd(10)} ${amount.padEnd(12)} ${decision.track.artist} — ${decision.track.title}`);
    if (decision.txHash) {
      console.log(`           tx: ${decision.txHash}`);
      if (decision.txHash.startsWith('0x') && decision.txHash.length > 10) {
        console.log(`           https://testnet.arcscan.app/tx/${decision.txHash}`);
      }
    }
  }

  // Print metrics
  const metrics = getMetrics();
  console.log(`\n── Ledger ──`);
  console.log(`  paid:     $${metrics.totals.totalPaidUsd.toFixed(6)}  (${metrics.totals.settledPlays} settled)`);
  console.log(`  escrow:   $${metrics.totals.totalEscrowUsd.toFixed(6)}  (${metrics.totals.escrowedPlays} escrowed)`);
  console.log(`  withheld: ${metrics.totals.rejectedPlays} plays`);
  console.log(`  reach:    ${metrics.uniqueArtists} artists · ${metrics.uniqueUsers} listeners`);

  // Check contract balance
  const publicClient = createPublicClient({ transport: http(process.env.CADENCE_RPC_URL) });
  const contractBalance = await publicClient.getBalance({ address: process.env.CADENCE_SPLITTER_ADDRESS });
  console.log(`\nContract balance: ${Number(contractBalance) / 1e18} USDC`);

  console.log('\n✓ LIVE settlement complete');
}

main().catch(err => {
  console.error('Live settlement failed:', err.message || err);
  if (err.stack) console.error(err.stack);
  process.exit(1);
});

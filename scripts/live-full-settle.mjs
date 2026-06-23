// scripts/live-full-settle.mjs
// Run a comprehensive LIVE settlement covering all 9 hard cases on Arc Testnet.

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
  console.log('Cadence LIVE comprehensive settlement — Arc Testnet');
  console.log(`Mode: ${process.env.CADENCE_SETTLEMENT_MODE}`);
  console.log(`Splitter: ${process.env.CADENCE_SPLITTER_ADDRESS}\n`);

  reset();

  const seed = JSON.parse(readFileSync(join(__dirname, '..', 'data', 'seed-plays.json'), 'utf8'));
  const events = expandSeed(seed, Date.now());

  // Process all events
  console.log(`Processing ${events.length} plays...\n`);

  const decisions = [];
  let settledCount = 0, escrowCount = 0, rejectedCount = 0;

  for (const ev of events) {
    const decision = await processPlay(ev);
    decisions.push(decision);

    const status = decision.verdict.toUpperCase().padEnd(10);
    const amount = decision.amountUsd ? `$${decision.amountUsd.toFixed(6)}` : '$0.000000';
    const track = `${decision.track.artist} — ${decision.track.title}`.slice(0, 50);

    if (decision.verdict === 'settled') {
      settledCount++;
      console.log(`${status} ${amount}  ${track}`);
      if (decision.txHash && decision.txHash.length > 10) {
        console.log(`           → tx: ${decision.txHash.slice(0, 20)}...`);
      }
    } else if (decision.verdict === 'escrowed') {
      escrowCount++;
      console.log(`${status} ${amount}  ${track}  ⚑review`);
    } else {
      rejectedCount++;
      console.log(`${status} ${amount}  ${track}  (${decision.fraud?.verdict || 'rejected'})`);
    }
  }

  // Print metrics
  const metrics = getMetrics();
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`Ledger Summary`);
  console.log(`${'═'.repeat(60)}`);
  console.log(`  Paid:      $${metrics.totals.totalPaidUsd.toFixed(6)}  (${metrics.totals.settledPlays} settled)`);
  console.log(`  Escrow:    $${metrics.totals.totalEscrowUsd.toFixed(6)}  (${metrics.totals.escrowedPlays} escrowed)`);
  console.log(`  Withheld:  ${metrics.totals.rejectedPlays} plays rejected`);
  console.log(`  Reach:     ${metrics.uniqueArtists} artists · ${metrics.uniqueUsers} listeners · ${metrics.operators} batches`);

  // Check contract and wallet balances
  const publicClient = createPublicClient({ transport: http(process.env.CADENCE_RPC_URL) });
  const contractBalance = await publicClient.getBalance({ address: process.env.CADENCE_SPLITTER_ADDRESS });
  const wallet2 = await publicClient.getBalance({ address: '0xe6aa96b9f9bfeb83034d151c5a83ac3b75143925' });
  const wallet3 = await publicClient.getBalance({ address: '0xe00dd9ac9c239b22f2fd6ca40e1d32b6d9316fbf' });

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`On-Chain Balances (Arc Testnet)`);
  console.log(`${'═'.repeat(60)}`);
  console.log(`  Contract:  ${Number(contractBalance) / 1e18} USDC`);
  console.log(`  Wallet 2:  ${Number(wallet2) / 1e18} USDC  (artist receiver)`);
  console.log(`  Wallet 3:  ${Number(wallet3) / 1e18} USDC  (artist receiver)`);

  // Show explorer links for some transactions
  const txHashes = decisions.filter(d => d.txHash && d.txHash.length > 10).map(d => d.txHash);
  if (txHashes.length > 0) {
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`Sample Transactions (first 5)`);
    console.log(`${'═'.repeat(60)}`);
    txHashes.slice(0, 5).forEach((tx, i) => {
      console.log(`  ${i + 1}. https://testnet.arcscan.app/tx/${tx}`);
    });
  }

  console.log(`\n✓ LIVE comprehensive settlement complete`);
  console.log(`  Contract: https://testnet.arcscan.app/address/${process.env.CADENCE_SPLITTER_ADDRESS}`);
}

main().catch(err => {
  console.error('Live settlement failed:', err.message || err);
  if (err.stack) console.error(err.stack);
  process.exit(1);
});

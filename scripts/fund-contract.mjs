// scripts/fund-contract.mjs
// Send native USDC to the CadenceSplitterArc contract to fund settlements.

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

import { createWalletClient, createPublicClient, http, parseUnits } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const OPERATOR_KEY = process.env.CADENCE_OPERATOR_PRIVATE_KEY;
const SPLITTER_ADDRESS = process.env.CADENCE_SPLITTER_ADDRESS;
const RPC_URL = process.env.CADENCE_RPC_URL || 'https://rpc.testnet.arc.network';
const FUND_AMOUNT = process.env.FUND_AMOUNT || '1.0'; // 1 USDC (18 decimals)

async function main() {
  console.log('Funding CadenceSplitterArc contract');
  console.log(`Contract: ${SPLITTER_ADDRESS}`);
  console.log(`Amount: ${FUND_AMOUNT} USDC`);

  const account = privateKeyToAccount(OPERATOR_KEY);
  const publicClient = createPublicClient({ transport: http(RPC_URL) });
  const walletClient = createWalletClient({ account, transport: http(RPC_URL) });

  // Check balance before
  const balanceBefore = await publicClient.getBalance({ address: account.address });
  console.log(`\nOperator balance: ${Number(balanceBefore) / 1e18} USDC`);

  const contractBalanceBefore = await publicClient.getBalance({ address: SPLITTER_ADDRESS });
  console.log(`Contract balance: ${Number(contractBalanceBefore) / 1e18} USDC`);

  // Send USDC to contract (it has a receive() function)
  const value = parseUnits(FUND_AMOUNT, 18);
  const txHash = await walletClient.sendTransaction({
    to: SPLITTER_ADDRESS,
    value,
  });
  console.log(`\nFunding tx: ${txHash}`);

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  console.log(`Confirmed in block: ${receipt.blockNumber}`);

  // Check balances after
  const balanceAfter = await publicClient.getBalance({ address: account.address });
  const contractBalanceAfter = await publicClient.getBalance({ address: SPLITTER_ADDRESS });
  console.log(`\nOperator balance: ${Number(balanceAfter) / 1e18} USDC`);
  console.log(`Contract balance: ${Number(contractBalanceAfter) / 1e18} USDC`);
  console.log(`\n✓ Contract funded successfully`);
  console.log(`  Explorer: https://testnet.arcscan.app/tx/${txHash}`);
}

main().catch(err => {
  console.error('Fund failed:', err.message || err);
  process.exit(1);
});

// scripts/deploy.mjs
// Compile CadenceSplitterArc with solc and deploy to Arc Testnet via viem.

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// ── Load .env ────────────────────────────────────────────────────────────────
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

import { createPublicClient, createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

// ── Arc Testnet config ───────────────────────────────────────────────────────
const ARC_RPC = process.env.CADENCE_RPC_URL || 'https://rpc.testnet.arc.network';
const ARC_CHAIN_ID = Number(process.env.CADENCE_CHAIN_ID || 5042002);
const OPERATOR_KEY = process.env.CADENCE_OPERATOR_PRIVATE_KEY;
const IDENTITY_REGISTRY = process.env.ERC8004_REGISTRY || '0x8004A818BFB912233c491871b3d84c89A494BD9e';

if (!OPERATOR_KEY) {
  console.error('CADENCE_OPERATOR_PRIVATE_KEY is required');
  process.exit(1);
}

// ── Compile ──────────────────────────────────────────────────────────────────
async function compileContract() {
  const solc = (await import('solc')).default;
  const source = readFileSync(join(__dirname, '..', 'contracts', 'CadenceSplitterArc.sol'), 'utf8');

  const input = {
    language: 'Solidity',
    sources: { 'CadenceSplitterArc.sol': { content: source } },
    settings: {
      outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } },
      optimizer: { enabled: true, runs: 200 },
    },
  };

  const output = JSON.parse(solc.compile(JSON.stringify(input)));

  // Check for errors
  if (output.errors) {
    const errs = output.errors.filter(e => e.severity === 'error');
    if (errs.length) {
      console.error('Compilation errors:');
      errs.forEach(e => console.error(e.formattedMessage));
      process.exit(1);
    }
  }

  const contract = output.contracts['CadenceSplitterArc.sol']['CadenceSplitterArc'];
  return {
    abi: contract.abi,
    bytecode: '0x' + contract.evm.bytecode.object,
  };
}

// ── Deploy ───────────────────────────────────────────────────────────────────
async function main() {
  console.log('CadenceSplitterArc — Arc Testnet deployment');
  console.log(`RPC: ${ARC_RPC}`);
  console.log(`Chain ID: ${ARC_CHAIN_ID}`);

  const account = privateKeyToAccount(OPERATOR_KEY);
  console.log(`Operator: ${account.address}`);

  const publicClient = createPublicClient({
    transport: http(ARC_RPC),
  });

  const walletClient = createWalletClient({
    account,
    transport: http(ARC_RPC),
  });

  // Check balance
  const balance = await publicClient.getBalance({ address: account.address });
  console.log(`Operator balance: ${Number(balance) / 1e6} USDC`);

  if (balance === 0n) {
    console.error('Operator has zero balance. Please fund the wallet first.');
    process.exit(1);
  }

  // Compile
  console.log('\nCompiling CadenceSplitterArc.sol...');
  const { abi, bytecode } = await compileContract();
  console.log(`Bytecode size: ${(bytecode.length - 2) / 2} bytes`);
  console.log(`ABI functions: ${abi.filter(a => a.type === 'function').length}`);

  // Deploy
  console.log('\nDeploying...');
  const hash = await walletClient.deployContract({
    abi,
    bytecode,
    args: [IDENTITY_REGISTRY, account.address],
  });
  console.log(`Deploy tx: ${hash}`);

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  const contractAddress = receipt.contractAddress;
  console.log(`\n✓ Contract deployed at: ${contractAddress}`);
  console.log(`  Block: ${receipt.blockNumber}`);
  console.log(`  Gas used: ${receipt.gasUsed}`);
  console.log(`  Explorer: https://testnet.arcscan.app/address/${contractAddress}`);

  // Output for .env
  console.log('\n── Add to .env ──');
  console.log(`CADENCE_SPLITTER_ADDRESS=${contractAddress}`);

  return contractAddress;
}

main().catch(err => {
  console.error('Deploy failed:', err.message || err);
  process.exit(1);
});

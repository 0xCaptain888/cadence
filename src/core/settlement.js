// src/core/settlement.js
// -----------------------------------------------------------------------------
// Turns an attribution decision into money movement. This is the PORTABLE
// SETTLEMENT CORE — it takes (amount, payees, timestamp) and produces a
// settlement result, with no knowledge of music. The same function settles an
// Owncast watch-second or a Mastodon boost; only the source adapter changes.
//
//   • mock — deterministic synthetic tx hashes, escrow bookkeeping, no chain.
//   • real (Arc native) — calls CadenceSplitterArc.settle() directly on Arc
//            Testnet where USDC is the native gas token. Each batch is a single
//            on-chain transaction that pays wallet-holders and escrows the rest.
//   • real (Circle Gateway) — builds EIP-3009 TransferWithAuthorization per
//            payee and submits a batch to Circle's Gateway nanopayments endpoint.
//            Used when CADENCE_USDC_ADDRESS is a real ERC-20 address.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { config } from './config.js';
import { store } from './store.js';

function synthHash(seed) {
  return '0x' + createHash('sha256').update(seed).digest('hex');
}

/** Batches settle in 10-second windows (amortises gas / API calls). */
function batchIdFor(ts) {
  return 'batch_' + Math.floor(ts / 10000);
}

// ── CadenceSplitterArc minimal ABI ───────────────────────────────────────────
const SPLITTER_ARC_ABI = [
  {
    type: 'function', name: 'settle', stateMutability: 'payable',
    inputs: [
      { name: 'batchId', type: 'bytes32' },
      { name: 'payouts', type: 'tuple[]', components: [
        { name: 'payee', type: 'address' },
        { name: 'identityHash', type: 'bytes32' },
        { name: 'amount', type: 'uint256' },
      ]},
    ],
    outputs: [],
  },
  {
    type: 'function', name: 'available', stateMutability: 'view',
    inputs: [], outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function', name: 'totalPaid', stateMutability: 'view',
    inputs: [], outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function', name: 'totalEscrow', stateMutability: 'view',
    inputs: [], outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function', name: 'batchCount', stateMutability: 'view',
    inputs: [], outputs: [{ name: '', type: 'uint256' }],
  },
];

/**
 * @param {number} amountUsd  total to distribute across payees
 * @param {Object[]} payees   each with .share and either .wallet or escrow
 * @param {number} ts
 * @returns {Promise<{batchId, txHash, mode, splits, escrowedUsd, paidUsd}>}
 */
export async function settle(amountUsd, payees, ts) {
  const batchId = batchIdFor(ts);
  const splits = payees.map((p) => {
    const amt = Number((amountUsd * p.share).toFixed(6));
    return {
      name: p.name,
      role: p.role,
      share: p.share,
      amountUsd: amt,
      wallet: p.wallet || null,
      escrowed: Boolean(p.routedToEscrow),
      identityHash: p.identityHash,
    };
  });

  if (config.isReal) {
    if (config.nativeUsdc) {
      return settleArcNative(amountUsd, splits, payees, ts, batchId);
    }
    return settleReal(amountUsd, splits, payees, ts, batchId);
  }

  // ---- MOCK settlement -----------------------------------------------------
  let escrowedUsd = 0;
  let paidUsd = 0;
  for (const s of splits) {
    if (s.escrowed) {
      escrowedUsd += s.amountUsd;
      store.addEscrow(s.identityHash, s.name, payees.find((p) => p.identityHash === s.identityHash)?.mbid, s.amountUsd);
    } else {
      paidUsd += s.amountUsd;
    }
  }
  store.bumpOperators(1);
  const txHash = synthHash(`${batchId}:${ts}:${amountUsd}:${splits.map((s) => s.name).join(',')}`);
  return { batchId, txHash, mode: 'mock', splits, escrowedUsd: Number(escrowedUsd.toFixed(6)), paidUsd: Number(paidUsd.toFixed(6)) };
}

/**
 * LIVE settlement on Arc Testnet via CadenceSplitterArc contract.
 * USDC is the native gas token, so we call settle() with msg.value.
 */
async function settleArcNative(amountUsd, splits, payees, ts, batchId) {
  const missing = [];
  if (!config.rpcUrl) missing.push('CADENCE_RPC_URL');
  if (!config.splitterAddress) missing.push('CADENCE_SPLITTER_ADDRESS');
  if (!config.operatorKey) missing.push('CADENCE_OPERATOR_PRIVATE_KEY');
  if (missing.length) {
    throw new Error(
      `LIVE settlement requires: ${missing.join(', ')}. ` +
      'Set them in .env or switch CADENCE_SETTLEMENT_MODE=mock.',
    );
  }

  const { createWalletClient, createPublicClient, http, parseUnits } = await import('viem');
  const { privateKeyToAccount } = await import('viem/accounts');

  const account = privateKeyToAccount(config.operatorKey);
  const publicClient = createPublicClient({ transport: http(config.rpcUrl) });
  const walletClient = createWalletClient({ account, transport: http(config.rpcUrl) });

  // Build payout structs: wallet holders get paid, escrow ones get address(0)
  // Arc Testnet native token uses 18 decimals (not 6 like standard USDC)
  const payouts = splits
    .filter(s => s.amountUsd > 0)
    .map(s => ({
      payee: s.escrowed ? '0x0000000000000000000000000000000000000000' : s.wallet,
      identityHash: s.identityHash.padEnd(66, '0').slice(0, 66), // ensure bytes32
      amount: parseUnits(String(s.amountUsd), 18), // Arc native: 18 decimals
    }));

  if (payouts.length === 0) {
    // Nothing to settle on-chain (all zero amounts)
    let escrowedUsd = 0, paidUsd = 0;
    for (const s of splits) {
      if (s.escrowed) { escrowedUsd += s.amountUsd; store.addEscrow(s.identityHash, s.name, null, s.amountUsd); }
      else paidUsd += s.amountUsd;
    }
    store.bumpOperators(1);
    return { batchId, txHash: synthHash(batchId), mode: 'real', splits, escrowedUsd: Number(escrowedUsd.toFixed(6)), paidUsd: Number(paidUsd.toFixed(6)) };
  }

  // Total value to send = sum of all payout amounts
  const totalValue = payouts.reduce((sum, p) => sum + p.amount, 0n);

  // Convert batchId to bytes32
  const batchIdBytes32 = ('0x' + Buffer.from(batchId).toString('hex').padEnd(64, '0')).slice(0, 66);

  // Call settle() on the contract
  const txHash = await walletClient.writeContract({
    address: config.splitterAddress,
    abi: SPLITTER_ARC_ABI,
    functionName: 'settle',
    args: [batchIdBytes32, payouts],
    value: totalValue,
  });

  // Wait for confirmation
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

  // Update ledger
  let escrowedUsd = 0;
  let paidUsd = 0;
  for (const s of splits) {
    if (s.escrowed) {
      escrowedUsd += s.amountUsd;
      store.addEscrow(s.identityHash, s.name, payees.find((p) => p.identityHash === s.identityHash)?.mbid, s.amountUsd);
    } else {
      paidUsd += s.amountUsd;
    }
  }
  store.bumpOperators(1);

  return {
    batchId,
    txHash,
    mode: 'real',
    splits,
    escrowedUsd: Number(escrowedUsd.toFixed(6)),
    paidUsd: Number(paidUsd.toFixed(6)),
    blockNumber: Number(receipt.blockNumber),
    gasUsed: receipt.gasUsed.toString(),
    explorer: `https://testnet.arcscan.app/tx/${txHash}`,
  };
}

/**
 * LIVE settlement on Arc via Circle Gateway (EIP-3009 path).
 * Used when CADENCE_USDC_ADDRESS is a real ERC-20 address (not native).
 */
async function settleReal(amountUsd, splits, payees, ts, batchId) {
  const missing = [];
  if (!config.rpcUrl) missing.push('CADENCE_RPC_URL');
  if (!config.usdcAddress) missing.push('CADENCE_USDC_ADDRESS');
  if (!config.operatorKey) missing.push('CADENCE_OPERATOR_PRIVATE_KEY');
  if (!config.circleApiKey) missing.push('CIRCLE_API_KEY');
  if (missing.length) {
    throw new Error(
      `LIVE settlement requires: ${missing.join(', ')}. ` +
      'Set them in .env or switch CADENCE_SETTLEMENT_MODE=mock.',
    );
  }

  // Dynamic import keeps viem optional for the mock-mode default.
  const { createWalletClient, http, parseUnits } = await import('viem');
  const { privateKeyToAccount } = await import('viem/accounts');

  const account = privateKeyToAccount(config.operatorKey);
  const client = createWalletClient({ account, transport: http(config.rpcUrl) });

  // Build one EIP-3009 TransferWithAuthorization per non-escrow payee.
  const authorizations = [];
  for (const s of splits) {
    if (s.escrowed || s.amountUsd <= 0) continue;
    const value = parseUnits(String(s.amountUsd), 6); // USDC has 6 decimals
    const nonce = synthHash(`${batchId}:${s.name}:${ts}`);
    const validAfter = 0n;
    const validBefore = BigInt(Math.floor(ts / 1000) + 3600);
    const typedData = {
      domain: { name: 'USD Coin', version: '2', chainId: config.chainId, verifyingContract: config.usdcAddress },
      types: {
        TransferWithAuthorization: [
          { name: 'from', type: 'address' },
          { name: 'to', type: 'address' },
          { name: 'value', type: 'uint256' },
          { name: 'validAfter', type: 'uint256' },
          { name: 'validBefore', type: 'uint256' },
          { name: 'nonce', type: 'bytes32' },
        ],
      },
      primaryType: 'TransferWithAuthorization',
      message: {
        from: account.address, to: s.wallet, value,
        validAfter, validBefore, nonce,
      },
    };
    const signature = await client.signTypedData(typedData);
    authorizations.push({ ...typedData.message, value: value.toString(), validAfter: '0', validBefore: validBefore.toString(), signature, payee: s.name });
  }

  // Submit the batch to Circle's Gateway nanopayments endpoint.
  const res = await fetch(`${config.circleGatewayUrl}/nanopayments/settlements`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${config.circleApiKey}` },
    body: JSON.stringify({ batchId, token: config.usdcAddress, chainId: config.chainId, authorizations }),
  });
  if (!res.ok) throw new Error(`Circle Gateway ${res.status}: ${await res.text()}`);
  const out = await res.json();

  let escrowedUsd = 0;
  let paidUsd = 0;
  for (const s of splits) {
    if (s.escrowed) { escrowedUsd += s.amountUsd; store.addEscrow(s.identityHash, s.name, null, s.amountUsd); }
    else paidUsd += s.amountUsd;
  }
  store.bumpOperators(1);

  return {
    batchId,
    txHash: out.txHash || out.transactionHash || synthHash(batchId),
    mode: 'real',
    splits,
    escrowedUsd: Number(escrowedUsd.toFixed(6)),
    paidUsd: Number(paidUsd.toFixed(6)),
    gateway: out,
  };
}

export default settle;

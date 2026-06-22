// src/core/settlement.js
// -----------------------------------------------------------------------------
// Turns an attribution decision into money movement. This is the PORTABLE
// SETTLEMENT CORE — it takes (amount, payees, timestamp) and produces a
// settlement result, with no knowledge of music. The same function settles an
// Owncast watch-second or a Mastodon boost; only the source adapter changes.
//
//   • mock — deterministic synthetic tx hashes, escrow bookkeeping, no chain.
//   • real — builds one EIP-3009 TransferWithAuthorization per payee and submits
//            a batch to Circle's Gateway nanopayments endpoint on Arc. Loaded
//            via dynamic import so `viem` is only required in live mode.
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
 * LIVE settlement on Arc via Circle Gateway. Kept self-contained and only
 * reached when CADENCE_SETTLEMENT_MODE=real. Throws a helpful error if the
 * operator hasn't supplied the required configuration.
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

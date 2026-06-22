// src/core/registry.js
// -----------------------------------------------------------------------------
// Maps resolved payees to payable wallets. This is the "MusicBrainz payee
// registry" idea from Canteen's Requests for Payments Founders (#2): an
// attribution id alone isn't payable — it needs a wallet. Artists who haven't
// registered a wallet don't lose their money; their share is escrowed against
// an ERC-8004-style identity hash and can be claimed later.
// -----------------------------------------------------------------------------

import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REGISTRY_FILE = join(__dirname, '..', '..', 'data', 'registry.json');

let REGISTRY = { artists: {} };
try {
  if (existsSync(REGISTRY_FILE)) REGISTRY = JSON.parse(readFileSync(REGISTRY_FILE, 'utf8'));
} catch { /* empty registry is fine */ }

function lc(s) { return String(s || '').toLowerCase().trim(); }

/** Stable identity hash for a payee (used as the escrow key + ERC-8004 id). */
export function identityHash(payee) {
  const basis = payee.mbid ? `mbid:${payee.mbid}` : `name:${lc(payee.name)}`;
  return '0x' + createHash('sha256').update(basis).digest('hex').slice(0, 40);
}

function lookup(payee) {
  const artists = REGISTRY.artists || {};
  // by mbid first
  if (payee.mbid && artists[payee.mbid]) return artists[payee.mbid];
  // by exact name key
  for (const entry of Object.values(artists)) {
    if (lc(entry.name) === lc(payee.name)) return entry;
    if (Array.isArray(entry.aliases) && entry.aliases.some((a) => lc(a) === lc(payee.name))) return entry;
  }
  return null;
}

/**
 * Attach a wallet to each payee, or route to escrow.
 * @returns {Object[]} payees enriched with wallet | escrow info
 */
export function mapWallets(payees) {
  return payees.map((p) => {
    const entry = lookup(p);
    const idHash = identityHash(p);
    if (entry && entry.wallet) {
      return {
        ...p,
        wallet: entry.wallet,
        currency: entry.currency || 'USDC',
        identityHash: idHash,
        routedToEscrow: false,
        erc8004Claimed: Boolean(entry.erc8004 && entry.erc8004.claimed),
        agentId: entry.erc8004 && entry.erc8004.agentId,
      };
    }
    return {
      ...p,
      wallet: null,
      currency: 'USDC',
      identityHash: idHash,
      routedToEscrow: true,
      erc8004Claimed: false,
    };
  });
}

/** Used by /api/claim to release escrow once an artist proves their identity. */
export function resolveClaim({ mbid, name, wallet }) {
  const idHash = identityHash({ mbid, name });
  return { identityHash: idHash, wallet, name, mbid: mbid || null };
}

export function getRegistry() { return REGISTRY; }

export default mapWallets;

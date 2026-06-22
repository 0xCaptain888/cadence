// src/core/types.js
// -----------------------------------------------------------------------------
// Shared type definitions (JSDoc). Pure documentation — no runtime cost. These
// describe the data that flows through the portable attribution + settlement
// core, independent of which source produced it (Subsonic today; Owncast /
// Mastodon tomorrow).
// -----------------------------------------------------------------------------

/**
 * A normalised value-event. Every source adapter converts its native signal
 * (a Subsonic scrobble, an Owncast watch-second, a Mastodon boost) into this
 * one shape, so the core never needs to know where it came from.
 *
 * @typedef {Object} CadenceEvent
 * @property {'play'|'stream'|'reshare'} type   Kind of attention.
 * @property {string} mediaFileId               Stable id of the played media.
 * @property {string} userId                    The listener who funds the pool.
 * @property {number} timestamp                 Unix ms.
 * @property {number} playedSeconds             Seconds of genuine attention.
 * @property {number} trackDuration             Full media duration (seconds).
 * @property {string} clientId                  Client/app identifier (fraud signal).
 * @property {Object} [raw]                     Original payload (debugging).
 * @property {string} source                    Adapter name ('subsonic', ...).
 */

/**
 * A resolved credit on a work, before money is attached.
 * @typedef {Object} Credit
 * @property {string} name
 * @property {'performer'|'writer'|'producer'|'featured'} role
 * @property {string} [mbid]                    MusicBrainz id when known.
 */

/**
 * A payee with a normalised share in [0,1]. Sum of payee.share === 1.
 * @typedef {Object} Payee
 * @property {string} name
 * @property {'performer'|'writer'|'producer'|'featured'} role
 * @property {string} [mbid]
 * @property {number} share                     Normalised, sums to 1 across payees.
 * @property {string|null} [wallet]             Resolved wallet, or null -> escrow.
 * @property {string} [currency]                'USDC'.
 * @property {string} [identityHash]            ERC-8004 style identity hash.
 * @property {boolean} [routedToEscrow]
 * @property {boolean} [erc8004Claimed]
 * @property {number} [amountUsd]               Filled in at settlement.
 * @property {boolean} [escrowed]
 */

/**
 * The agent's full decision for a single event — the artifact a reviewer reads.
 * @typedef {Object} Decision
 * @property {string} id
 * @property {number} timestamp
 * @property {'settled'|'escrowed'|'rejected'} verdict
 * @property {{title:string, artist:string, mbid:(string|null)}} track
 * @property {string} user
 * @property {number} amountUsd
 * @property {Payee[]} payees
 * @property {string[]} reasoning               Tagged, human-readable trace.
 * @property {boolean} needsReview
 * @property {number} confidence                0..1
 * @property {string} backend                   'deterministic' | 'anthropic'
 * @property {{verdict:string, risk:number}} fraud
 * @property {string|null} txHash
 * @property {string|null} batchId
 */

export {};

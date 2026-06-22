# Architecture

Cadence is one idea executed cleanly: **attribution metadata is settlement
logic.** If you can say *who made this, in what role, and was this listen real*,
you can pay the right people automatically. Everything below serves that.

## The shape of the system

```
        ┌──────────────┐   scrobble / stream / reshare
 source │  SUBSONIC    │──────────────┐
adapters│  OWNCAST*    │              │   * drafted, same interface
        │  MASTODON*   │              ▼
        └──────────────┘      ┌───────────────┐
                              │   adapters/   │  normalize → CadenceEvent
                              └──────┬────────┘
                                     ▼
   ════════════════  PORTABLE SETTLEMENT CORE  ════════════════
                                     ▼
   musicbrainz   ┌──────────────────────────────────┐
   (cache/live)→ │ 1. resolveMetadata   what is this │
                 ├──────────────────────────────────┤
                 │ 2. assessFraud       was it real  │ skip / wash / bot → reject
                 ├──────────────────────────────────┤
                 │ 3. resolvePayees     who + split  │ ← the brain (reasoner)
                 ├──────────────────────────────────┤
                 │ 4. mapWallets        where to pay │ registry + ERC-8004 id
                 ├──────────────────────────────────┤
                 │ 5. allocate          how much     │ per-listener budget cap
                 ├──────────────────────────────────┤
                 │ 6. settle            move USDC     │ MOCK ┄┄ or ┄┄ LIVE
                 └──────────────────────────────────┘
                                     ▼
                              ┌───────────────┐
                              │   Decision    │  verdict, payees[], reasoning[],
                              │   (+ ledger)  │  confidence, txHash, batchId
                              └──────┬────────┘
                     ┌───────────────┼───────────────┐
                     ▼               ▼               ▼
              dashboard (SSE)   /api/* JSON     CadenceSplitter.sol
                                                (Arc · Circle Gateway)
```

The boxed core has **no idea what a song is.** It consumes a `CadenceEvent` and
emits a `Decision`. Music is simply the first source plugged into it.

## The decision pipeline

Each play runs through `processPlay(event)` in `src/core/index.js`, which calls
six small, independently testable steps. The output is a single `Decision`
object carrying its own audit trail.

1. **`resolveMetadata`** (`musicbrainz.js`) — turn a media id / loose title into
   `{ title, artist, credits[], releaseType, isLive, isRemix, … }`. Works from a
   bundled cache offline; can hit the live MusicBrainz API when enabled. Includes
   a token-overlap fuzzy matcher so `"beatles hey jude"` resolves to The Beatles.

2. **`assessFraud`** (`antifraud.js`) — decide if the listen earns money at all.
   Returns `ok | skip | wash | bot` with a risk score and human-readable
   evidence. A 12-second play is a skip; 24 replays in an hour is wash trading;
   replay-bot client hints are bot traffic. Rejected here, the play is recorded
   but pays nothing.

3. **`resolvePayees`** (`reasoner.js`) — **the brain.** Given the metadata, decide
   the payee set and the split, and how confident it is. Deterministic branches
   handle the cases that have a right answer (public-domain classical → the
   performer; "Various Artists" → recover the real artist; a remix → split the
   lineage; an unknown recording → escrow and flag for review). When a key is
   present, genuinely ambiguous cases can be escalated to a model that must
   return strict JSON; any error falls back to the deterministic path, so the
   agent is never stuck. Every branch appends to a `reasoning[]` trace.

4. **`mapWallets`** (`registry.js`) — attach a wallet to each payee from the payee
   registry, computing a stable ERC-8004 `identityHash = sha256(mbid | name)`.
   Payees with no wallet are marked `routedToEscrow`.

5. **`allocate`** (`budget.js`) — draw a micro-amount from *this listener's* own
   monthly pool, capped by what they have left. This is the core economic idea:
   you fund your own listening, and it is divided only across the artists you
   actually played.

6. **`settle`** (`settlement.js`) — the **portable settlement core**. In MOCK mode
   it produces a deterministic synthetic tx hash and updates the in-memory
   ledger, including escrow. In LIVE mode it signs an EIP-3009
   `TransferWithAuthorization` per paid artist and submits one batch to Circle
   Gateway on Arc; escrowed shares are recorded for later claim. The function
   signature and the `Decision` it feeds are identical in both modes — only the
   last step changes.

## The Decision object

```jsonc
{
  "id": "…",
  "verdict": "settled" | "escrowed" | "rejected",
  "track":   { "title": "…", "artist": "…", "mbid": "…" },
  "user":    "u_clara",
  "amountUsd": 0.002,
  "payees": [
    { "name": "…", "role": "performer", "share": 0.5,
      "amountUsd": 0.001, "wallet": "0x…", "escrowed": false,
      "identityHash": "0x…" }
  ],
  "reasoning": [
    "[meta] resolved …",
    "[fraud] genuine listen (risk 0.02)",
    "[payee] role-weighted split across 3 credits",
    "[wallet] 2 paid, 1 → escrow (no wallet)",
    "[budget] drew $0.002 from u_clara (remaining $4.91)",
    "[settle] mode=mock batch=… tx=…"
  ],
  "needsReview": false,
  "confidence": 0.93,
  "fraud": { "verdict": "ok", "risk": 0.02 },
  "txHash": "0x…",
  "batchId": "batch_…"
}
```

`verdict` is `escrowed` only when **every** payee was escrowed; a mixed batch is
`settled` with a note that part was held. The `reasoning[]` array is what the
dashboard expands under each row — the agent shows its work.

## Why "portable" is a real claim, not a slogan

The only music-aware file in the core is `musicbrainz.js`. Swap it and the source
adapter, and the same five remaining steps settle anything attributable:

- **Owncast** live audio → pay the streamer and featured guests per minute.
- **Mastodon / ActivityPub** boosts → pay the original author of work that spread.

The adapters for both already exist as typed stubs (`src/core/adapters/`), each
implementing the same `normalize(raw) → CadenceEvent` contract the Subsonic
adapter does. *Build once, distribute three ways.*

## Modes

| | MOCK (default) | LIVE |
|---|---|---|
| network | none | Arc RPC + Circle Gateway |
| secrets | none | operator key + Circle key |
| settlement | synthetic tx hash | EIP-3009 batch on Arc |
| determinism | fully deterministic | real funds |
| use | demo, tests, review | production |

MOCK is not a fake: it runs the entire pipeline and the real ledger math. Only
the final `settle` step swaps a synthetic hash for a chain transaction. That is
why `npm run verify` can assert end-to-end correctness with no network.

## Files

```
src/core/
  config.js        env-driven config, money model, role weights, fraud thresholds
  types.js         JSDoc typedefs for events, credits, payees, decisions
  store.js         in-memory + persisted ledger; metrics for the dashboard
  musicbrainz.js   metadata resolution (cache/live) + fuzzy matcher   ← music-aware
  antifraud.js     skip / wash / bot detection
  reasoner.js      the brain: payee set + split + confidence (+ optional LLM)
  registry.js      wallet mapping + ERC-8004 identity hashing
  budget.js        per-listener pool allocation
  settlement.js    portable settle(): MOCK hash or LIVE EIP-3009 batch
  index.js         processPlay(): the pipeline, assembling the Decision
  seedExpand.js    expand the compact seed into time-ordered events
  adapters/        subsonic (live) · owncast* · mastodon*  (* drafted stubs)
server.mjs         zero-dep http: static dashboard + JSON APIs + SSE + x402
public/            the dashboard (no framework, no build, no storage)
contracts/         CadenceSplitter.sol — on-chain splitter + escrow + claim
scripts/           verify-core (assertions) · simulate-plays (paced replay)
```

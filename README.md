<div align="center">

# Cadence

**Every listen, settled to the artist who earned it.**

An autonomous royalty agent for self-hosted music. It watches what you actually
play, decides *who* should be paid, *how* to split it, and *whether* the listen
was even real — then settles the answer in USDC nanopayments on Arc.

`MOCK mode runs offline with zero install and zero secrets.`

</div>

---

## The idea in one line

Streaming royalties are a pooled average: your $11 is poured into a global pot and
paid out by total market share, so most of it leaves with the top 1%. Cadence
inverts that. **You fund your own pool, and it is divided only across the artists
you actually listened to** — per listen, in amounts as small as a fraction of a
cent, the moment the play happens.

Doing that for real means answering three messy questions on every single play,
automatically. That is the agent.

## What makes it an agent, not a script

For each listen, Cadence reaches a *judgement* and shows its work:

- **Who gets paid** — resolve loose metadata to real credits. "Various Artists"
  on a compilation becomes the actual performer and writers. `"beatles hey jude"`
  with a typo and no id resolves to The Beatles. A public-domain Bach recording
  pays the *performer*, because Bach isn't collecting.
- **How to split it** — role-weighted across performer / writer / producer /
  featured, normalised to the cent. A remix splits its lineage between the
  remixer and the original artist.
- **Whether to pay at all** — a 12-second skip earns nothing. Twenty-four replays
  in an hour is wash trading and gets withheld after the genuine early plays.
  Replay-bot traffic is rejected.

Open any row in the dashboard's **decision tape** and you see the full reasoning
trace — `[meta] [fraud] [payee] [wallet] [budget] [settle]` — the exact path the
agent took, including the cases it routed to escrow and flagged for review
because it *wasn't sure*. An honest agent says "I don't know"; Cadence escrows
the money and says so.

When a key is present, genuinely ambiguous cases are escalated to a model that
must return strict JSON; on any error it falls back to the deterministic path, so
the agent never gets stuck. With no key, it is fully deterministic and offline.

## 30-second quickstart

No install. No build. No API keys. No wallet.

```bash
npm start
# → open http://localhost:3000
# → click "Run simulation"
```

You'll watch the agent rule on a day of listening in real time: classical, a
live bootleg, a remix, a "Various Artists" compilation, a typo'd track, a
wash-trading bot, a skip, a long-tail artist with no wallet, and a clean
four-way split. The ledger fills in — paid, held in escrow, withheld — and every
decision is inspectable.

Want to see the same thing in your terminal?

```bash
npm run simulate     # paced replay through the core, with a live log
npm run verify       # runs the core against 9 hard cases + ledger invariants
```

`npm run verify` is the proof the engine works: it processes the full seed and
asserts every case resolves correctly and the books reconcile — **with no
network**, because MOCK mode runs the real pipeline and the real ledger math, and
only swaps the final on-chain step for a deterministic synthetic hash.

## The nine cases it gets right

| # | Listen | Ruling |
|---|--------|--------|
| 1 | Glenn Gould plays Bach (public domain) | **settled** — 100% to the performer; the composition is PD |
| 2 | Radiohead live bootleg, no wallet | **escrowed** + flagged — low confidence, money held |
| 3 | "Various Artists" compilation track | **settled** — recovered Dua Lipa + writers; no "Various Artists" payee |
| 4 | A remix of a small-label track | **settled (partial)** — remixer paid, original side escrowed |
| 5 | `"beatles hey jude"` (typo, no id) | **settled** — fuzzy-matched to The Beatles |
| 6 | 24 replays by one user in an hour | **withheld** — wash detected, genuine early plays let through |
| 7 | A 12-second play | **withheld** — skip |
| 8 | Long-tail artist, identity but no wallet | **escrowed** — held under an ERC-8004 identity hash |
| 9 | A clean four-credit track | **settled** — role-weighted four-way split |

These are encoded as assertions in `scripts/verify-core.mjs`. They either pass or
the build is wrong.

## How it uses the Circle stack

- **USDC on Arc** — the settlement asset, paid in nanopayment-sized amounts.
  On Arc Testnet, USDC is the native gas token (18 decimals).
- **CadenceSplitterArc** — on-chain settlement contract deployed at
  [`0x5bf261603745b2b5d541e7face3020cdfd59f011`](https://testnet.arcscan.app/address/0x5bf261603745b2b5d541e7face3020cdfd59f011)
  on Arc Testnet. Pays artists with wallets, escrows the rest.
- **Circle Gateway / nanopayments** — in LIVE mode with ERC-20 USDC, paid artists
  are settled as EIP-3009 `TransferWithAuthorization` batches submitted to Gateway.
  (`src/core/settlement.js`)
- **Agent / programmable wallets** — the settlement operator signs and submits on
  the agent's behalf; artists receive to their own wallets from the registry.
- **x402** — two endpoints (`/api/royalty-data`, `/api/claim`) implement the
  HTTP 402 payment-required handshake: a challenge with an `accepts[]` quote, then
  release on a presented `X-PAYMENT`. (`server.mjs`)
- **ERC-8004 identity** — escrow for artists with no wallet is keyed by a stable
  identity hash; `CadenceSplitterArc.claim()` releases it only to the address that
  controls that identity per the IdentityRegistry at
  `0x8004A818BFB912233c491871b3d84c89A494BD9e`. (`contracts/CadenceSplitterArc.sol`)

LIVE mode is fully wired and env-gated. The repo ships in MOCK so a reviewer can
click around immediately; flip `CADENCE_SETTLEMENT_MODE=real` with the keys in
`.env.example` to settle on testnet. See **[PREREQUISITES.md](./PREREQUISITES.md)**.

## Live settlement proof (Arc Testnet)

Cadence has completed a full LIVE settlement on Arc Testnet:

```
44 plays processed
37 settled   → $0.074000 paid to artists on-chain
2  escrowed  → $0.005000 held (Radiohead, Sofia Reyes Quartet — no wallets)
5  rejected  → 4 wash-trading + 1 skip detected and withheld

18 artists · 4 listeners · 39 batches
```

**On-chain evidence:**
- Contract: [`0x5bf261...f011`](https://testnet.arcscan.app/address/0x5bf261603745b2b5d541e7face3020cdfd59f011)
- Deploy tx: [`0xe77ef8...7304`](https://testnet.arcscan.app/tx/0xe77ef82c97726f8154dd4bef9e9116b5b67f1ae79db8d277ee5b52a5116c7304)
- Fund tx: [`0x2ba0b7...811`](https://testnet.arcscan.app/tx/0x2ba0b7e7814f7a9e299b71d0379dfd14bb90b435bc43603cf829cc15afe7c811)
- Sample settlement txs:
  [1](https://testnet.arcscan.app/tx/0x7d34e6a5c3a139f3f387b309966212c7540442cd32c0029798522b3a74fcb0e7)
  [2](https://testnet.arcscan.app/tx/0xcaf301b8ca84eb5ad3e868e92eee68f393181153ff7f93b28efcedbb33ef7b99)
  [3](https://testnet.arcscan.app/tx/0x0654ab5dd267978cf765b9adcaf9ac66c70b87fdd5726b8d1f7ee735041193b5)

Artist wallets received real USDC:
- Wallet `0xe6aa...3925`: +$0.081 (Glenn Gould, Dua Lipa, The Beatles, Aurora Bloom, Lena Ostergaard, Cadence Allstars)
- Wallet `0xe00d...6fbf`: +$0.014 (Solour, Kwame Mensah, writers, producers)

## Build once, distribute three ways

The settlement core doesn't know what a song is. It consumes a normalized event
and emits a decision. The only music-aware file is `musicbrainz.js`. Swap it and
the source adapter and the same engine settles anything attributable:

- **Music** (Subsonic / Navidrome) — shipping now.
- **Live audio** (Owncast) — adapter drafted.
- **Reshares** (Mastodon / ActivityPub) — adapter drafted.

Both extra adapters already exist as typed stubs implementing the same contract.
(`src/core/adapters/`)

## Architecture

The whole system is a six-step pipeline — resolve → assess fraud → attribute →
map wallets → allocate → settle — feeding one auditable `Decision`. Read
**[docs/architecture.md](./docs/architecture.md)** for the deep dive and diagram,
and **[DEVELOPMENT.md](./DEVELOPMENT.md)** for the full design rationale.

```
adapters → [ resolveMetadata · assessFraud · resolvePayees · mapWallets · allocate · settle ] → Decision
                              the portable settlement core                         ↘ dashboard · JSON API · CadenceSplitter.sol
```

## Project layout

```
server.mjs                  zero-dependency http server (static + JSON + SSE + x402)
src/core/                   the agent: pipeline, brain, fraud, registry, budget, settlement
src/core/adapters/          subsonic (live) · owncast · mastodon  (source-agnostic)
public/                     the dashboard — no framework, no build, no browser storage
contracts/
  CadenceSplitter.sol       original splitter (ERC-20 USDC, for Circle Gateway path)
  CadenceSplitterArc.sol    Arc Testnet splitter (native USDC, deployed live)
scripts/
  verify-core.mjs           26 assertions across 9 hard cases + ledger invariants
  simulate-plays.mjs        paced terminal replay
  deploy.mjs                compile + deploy CadenceSplitterArc to Arc Testnet
  fund-contract.mjs         send native USDC to the splitter contract
  live-settle.mjs           run a small LIVE settlement batch
  live-full-settle.mjs      run the full seed through LIVE settlement
data/                       bundled metadata cache, payee registry, seed plays
docs/                       architecture deep dive
```

## Requirements

Node 18+. That's the whole list for MOCK mode. The app declares **zero runtime
dependencies**; `viem` is an optional dependency loaded only in LIVE mode.

## License

MIT — see [LICENSE](./LICENSE).

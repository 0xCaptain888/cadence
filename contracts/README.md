# CadenceSplitter

The on-chain settlement target for Cadence. The agent decides payouts off-chain;
this contract executes them on Arc in USDC, escrows the long tail, and lets
artists claim what's theirs.

## What it does

- **Batch pay** — `settle(batchId, payouts[])` pays every artist who has a wallet
  on file, in one transaction, in USDC.
- **Escrow the long tail** — any payout with `payee == address(0)` is reserved
  under that artist's ERC-8004 identity hash instead of being skipped. The money
  is held, not lost.
- **Claim** — `claim(identityHash, to)` releases escrow to an artist once they
  control the matching identity, verified against an ERC-8004 identity registry.

This mirrors the off-chain core exactly: the same deterministic engine that the
dashboard shows computes `amount` and the escrow/pay decision for each payee, so
the chain and the ledger never disagree.

## Why escrow is keyed by identity, not address

An artist can be correctly attributed long before they have ever connected a
wallet — a classical performer, a small label act, someone who simply hasn't
onboarded yet. Cadence still *decides* their share at play time and reserves it
under a stable identity hash (`sha256(musicbrainzId | name)`). When they later
prove ownership of that identity (ERC-8004), they claim everything that accrued.
Attribution does not wait for a wallet.

## Interfaces it expects

- **`IERC20`** — USDC on Arc.
- **`IIdentityRegistry.ownerOf(bytes32) → address`** — a minimal view into an
  ERC-8004 identity registry. `claim` requires `registry.ownerOf(identityHash)
  == msg.sender`. Swap in the canonical registry address at deploy time.

## Deploy (Arc testnet)

The repository runs fully without this contract (MOCK mode). Deploy it only when
you want real on-chain settlement.

```bash
# with foundry
forge create contracts/CadenceSplitter.sol:CadenceSplitter \
  --rpc-url "$CADENCE_RPC_URL" \
  --private-key "$CADENCE_OPERATOR_PRIVATE_KEY" \
  --constructor-args "$CADENCE_USDC_ADDRESS" "$ERC8004_REGISTRY" "$OPERATOR_ADDRESS"
```

Then set `CADENCE_SPLITTER_ADDRESS`, `CADENCE_USDC_ADDRESS`, `CADENCE_CHAIN_ID`,
`CADENCE_RPC_URL`, and `CADENCE_SETTLEMENT_MODE=real` in `.env`. Fund the contract
with test USDC (`fund(amount)` after approving), and Cadence will route live
settlements through it.

## Events

| Event       | When                                   |
|-------------|----------------------------------------|
| `Settled`   | once per batch — totals + payee count  |
| `Paid`      | per artist paid to a wallet            |
| `Escrowed`  | per artist whose share was reserved    |
| `Claimed`   | when an artist withdraws their escrow  |

## Safety notes

- No upgradeability, no proxy, no admin mint. The only privileged role is the
  settlement `operator`, which can submit batches and rotate itself/the registry.
- Escrow is always claimable by the rightful identity owner; the operator cannot
  seize it.
- `available()` reports balance minus reserved escrow, so the operator never
  accidentally pays out money that is already promised to the long tail.

> The Solidity here is written to be read and audited. Compile with solc 0.8.24+.
> It is not required to run the demo.

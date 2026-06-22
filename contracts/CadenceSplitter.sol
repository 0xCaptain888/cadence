// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title CadenceSplitter
 * @notice On-chain settlement target for Cadence.
 *
 * Cadence's off-chain agent decides, for every listen, who should be paid and
 * how much. It then submits a batch here. This contract does three things:
 *
 *   1. Pays artists who have a wallet on file, in USDC, in one batch.
 *   2. Escrows the share of any artist with no wallet yet, keyed by their
 *      ERC-8004 identity hash, so the money is reserved — not skipped.
 *   3. Lets an artist later claim their escrow once they control the matching
 *      ERC-8004 identity (verified against an identity registry).
 *
 * The contract holds a USDC balance (funded by the operator / a Circle wallet)
 * and distributes from it. Amounts are computed off-chain by the same
 * deterministic core that the dashboard shows, so on-chain and the ledger agree.
 *
 * This is intentionally small and auditable: no upgradeability, no admin keys
 * beyond the settlement operator, no custody beyond escrow that is always
 * claimable by its rightful owner.
 */

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/**
 * @notice Minimal view into an ERC-8004 style identity registry. Cadence keys
 *         escrow by an identity hash (sha256 of musicbrainz id + name). To
 *         release escrow we ask the registry who controls that identity.
 */
interface IIdentityRegistry {
    /// @return the address currently authorised to act for `identityHash`.
    function ownerOf(bytes32 identityHash) external view returns (address);
}

contract CadenceSplitter {
    // ── roles ────────────────────────────────────────────────────────────
    address public operator;            // the settlement agent (submits batches)
    IERC20  public immutable usdc;       // the settlement asset
    IIdentityRegistry public registry;   // ERC-8004 identity registry

    // ── escrow ───────────────────────────────────────────────────────────
    mapping(bytes32 => uint256) public escrowOf;   // identityHash => USDC held
    uint256 public totalEscrow;

    // ── accounting ───────────────────────────────────────────────────────
    uint256 public totalPaid;
    uint256 public batchCount;

    // ── types ────────────────────────────────────────────────────────────
    struct Payout {
        address payee;          // address(0) => route to escrow
        bytes32 identityHash;   // ERC-8004 identity (used for escrow + claim)
        uint256 amount;         // USDC (6 decimals)
    }

    // ── events ───────────────────────────────────────────────────────────
    event Settled(bytes32 indexed batchId, uint256 totalPaid, uint256 totalEscrowed, uint256 payeeCount);
    event Paid(bytes32 indexed batchId, address indexed payee, bytes32 indexed identityHash, uint256 amount);
    event Escrowed(bytes32 indexed batchId, bytes32 indexed identityHash, uint256 amount);
    event Claimed(bytes32 indexed identityHash, address indexed to, uint256 amount);
    event OperatorChanged(address indexed from, address indexed to);
    event RegistryChanged(address indexed from, address indexed to);

    // ── errors ───────────────────────────────────────────────────────────
    error NotOperator();
    error NotIdentityOwner();
    error NothingToClaim();
    error EmptyBatch();
    error TransferFailed();
    error ZeroAddress();

    modifier onlyOperator() {
        if (msg.sender != operator) revert NotOperator();
        _;
    }

    constructor(address usdc_, address registry_, address operator_) {
        if (usdc_ == address(0) || operator_ == address(0)) revert ZeroAddress();
        usdc = IERC20(usdc_);
        registry = IIdentityRegistry(registry_);
        operator = operator_;
    }

    // ── settlement ─────────────────────────────────────────────────────────
    /**
     * @notice Distribute one batch. Payees with a wallet are paid immediately;
     *         payees with `payee == address(0)` have their amount escrowed under
     *         their identity hash. Funds come from this contract's USDC balance.
     * @param batchId  an off-chain batch identifier (mirrors the ledger).
     * @param payouts  the per-payee amounts computed by the Cadence core.
     */
    function settle(bytes32 batchId, Payout[] calldata payouts) external onlyOperator {
        uint256 n = payouts.length;
        if (n == 0) revert EmptyBatch();

        uint256 paid;
        uint256 escrowed;

        for (uint256 i = 0; i < n; i++) {
            Payout calldata p = payouts[i];
            if (p.amount == 0) continue;

            if (p.payee == address(0)) {
                // no wallet on file → reserve under the artist's identity
                escrowOf[p.identityHash] += p.amount;
                escrowed += p.amount;
                emit Escrowed(batchId, p.identityHash, p.amount);
            } else {
                if (!usdc.transfer(p.payee, p.amount)) revert TransferFailed();
                paid += p.amount;
                emit Paid(batchId, p.payee, p.identityHash, p.amount);
            }
        }

        totalPaid += paid;
        totalEscrow += escrowed;
        unchecked { batchCount += 1; }

        emit Settled(batchId, paid, escrowed, n);
    }

    // ── escrow claim ────────────────────────────────────────────────────────
    /**
     * @notice Claim escrowed royalties for an identity. The caller must control
     *         `identityHash` according to the ERC-8004 identity registry.
     * @param identityHash  the artist identity that holds escrow.
     * @param to            where to send the released USDC.
     */
    function claim(bytes32 identityHash, address to) external returns (uint256 amount) {
        if (to == address(0)) revert ZeroAddress();
        if (address(registry) == address(0) || registry.ownerOf(identityHash) != msg.sender) {
            revert NotIdentityOwner();
        }

        amount = escrowOf[identityHash];
        if (amount == 0) revert NothingToClaim();

        escrowOf[identityHash] = 0;
        totalEscrow -= amount;

        if (!usdc.transfer(to, amount)) revert TransferFailed();
        emit Claimed(identityHash, to, amount);
    }

    // ── funding helpers ───────────────────────────────────────────────────
    /// @notice Pull USDC into the contract to fund upcoming settlements.
    function fund(uint256 amount) external {
        if (!usdc.transferFrom(msg.sender, address(this), amount)) revert TransferFailed();
    }

    /// @notice USDC currently available to pay out (balance minus reserved escrow).
    function available() external view returns (uint256) {
        uint256 bal = usdc.balanceOf(address(this));
        return bal > totalEscrow ? bal - totalEscrow : 0;
    }

    // ── admin (operator only, minimal) ──────────────────────────────────────
    function setOperator(address next) external onlyOperator {
        if (next == address(0)) revert ZeroAddress();
        emit OperatorChanged(operator, next);
        operator = next;
    }

    function setRegistry(address next) external onlyOperator {
        emit RegistryChanged(address(registry), next);
        registry = IIdentityRegistry(next);
    }
}

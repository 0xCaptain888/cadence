// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title CadenceSplitterArc
 * @notice CadenceSplitter adapted for Arc Testnet where USDC is the native
 *         gas token (6 decimals, transferred via msg.value / call{value}).
 *
 *   1. Pays artists who have a wallet on file, in native USDC, in one batch.
 *   2. Escrows the share of any artist with no wallet yet, keyed by their
 *      ERC-8004 identity hash.
 *   3. Lets an artist later claim their escrow once they control the matching
 *      ERC-8004 identity.
 */

interface IIdentityRegistry {
    function ownerOf(bytes32 identityHash) external view returns (address);
}

contract CadenceSplitterArc {
    address public operator;
    IIdentityRegistry public registry;

    mapping(bytes32 => uint256) public escrowOf;
    uint256 public totalEscrow;
    uint256 public totalPaid;
    uint256 public batchCount;

    struct Payout {
        address payee;
        bytes32 identityHash;
        uint256 amount; // native USDC on Arc (18 decimals)
    }

    event Settled(bytes32 indexed batchId, uint256 totalPaid, uint256 totalEscrowed, uint256 payeeCount);
    event Paid(bytes32 indexed batchId, address indexed payee, bytes32 indexed identityHash, uint256 amount);
    event Escrowed(bytes32 indexed batchId, bytes32 indexed identityHash, uint256 amount);
    event Claimed(bytes32 indexed identityHash, address indexed to, uint256 amount);
    event Funded(address indexed from, uint256 amount);
    event OperatorChanged(address indexed from, address indexed to);
    event RegistryChanged(address indexed from, address indexed to);

    error NotOperator();
    error NotIdentityOwner();
    error NothingToClaim();
    error EmptyBatch();
    error TransferFailed();
    error ZeroAddress();
    error InsufficientBalance();

    modifier onlyOperator() {
        if (msg.sender != operator) revert NotOperator();
        _;
    }

    constructor(address registry_, address operator_) {
        if (operator_ == address(0)) revert ZeroAddress();
        registry = IIdentityRegistry(registry_);
        operator = operator_;
    }

    /// @notice Accept native USDC (Arc Testnet) to fund settlements.
    receive() external payable {
        emit Funded(msg.sender, msg.value);
    }

    /// @notice USDC currently available to pay out (balance minus reserved escrow).
    function available() external view returns (uint256) {
        uint256 bal = address(this).balance;
        return bal > totalEscrow ? bal - totalEscrow : 0;
    }

    /**
     * @notice Distribute one batch. Payees with a wallet are paid immediately;
     *         payees with payee == address(0) have their amount escrowed.
     */
    function settle(bytes32 batchId, Payout[] calldata payouts) external payable onlyOperator {
        uint256 n = payouts.length;
        if (n == 0) revert EmptyBatch();

        uint256 paid;
        uint256 escrowed;

        for (uint256 i = 0; i < n; i++) {
            Payout calldata p = payouts[i];
            if (p.amount == 0) continue;

            if (p.payee == address(0)) {
                escrowOf[p.identityHash] += p.amount;
                escrowed += p.amount;
                emit Escrowed(batchId, p.identityHash, p.amount);
            } else {
                (bool ok, ) = p.payee.call{value: p.amount}("");
                if (!ok) revert TransferFailed();
                paid += p.amount;
                emit Paid(batchId, p.payee, p.identityHash, p.amount);
            }
        }

        totalPaid += paid;
        totalEscrow += escrowed;
        unchecked { batchCount += 1; }

        emit Settled(batchId, paid, escrowed, n);
    }

    /**
     * @notice Claim escrowed royalties for an identity.
     */
    function claim(bytes32 identityHash, address to) external returns (uint256 amount) {
        if (to == address(0)) revert ZeroAddress();
        if (address(registry) != address(0) && registry.ownerOf(identityHash) != msg.sender) {
            revert NotIdentityOwner();
        }

        amount = escrowOf[identityHash];
        if (amount == 0) revert NothingToClaim();

        escrowOf[identityHash] = 0;
        totalEscrow -= amount;

        (bool ok, ) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit Claimed(identityHash, to, amount);
    }

    // ── admin ──────────────────────────────────────────────────────────────
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

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IStateTransitionVerifier {
    function verifyProof(uint[2] calldata a, uint[2][2] calldata b, uint[2] calldata c,
        uint[4] calldata input) external view returns (bool);
}

/// @dev Verifier interface for the primary state.circom statement.  Its
/// public inputs are [identityRoot, oldRoot, newRoot, stateNullifier,
/// ctiCommitment, accountabilityCommitment].
interface IStateSubmissionVerifier {
    function verifyProof(uint[2] calldata a, uint[2][2] calldata b, uint[2] calldata c,
        uint[7] calldata input) external view returns (bool);
}

interface IStakeRootProvider {
    function stakeRoot() external view returns (uint256);
}

/// @notice Commitment-only state root for history-hiding application transitions.
contract PrivateStateTree {
    uint256 public stateRoot;
    IStateTransitionVerifier public immutable verifier;
    address public owner;
    IStakeRootProvider public stakeRegistry;
    mapping(uint256 => bool) public usedNullifiers;
    mapping(uint256 => uint256) public accountabilityCtiCommitment;
    mapping(bytes32 => bool) public usedReceipts;

    event StateTransitionApplied(uint256 indexed oldRoot, uint256 indexed newRoot, uint256 indexed nullifier, uint256 ctiCommitment);
    event PrivateCtiSubmitted(uint256 indexed newRoot, uint256 indexed ctiCommitment);
    event AccountabilityRecorded(uint256 indexed ctiCommitment, uint256 indexed accountabilityCommitment);
    event ReceiptAccepted(bytes32 indexed receiptHash, uint256 indexed requestId, uint256 indexed ctiCommitment, uint256 version, address recipient);

    constructor(uint256 initialRoot, address transitionVerifier) {
        stateRoot = initialRoot;
        verifier = IStateTransitionVerifier(transitionVerifier);
        owner = msg.sender;
    }

    function setStakeRegistry(address registry) external {
        require(msg.sender == owner, "only owner");
        require(registry != address(0), "zero stake registry");
        stakeRegistry = IStakeRootProvider(registry);
    }

    function applyTransition(
        uint[2] calldata a, uint[2][2] calldata b, uint[2] calldata c,
        uint256 oldRoot, uint256 newRoot, uint256 nullifier, uint256 ctiCommitment
    ) external {
        require(oldRoot == stateRoot, "old root is not current");
        require(!usedNullifiers[nullifier], "transition nullifier already used");
        uint[4] memory input = [oldRoot, newRoot, nullifier, ctiCommitment];
        require(verifier.verifyProof(a, b, c, input), "invalid transition proof");
        usedNullifiers[nullifier] = true;
        stateRoot = newRoot;
        emit StateTransitionApplied(oldRoot, newRoot, nullifier, ctiCommitment);
    }

    /// @notice Applies the complete anonymous CTI publication statement from
    /// state.circom.  Identity and stake witnesses never cross the ABI.
    function applyStateSubmission(
        uint[2] calldata a, uint[2][2] calldata b, uint[2] calldata c,
        uint256 identityRoot, uint256 stakeRoot, uint256 oldRoot, uint256 newRoot,
        uint256 nullifier, uint256 ctiCommitment, uint256 accountabilityCommitment
    ) public {
        require(oldRoot == stateRoot, "old root is not current");
        require(!usedNullifiers[nullifier], "transition nullifier already used");
        require(address(stakeRegistry) != address(0), "stake registry not configured");
        require(stakeRoot == stakeRegistry.stakeRoot(), "stake root is not current");
        uint[7] memory input = [identityRoot, stakeRoot, oldRoot, newRoot, nullifier, ctiCommitment, accountabilityCommitment];
        require(IStateSubmissionVerifier(address(verifier)).verifyProof(a, b, c, input), "invalid state proof");
        usedNullifiers[nullifier] = true;
        stateRoot = newRoot;
        accountabilityCtiCommitment[accountabilityCommitment] = ctiCommitment;
        emit StateTransitionApplied(oldRoot, newRoot, nullifier, ctiCommitment);
        emit AccountabilityRecorded(ctiCommitment, accountabilityCommitment);
    }

    /// @notice Records a CTI submission only as a committed state transition.
    function submitPrivateCti(
        uint[2] calldata a, uint[2][2] calldata b, uint[2] calldata c,
        uint256 oldRoot, uint256 newRoot, uint256 nullifier, uint256 ctiCommitment
    ) external {
        this.applyTransition(a, b, c, oldRoot, newRoot, nullifier, ctiCommitment);
        emit PrivateCtiSubmitted(newRoot, ctiCommitment);
    }

    /// @notice Primary history-hiding CTI submission path.  The only semantic
    /// value exposed is the opaque commitment; the identity, CTI payload,
    /// Merkle witnesses and stake witness remain inside the Groth16 proof.
    function submitPrivateCtiWithStateProof(
        uint[2] calldata a, uint[2][2] calldata b, uint[2] calldata c,
        uint256 identityRoot, uint256 stakeRoot, uint256 oldRoot, uint256 newRoot,
        uint256 nullifier, uint256 ctiCommitment, uint256 accountabilityCommitment
    ) external {
        applyStateSubmission(a, b, c, identityRoot, stakeRoot, oldRoot, newRoot, nullifier, ctiCommitment, accountabilityCommitment);
        emit PrivateCtiSubmitted(newRoot, ctiCommitment);
    }

    /// @notice Accept a recipient acknowledgement bound to one exact CTI commitment.
    /// The CTI payload itself is never stored on-chain.
    function acceptReceipt(
        uint256 requestId,
        uint256 ctiCommitment,
        uint256 version,
        address recipient,
        bytes calldata signature
    ) external {
        bytes32 digest = receiptDigest(requestId, ctiCommitment, version);
        require(!usedReceipts[digest], "receipt already used");
        require(signature.length == 65, "invalid receipt signature");
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }
        if (v < 27) v += 27;
        address signer = ecrecover(digest, v, r, s);
        require(signer == recipient, "invalid receipt signature");
        usedReceipts[digest] = true;
        emit ReceiptAccepted(digest, requestId, ctiCommitment, version, signer);
    }

    function receiptDigest(uint256 requestId, uint256 ctiCommitment, uint256 version) public view returns (bytes32) {
        return keccak256(abi.encodePacked("PRIV_SHARE_RECEIPT_V1", address(this), block.chainid,
            requestId, ctiCommitment, version));
    }

    /// @notice Lets the slashing path bind an accountability commitment to an
    /// actual accepted anonymous state submission, rather than accepting a
    /// slash-time value supplied by the caller.
    function isAccountabilityRecorded(uint256 ctiCommitment, uint256 accountabilityCommitment) external view returns (bool) {
        return accountabilityCtiCommitment[accountabilityCommitment] == ctiCommitment;
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "poseidon-solidity/PoseidonT4.sol";

interface IAnonymousStateSubmission {
    function submitPrivateCtiWithStateProof(
        uint256[2] calldata a,
        uint256[2][2] calldata b,
        uint256[2] calldata c,
        uint256 identityRoot,
        uint256 stakeRoot,
        uint256 oldRoot,
        uint256 newRoot,
        uint256 nullifier,
        uint256 ctiCommitment,
        uint256 accountabilityCommitment
    ) external;
    function stateRoot() external view returns (uint256);
    function usedNullifiers(uint256 nullifier) external view returns (bool);
}

interface IAnonymousAccessVerifier {
    function verifyProof(
        uint256[2] calldata a,
        uint256[2][2] calldata b,
        uint256[2] calldata c,
        uint256[3] calldata input
    ) external view returns (bool);
}

interface IAnonymousDisputeSlasher {
    function confirmMaliciousFromDispute(uint256 ctiCommitment) external;
}

/// @notice Canonical commitment-only CTI publication, access, and dispute
/// registry. It stores no producer, consumer, delegate, CTI payload, or IPFS
/// metadata. Legacy address-linked sharing in ZKData is intentionally separate.
contract AnonymousCtiAccess {
    uint256 private constant FIELD_ORDER =
        21888242871839275222246405745257275088548364400416034343698204186575808495617;

    address public immutable owner;
    IAnonymousStateSubmission public immutable stateTree;
    IAnonymousAccessVerifier public immutable accessVerifier;
    IAnonymousDisputeSlasher public immutable slashing;
    address public disputeResolver;

    struct AccessRequest {
        uint256 ctiCommitment;
        uint256 deliveryCommitment;
        uint256 acknowledgement;
        bool delivered;
        bool acknowledged;
        bool disputed;
        bool resolved;
    }

    mapping(uint256 => bool) public publishedCti;
    mapping(uint256 => AccessRequest) public accessRequests;
    mapping(uint256 => bool) public usedAccessNullifiers;
    mapping(uint256 => bool) public usedDisputeNullifiers;
    mapping(uint256 => uint256) public disputeRequestCommitment;
    mapping(uint256 => bool) public usedAcknowledgements;

    event AnonymousCtiPublished(uint256 indexed ctiCommitment, uint256 indexed newStateRoot, uint256 stateNullifier);
    event AnonymousAccessRequested(uint256 indexed ctiCommitment, uint256 indexed requestCommitment, uint256 accessNullifier);
    event AnonymousAccessDelivered(uint256 indexed requestCommitment, uint256 deliveryCommitment);
    event AnonymousReceptionAcknowledged(uint256 indexed requestCommitment, uint256 indexed acknowledgement);
    event AnonymousDisputeRaised(uint256 indexed ctiCommitment, uint256 indexed disputeNullifier, uint256 evidenceCommitment);
    event AnonymousDisputeResolved(uint256 indexed ctiCommitment, uint256 indexed disputeNullifier, bool malicious);
    event DisputeResolverUpdated(address indexed disputeResolver);

    modifier onlyOwner() {
        require(msg.sender == owner, "only owner");
        _;
    }

    modifier onlyDisputeResolver() {
        require(msg.sender == disputeResolver, "only dispute resolver");
        _;
    }

    constructor(address _stateTree, address _accessVerifier, address _slashing) {
        require(_stateTree != address(0) && _accessVerifier != address(0) && _slashing != address(0), "zero dependency");
        owner = msg.sender;
        stateTree = IAnonymousStateSubmission(_stateTree);
        accessVerifier = IAnonymousAccessVerifier(_accessVerifier);
        slashing = IAnonymousDisputeSlasher(_slashing);
    }

    function setDisputeResolver(address resolver) external onlyOwner {
        require(resolver != address(0), "zero dispute resolver");
        disputeResolver = resolver;
        emit DisputeResolverUpdated(resolver);
    }

    /// @notice Publishes a CTI only by applying the full anonymous state proof.
    function publishCti(
        uint256[2] calldata a,
        uint256[2][2] calldata b,
        uint256[2] calldata c,
        uint256 identityRoot,
        uint256 stakeRoot,
        uint256 oldRoot,
        uint256 newRoot,
        uint256 stateNullifier,
        uint256 ctiCommitment,
        uint256 accountabilityCommitment
    ) external {
        require(ctiCommitment != 0, "zero CTI commitment");
        require(!publishedCti[ctiCommitment], "CTI already published");
        stateTree.submitPrivateCtiWithStateProof(
            a, b, c, identityRoot, stakeRoot, oldRoot, newRoot,
            stateNullifier, ctiCommitment, accountabilityCommitment
        );
        publishedCti[ctiCommitment] = true;
        emit AnonymousCtiPublished(ctiCommitment, newRoot, stateNullifier);
    }

    /// @notice Requests access with a proof tied to an opaque request
    /// commitment. The generated identity verifier statement is
    /// [accessNullifier, identityRoot, requestCommitment]; no requester
    /// address is stored or emitted.
    function requestAccess(
        uint256[2] calldata a,
        uint256[2][2] calldata b,
        uint256[2] calldata c,
        uint256 identityRoot,
        uint256 accessNullifier,
        uint256 requestCommitment,
        uint256 ctiCommitment
    ) external {
        require(publishedCti[ctiCommitment], "CTI not published");
        require(requestCommitment != 0, "zero request commitment");
        require(accessRequests[requestCommitment].ctiCommitment == 0, "request exists");
        require(!usedAccessNullifiers[accessNullifier], "access nullifier already used");
        require(requestCommitment < FIELD_ORDER, "request commitment not field element");
        uint256[3] memory input = [accessNullifier, identityRoot, requestCommitment];
        require(accessVerifier.verifyProof(a, b, c, input), "invalid access proof");

        usedAccessNullifiers[accessNullifier] = true;
        accessRequests[requestCommitment].ctiCommitment = ctiCommitment;
        emit AnonymousAccessRequested(ctiCommitment, requestCommitment, accessNullifier);
    }

    /// @notice Records delivery as another opaque commitment.
    function recordDelivery(uint256 requestCommitment, uint256 deliveryCommitment) external {
        AccessRequest storage request = accessRequests[requestCommitment];
        require(request.ctiCommitment != 0, "request not found");
        require(!request.delivered, "already delivered");
        require(deliveryCommitment != 0, "zero delivery commitment");
        request.deliveryCommitment = deliveryCommitment;
        request.delivered = true;
        emit AnonymousAccessDelivered(requestCommitment, deliveryCommitment);
    }

    /// @notice Canonical anonymous receipt: Poseidon(ctiCommitment,
    /// newStateRoot, stateNullifier). The contract recomputes it and requires
    /// the root/nullifier to describe an accepted state transition. No
    /// recipient address, signature, or address-linked identity is stored.
    function recordReceptionAcknowledgement(
        uint256 requestCommitment,
        uint256 newStateRoot,
        uint256 stateNullifier,
        uint256 acknowledgement
    ) external {
        AccessRequest storage request = accessRequests[requestCommitment];
        require(request.ctiCommitment != 0, "request not found");
        require(request.delivered, "delivery not recorded");
        require(!request.acknowledged, "already acknowledged");
        require(!usedAcknowledgements[acknowledgement], "acknowledgement already used");
        require(newStateRoot == stateTree.stateRoot(), "state root is not current");
        require(stateTree.usedNullifiers(stateNullifier), "state nullifier not consumed");
        require(
            acknowledgement == computeAcknowledgement(request.ctiCommitment, newStateRoot, stateNullifier),
            "invalid acknowledgement"
        );

        request.acknowledged = true;
        request.acknowledgement = acknowledgement;
        usedAcknowledgements[acknowledgement] = true;
        emit AnonymousReceptionAcknowledged(requestCommitment, acknowledgement);
    }

    function computeAcknowledgement(
        uint256 ctiCommitment,
        uint256 newStateRoot,
        uint256 stateNullifier
    ) public pure returns (uint256) {
        uint256[3] memory input = [ctiCommitment, newStateRoot, stateNullifier];
        return PoseidonT4.hash(input);
    }

    function raiseDispute(uint256 requestCommitment, uint256 disputeNullifier, uint256 evidenceCommitment) external {
        AccessRequest storage request = accessRequests[requestCommitment];
        require(request.ctiCommitment != 0, "request not found");
        require(request.delivered, "delivery not recorded");
        require(!request.disputed, "request already disputed");
        require(!usedDisputeNullifiers[disputeNullifier], "dispute nullifier already used");
        require(evidenceCommitment != 0, "zero evidence commitment");
        request.disputed = true;
        usedDisputeNullifiers[disputeNullifier] = true;
        disputeRequestCommitment[disputeNullifier] = requestCommitment;
        emit AnonymousDisputeRaised(request.ctiCommitment, disputeNullifier, evidenceCommitment);
    }

    /// @notice A protocol dispute resolver records the anonymous outcome. A
    /// malicious result is forwarded to AnonymousSlashing, whose own resolver
    /// authorization is configured to this contract.
    function resolveDispute(uint256 requestCommitment, uint256 disputeNullifier, bool malicious) external onlyDisputeResolver {
        AccessRequest storage request = accessRequests[requestCommitment];
        require(request.disputed, "dispute not raised");
        require(!request.resolved, "dispute already resolved");
        require(disputeRequestCommitment[disputeNullifier] == requestCommitment, "dispute does not match request");
        request.resolved = true;
        if (malicious) slashing.confirmMaliciousFromDispute(request.ctiCommitment);
        emit AnonymousDisputeResolved(request.ctiCommitment, disputeNullifier, malicious);
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IAnonymousAccessDisputeResolution {
    function resolveDispute(uint256 requestCommitment, uint256 disputeNullifier, bool malicious) external;
}

/// @notice Threshold-authorized resolver for opaque canonical disputes.
/// Governance manager addresses authorize an outcome, while request, evidence,
/// CTI, and slashing data remain commitment-only.
contract AnonymousDisputeResolver {
    IAnonymousAccessDisputeResolution public immutable access;
    uint256 public immutable threshold;
    mapping(address => bool) public isManager;
    mapping(bytes32 => mapping(address => bool)) public hasVoted;
    mapping(bytes32 => uint256) public maliciousVotes;
    mapping(bytes32 => bool) public resolved;

    event AnonymousDisputeVote(uint256 indexed requestCommitment, uint256 indexed disputeNullifier, bool malicious);
    event AnonymousDisputeThresholdReached(uint256 indexed requestCommitment, uint256 indexed disputeNullifier, bool malicious);

    modifier onlyManager() {
        require(isManager[msg.sender], "only dispute manager");
        _;
    }

    constructor(address _access, address[] memory managers, uint256 _threshold) {
        require(_access != address(0), "zero access contract");
        require(_threshold != 0 && _threshold <= managers.length, "invalid threshold");
        access = IAnonymousAccessDisputeResolution(_access);
        threshold = _threshold;
        for (uint256 i = 0; i < managers.length; i++) {
            address manager = managers[i];
            require(manager != address(0) && !isManager[manager], "invalid manager");
            isManager[manager] = true;
        }
    }

    /// @notice A manager threshold resolves a raised opaque dispute. The
    /// access contract validates request/nullifier binding and forwards a
    /// malicious outcome into anonymous slashing.
    function vote(uint256 requestCommitment, uint256 disputeNullifier, bool malicious) external onlyManager {
        bytes32 disputeId = keccak256(abi.encode(requestCommitment, disputeNullifier));
        require(!resolved[disputeId], "dispute already resolved");
        require(!hasVoted[disputeId][msg.sender], "manager already voted");
        require(malicious, "only malicious resolution supported");
        hasVoted[disputeId][msg.sender] = true;
        maliciousVotes[disputeId]++;
        emit AnonymousDisputeVote(requestCommitment, disputeNullifier, true);
        if (maliciousVotes[disputeId] >= threshold) {
            resolved[disputeId] = true;
            access.resolveDispute(requestCommitment, disputeNullifier, true);
            emit AnonymousDisputeThresholdReached(requestCommitment, disputeNullifier, true);
        }
    }
}

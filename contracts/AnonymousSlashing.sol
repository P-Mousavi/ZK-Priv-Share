// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./AnonymousStakeRegistry.sol";

interface IAccountabilityRegistry {
    function isAccountabilityRecorded(uint256 ctiCommitment, uint256 accountabilityCommitment) external view returns (bool);
}

interface ISlashingVerifier {
    function verifyProof(uint256[2] calldata a, uint256[2][2] calldata b, uint256[2] calldata c, uint256[5] calldata input) external view returns (bool);
}

/// @notice A resolved dispute marks a commitment malicious. A separate ZK
/// proof then links it to a funded stake without exposing identitySecret.
/// Public verifier inputs: [maliciousCtiCommitment, stakeRoot,
/// accountabilityCommitment, stakeNullifier, stakeCommitment].
contract AnonymousSlashing {
    address public owner;
    address public disputeResolver;
    ISlashingVerifier public immutable verifier;
    AnonymousStakeRegistry public immutable stakes;
    IAccountabilityRegistry public stateTree;
    mapping(uint256 => bool) public maliciousCti;
    mapping(uint256 => bool) public usedStakeNullifiers;

    event MaliciousCtiConfirmed(uint256 indexed ctiCommitment);
    event DisputeResolverUpdated(address indexed disputeResolver);
    event AnonymousStakeSlashed(uint256 indexed ctiCommitment, uint256 indexed stakeNullifier, uint256 amount);

    modifier onlyOwner() { require(msg.sender == owner, "only owner"); _; }
    constructor(address _verifier, address _stakes) { owner = msg.sender; verifier = ISlashingVerifier(_verifier); stakes = AnonymousStakeRegistry(_stakes); }
    function setStateTree(address _stateTree) external onlyOwner {
        require(_stateTree != address(0), "zero state tree");
        stateTree = IAccountabilityRegistry(_stateTree);
    }
    function setDisputeResolver(address _disputeResolver) external onlyOwner {
        require(_disputeResolver != address(0), "zero dispute resolver");
        disputeResolver = _disputeResolver;
        emit DisputeResolverUpdated(_disputeResolver);
    }

    /// @notice Called only by the configured dispute-resolution contract once
    /// a CTI has reached a guilty protocol outcome. This replaces arbitrary
    /// owner-set malicious commitments in the canonical path.
    function confirmMaliciousFromDispute(uint256 ctiCommitment) external {
        require(msg.sender == disputeResolver, "only dispute resolver");
        require(ctiCommitment != 0, "zero CTI commitment");
        maliciousCti[ctiCommitment] = true;
        emit MaliciousCtiConfirmed(ctiCommitment);
    }

    function slash(uint256[2] calldata a, uint256[2][2] calldata b, uint256[2] calldata c, uint256 ctiCommitment, uint256 stakeRoot, uint256 accountabilityCommitment, uint256 stakeNullifier, uint256 stakeCommitment) external {
        require(maliciousCti[ctiCommitment], "CTI not malicious");
        require(!usedStakeNullifiers[stakeNullifier], "stake nullifier already used");
        require(address(stateTree) != address(0), "state tree not configured");
        require(stateTree.isAccountabilityRecorded(ctiCommitment, accountabilityCommitment), "accountability not recorded");
        require(stakeRoot == stakes.stakeRoot(), "stake root is not current");
        uint256[5] memory input = [ctiCommitment, stakeRoot, accountabilityCommitment, stakeNullifier, stakeCommitment];
        require(verifier.verifyProof(a, b, c, input), "invalid slashing proof");
        usedStakeNullifiers[stakeNullifier] = true;
        uint256 amount = stakes.slash(stakeCommitment);
        emit AnonymousStakeSlashed(ctiCommitment, stakeNullifier, amount);
    }
}

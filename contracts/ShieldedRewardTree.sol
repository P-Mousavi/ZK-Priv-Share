// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@zk-kit/incremental-merkle-tree.sol/IncrementalBinaryTree.sol";

interface IRewardProofVerifier {
    function verifyProof(
        uint256[2] calldata a,
        uint256[2][2] calldata b,
        uint256[2] calldata c,
        uint256[3] calldata input
    ) external view returns (bool);
}

/// @notice Canonical fixed-denomination shielded reward-note tree.
/// Note issuance records only an opaque note commitment and fixed denomination;
/// no producer, CTI, or recipient identity is retained by this contract.
contract ShieldedRewardTree {
    using IncrementalBinaryTree for IncrementalTreeData;

    uint256 public constant TREE_DEPTH = 7;
    uint256 public constant DENOMINATION_0_001_ETH = 1e15;
    uint256 public constant DENOMINATION_0_01_ETH = 1e16;
    uint256 public constant DENOMINATION_0_1_ETH = 1e17;
    uint256 public constant DENOMINATION_1_ETH = 1e18;
    uint256 public constant DENOMINATION_10_ETH = 1e19;

    address public immutable owner;
    IRewardProofVerifier public immutable verifier;
    IncrementalTreeData private rewardTree;
    mapping(address => bool) public issuers;
    mapping(uint256 => bool) public issuedNotes;
    mapping(uint256 => bool) public usedRewardNullifiers;
    mapping(uint256 => bool) public isAllowedDenomination;

    event RewardIssuerUpdated(address indexed issuer, bool allowed);
    event RewardNoteIssued(uint256 indexed noteCommitment, uint256 indexed leafIndex, uint256 denomination, uint256 rewardRoot);
    event RewardClaimed(uint256 indexed rewardNullifier, uint256 denomination);

    modifier onlyOwner() {
        require(msg.sender == owner, "only owner");
        _;
    }

    modifier onlyIssuer() {
        require(issuers[msg.sender], "only reward issuer");
        _;
    }

    constructor(address _verifier) {
        require(_verifier != address(0), "zero verifier");
        owner = msg.sender;
        verifier = IRewardProofVerifier(_verifier);
        rewardTree.init(TREE_DEPTH, 0);

        isAllowedDenomination[DENOMINATION_0_001_ETH] = true;
        isAllowedDenomination[DENOMINATION_0_01_ETH] = true;
        isAllowedDenomination[DENOMINATION_0_1_ETH] = true;
        isAllowedDenomination[DENOMINATION_1_ETH] = true;
        isAllowedDenomination[DENOMINATION_10_ETH] = true;
        issuers[msg.sender] = true;
    }

    function setIssuer(address issuer, bool allowed) external onlyOwner {
        require(issuer != address(0), "zero issuer");
        issuers[issuer] = allowed;
        emit RewardIssuerUpdated(issuer, allowed);
    }

    /// @notice Fund and append one opaque fixed-denomination reward note.
    function issueRewardNote(uint256 noteCommitment, uint256 denomination) external payable onlyIssuer {
        require(noteCommitment != 0, "zero note commitment");
        require(!issuedNotes[noteCommitment], "note already issued");
        require(isAllowedDenomination[denomination], "unsupported denomination");
        require(msg.value == denomination, "incorrect reward funding");

        uint256 leafIndex = rewardTree.numberOfLeaves;
        rewardTree.insert(noteCommitment);
        issuedNotes[noteCommitment] = true;
        emit RewardNoteIssued(noteCommitment, leafIndex, denomination, rewardTree.root);
    }

    /// @notice Claims one note using the generated reward circuit statement:
    /// [rewardRoot, denomination, NF_reward]. The receiver is transaction
    /// context only and is intentionally omitted from storage and events.
    function claimReward(
        uint256[2] calldata a,
        uint256[2][2] calldata b,
        uint256[2] calldata c,
        uint256 suppliedRewardRoot,
        uint256 denomination,
        uint256 rewardNullifier
    ) external {
        require(suppliedRewardRoot == rewardTree.root, "reward root is not current");
        require(isAllowedDenomination[denomination], "unsupported denomination");
        require(!usedRewardNullifiers[rewardNullifier], "reward nullifier already used");
        uint256[3] memory input = [suppliedRewardRoot, denomination, rewardNullifier];
        require(verifier.verifyProof(a, b, c, input), "invalid reward proof");

        usedRewardNullifiers[rewardNullifier] = true;
        (bool sent, ) = msg.sender.call{value: denomination}("");
        require(sent, "reward transfer failed");
        emit RewardClaimed(rewardNullifier, denomination);
    }

    function rewardRoot() external view returns (uint256) {
        return rewardTree.root;
    }

    function rewardLeafCount() external view returns (uint256) {
        return rewardTree.numberOfLeaves;
    }
}

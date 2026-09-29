// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@zk-kit/incremental-merkle-tree.sol/IncrementalBinaryTree.sol";

/// @notice Deposit registry indexed by an opaque stake commitment.  It never
/// stores an account-to-CTI relationship; that relationship is proved only at
/// slashing time.
contract AnonymousStakeRegistry {
    using IncrementalBinaryTree for IncrementalTreeData;

    uint256 public constant TREE_DEPTH = 7;
    uint256 public immutable requiredDeposit;
    address public immutable owner;
    address public slasher;
    mapping(uint256 => uint256) public deposits;
    IncrementalTreeData private stakeTree;

    event StakeLocked(uint256 indexed stakeCommitment, uint256 amount);
    event StakeRegistered(uint256 indexed stakeCommitment, uint256 indexed leafIndex, uint256 stakeRoot);
    event StakeSlashed(uint256 indexed stakeCommitment, uint256 amount);

    constructor(uint256 _requiredDeposit, address _slasher) {
        require(_requiredDeposit != 0, "zero deposit");
        requiredDeposit = _requiredDeposit;
        owner = msg.sender;
        slasher = _slasher;
        stakeTree.init(TREE_DEPTH, 0);
    }

    function setSlasher(address _slasher) external {
        require(msg.sender == owner, "only owner");
        require(_slasher != address(0), "zero slasher");
        slasher = _slasher;
    }

    function lockStake(uint256 stakeCommitment) external payable {
        require(stakeCommitment != 0, "zero commitment");
        require(deposits[stakeCommitment] == 0, "stake exists");
        require(msg.value == requiredDeposit, "incorrect deposit");
        deposits[stakeCommitment] = msg.value;
        uint256 leafIndex = stakeTree.numberOfLeaves;
        stakeTree.insert(stakeCommitment);
        emit StakeLocked(stakeCommitment, msg.value);
        emit StakeRegistered(stakeCommitment, leafIndex, stakeTree.root);
    }

    function slash(uint256 stakeCommitment) external returns (uint256 amount) {
        require(msg.sender == slasher, "only slasher");
        amount = deposits[stakeCommitment];
        require(amount != 0, "unfunded stake");
        deposits[stakeCommitment] = 0;
        emit StakeSlashed(stakeCommitment, amount);
    }

    /// @notice The authoritative root used as the public stake-membership
    /// statement in state and slashing proofs.
    function stakeRoot() external view returns (uint256) {
        return stakeTree.root;
    }

    function stakeLeafCount() external view returns (uint256) {
        return stakeTree.numberOfLeaves;
    }
}

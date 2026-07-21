// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@zk-kit/incremental-merkle-tree.sol/IncrementalBinaryTree.sol";

contract IdentityTree {
    using IncrementalBinaryTree for IncrementalTreeData;

    uint256 public constant DEPTH = 20;
    IncrementalTreeData internal tree;

    event LeafInserted(uint256 indexed leaf, uint256 indexed index);
    event TreeInitialized(uint256 depth);

    constructor() {
        tree.init(DEPTH, 0);
        emit TreeInitialized(DEPTH);
    }

    function insert(uint256 leaf) external {
        tree.insert(leaf);
        emit LeafInserted(leaf, tree.numberOfLeaves - 1);
    }

    function getRoot()
        external
        view
        returns (uint256)
    {
        return tree.root;
    }

    function getNumberOfLeaves()
        external
        view
        returns (uint256)
    {
        return tree.numberOfLeaves;
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@zk-kit/incremental-merkle-tree.sol/IncrementalBinaryTree.sol";

contract IncrementalTreeWrapper {
    using IncrementalBinaryTree for IncrementalTreeData;

    IncrementalTreeData internal tree;

    constructor(uint256 depth) {
        tree.init(depth, 0);
    }

    function insert(uint256 leaf) external {
        tree.insert(leaf);
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
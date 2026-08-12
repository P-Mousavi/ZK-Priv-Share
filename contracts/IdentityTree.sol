// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./libraries/IncrementalBinaryTree.sol";

contract IdentityTree {
    using IncrementalBinaryTree for IncrementalTreeData;

    // A depth-5 binary tree holds only 32 identities. Registration scalability
    // benchmarks cover up to 100 identities, so retain a little headroom while
    // keeping the tree and the identity circuit on the same depth.
    uint256 public constant DEPTH = 7;
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

    // Test helper flag
    bool public testingMode;

    /**
     * @dev Test helper to enable testing mode
     */
    function setTestingMode(bool _enabled) external {
        testingMode = _enabled;
    }

    /**
     * @dev Test helper to set a Merkle root directly (for benchmarking)
     * Only callable in testing mode
     */
    function setRoot(uint256 _root) external {
        require(testingMode, "Not in testing mode");
        tree.root = _root;
    }
}

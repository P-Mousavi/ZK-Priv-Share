// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IStateTransitionVerifier {
    function verifyProof(uint[2] calldata a, uint[2][2] calldata b, uint[2] calldata c,
        uint[3] calldata input) external view returns (bool);
}

/// @notice Commitment-only state root for history-hiding application transitions.
contract PrivateStateTree {
    uint256 public stateRoot;
    IStateTransitionVerifier public immutable verifier;
    mapping(uint256 => bool) public usedNullifiers;

    event StateTransitionApplied(uint256 indexed oldRoot, uint256 indexed newRoot, uint256 indexed nullifier);
    event PrivateCtiSubmitted(uint256 indexed newRoot);

    constructor(uint256 initialRoot, address transitionVerifier) {
        stateRoot = initialRoot;
        verifier = IStateTransitionVerifier(transitionVerifier);
    }

    function applyTransition(
        uint[2] calldata a, uint[2][2] calldata b, uint[2] calldata c,
        uint256 oldRoot, uint256 newRoot, uint256 nullifier
    ) external {
        require(oldRoot == stateRoot, "old root is not current");
        require(!usedNullifiers[nullifier], "transition nullifier already used");
        uint[3] memory input = [oldRoot, newRoot, nullifier];
        require(verifier.verifyProof(a, b, c, input), "invalid transition proof");
        usedNullifiers[nullifier] = true;
        stateRoot = newRoot;
        emit StateTransitionApplied(oldRoot, newRoot, nullifier);
    }

    /// @notice Records a CTI submission only as a committed state transition.
    function submitPrivateCti(
        uint[2] calldata a, uint[2][2] calldata b, uint[2] calldata c,
        uint256 oldRoot, uint256 newRoot, uint256 nullifier
    ) external {
        this.applyTransition(a, b, c, oldRoot, newRoot, nullifier);
        emit PrivateCtiSubmitted(newRoot);
    }
}

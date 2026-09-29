// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "poseidon-solidity/PoseidonT2.sol";

/// @dev Test-only adapter for the canonical one-input identity commitment.
contract IdentityCommitmentWrapper {
    function hash(uint256 identitySecret) external pure returns (uint256) {
        uint256[1] memory input = [identitySecret];
        return PoseidonT2.hash(input);
    }
}

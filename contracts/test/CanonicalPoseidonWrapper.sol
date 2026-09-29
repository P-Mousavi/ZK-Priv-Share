// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "poseidon-solidity/PoseidonT2.sol";
import "poseidon-solidity/PoseidonT3.sol";
import "poseidon-solidity/PoseidonT4.sol";

/// @dev Test-only adapter over the exact production Poseidon Solidity
/// libraries. It has no alternate hashing behavior.
contract CanonicalPoseidonWrapper {
    function hash1(uint256 value) external pure returns (uint256) {
        uint256[1] memory input = [value];
        return PoseidonT2.hash(input);
    }

    function hash2(uint256 left, uint256 right) external pure returns (uint256) {
        uint256[2] memory input = [left, right];
        return PoseidonT3.hash(input);
    }

    function hash3(uint256 first, uint256 second, uint256 third) external pure returns (uint256) {
        uint256[3] memory input = [first, second, third];
        return PoseidonT4.hash(input);
    }
}

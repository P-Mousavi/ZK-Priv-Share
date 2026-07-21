// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../crypto/PoseidonT3.sol";

contract PoseidonWrapper {

    function hash(
        uint256 left,
        uint256 right
    )
        external
        pure
        returns (uint256)
    {
        uint256[2] memory input;
        input[0] = left;
        input[1] = right;

        return PoseidonT3.hash(input);
    }
}

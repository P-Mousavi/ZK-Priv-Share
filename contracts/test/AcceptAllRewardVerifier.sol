// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @dev Benchmark-only verifier. It permits the linkability benchmark to
/// exercise the on-chain claim transaction without generating Groth16 proofs.
/// Never deploy this contract outside a local test network.
contract AcceptAllRewardVerifier {
    function verifyProof(
        uint256[2] calldata,
        uint256[2][2] calldata,
        uint256[2] calldata,
        uint256[3] calldata
    ) external pure returns (bool) {
        return true;
    }
}

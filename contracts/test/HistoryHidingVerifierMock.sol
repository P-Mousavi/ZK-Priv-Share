// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @dev Test-only verifier used to exercise state-machine and replay guards
/// independently from a Groth16 ceremony.  Real proof integration is covered
/// by StateVerifier and the state-submission contract test.
contract HistoryHidingVerifierMock {
    bool public result = true;

    function setResult(bool value) external { result = value; }

    function verifyProof(uint256[2] calldata, uint256[2][2] calldata, uint256[2] calldata, uint256[4] calldata)
        external view returns (bool) { return result; }

    function verifyProof(uint256[2] calldata, uint256[2][2] calldata, uint256[2] calldata, uint256[5] calldata)
        external view returns (bool) { return result; }

    function verifyProof(uint256[2] calldata, uint256[2][2] calldata, uint256[2] calldata, uint256[7] calldata)
        external view returns (bool) { return result; }
}

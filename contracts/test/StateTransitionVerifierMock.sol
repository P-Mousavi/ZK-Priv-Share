pragma solidity ^0.8.20;
contract StateTransitionVerifierMock {
    bool public result = true;
    function setResult(bool value) external { result = value; }
    function verifyProof(uint[2] calldata, uint[2][2] calldata, uint[2] calldata, uint[3] calldata) external view returns (bool) { return result; }
}

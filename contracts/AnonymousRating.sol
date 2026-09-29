// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IRatingVerifier {
    function verifyProof(uint256[2] calldata a, uint256[2][2] calldata b, uint256[2] calldata c, uint256[4] calldata input) external view returns (bool);
}

/// @notice Stores CTI aggregates only.  The verifier's public inputs are
/// [identityRoot, ctiCommitment, ratingNullifier, rating].
contract AnonymousRating {
    IRatingVerifier public immutable verifier;
    mapping(uint256 => bool) public usedRatingNullifiers;
    mapping(uint256 => uint256) public positiveCount;
    mapping(uint256 => uint256) public negativeCount;

    event CtiRated(uint256 indexed ctiCommitment, uint256 indexed ratingNullifier, uint8 rating);

    constructor(address _verifier) { verifier = IRatingVerifier(_verifier); }

    function rate(uint256[2] calldata a, uint256[2][2] calldata b, uint256[2] calldata c, uint256 identityRoot, uint256 ctiCommitment, uint256 ratingNullifier, uint8 rating) external {
        require(rating <= 1, "invalid rating");
        require(!usedRatingNullifiers[ratingNullifier], "rating nullifier already used");
        uint256[4] memory input = [identityRoot, ctiCommitment, ratingNullifier, uint256(rating)];
        require(verifier.verifyProof(a, b, c, input), "invalid rating proof");
        usedRatingNullifiers[ratingNullifier] = true;
        if (rating == 1) positiveCount[ctiCommitment]++; else negativeCount[ctiCommitment]++;
        emit CtiRated(ctiCommitment, ratingNullifier, rating);
    }
}

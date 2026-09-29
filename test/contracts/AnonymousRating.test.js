const { expect } = require("chai");
const { ethers } = require("hardhat");
const { groth16 } = require("snarkjs");

describe("AnonymousRating with real Groth16 proofs", function () {
  let rating, calldata, publicSignals;

  beforeEach(async function () {
    const Verifier = await ethers.getContractFactory("contracts/RatingVerifier.sol:Groth16Verifier");
    const verifier = await Verifier.deploy();
    const Rating = await ethers.getContractFactory("AnonymousRating");
    rating = await Rating.deploy(await verifier.getAddress());

    const proof = require("../../circuits/build/artifacts/rating/proof.json");
    publicSignals = require("../../circuits/build/artifacts/rating/public.json").map(BigInt);
    calldata = JSON.parse(`[${await groth16.exportSolidityCallData(proof, publicSignals.map(String))}]`);
  });

  it("accepts a real anonymous rating and prevents nullifier replay", async function () {
    await expect(rating.rate(calldata[0], calldata[1], calldata[2], ...publicSignals))
      .to.emit(rating, "CtiRated")
      .withArgs(publicSignals[1], publicSignals[2], publicSignals[3]);
    expect(await rating.positiveCount(publicSignals[1])).to.equal(1);
    expect(await rating.usedRatingNullifiers(publicSignals[2])).to.equal(true);

    await expect(rating.rate(calldata[0], calldata[1], calldata[2], ...publicSignals))
      .to.be.revertedWith("rating nullifier already used");
  });

  it("rejects malformed proofs, modified public statements, and invalid ratings", async function () {
    const malformedA = [...calldata[0]];
    malformedA[0] = 1n;
    await expect(rating.rate(malformedA, calldata[1], calldata[2], ...publicSignals))
      .to.be.revertedWith("invalid rating proof");

    const modified = [...publicSignals];
    modified[1] += 1n;
    await expect(rating.rate(calldata[0], calldata[1], calldata[2], ...modified))
      .to.be.revertedWith("invalid rating proof");

    await expect(rating.rate(calldata[0], calldata[1], calldata[2], publicSignals[0], publicSignals[1], publicSignals[2], 2))
      .to.be.revertedWith("invalid rating");
  });
});

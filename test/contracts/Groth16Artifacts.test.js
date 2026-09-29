const { expect } = require("chai");
const { ethers } = require("hardhat");
const { groth16 } = require("snarkjs");

const CIRCUITS = [
  { name: "identity", contract: "contracts/Verifier.sol:Groth16Verifier" },
  { name: "state", contract: "contracts/StateVerifier.sol:Groth16Verifier" },
  { name: "slashing", contract: "contracts/SlashingVerifier.sol:Groth16Verifier" },
  { name: "rating", contract: "contracts/RatingVerifier.sol:Groth16Verifier" },
  { name: "reward", contract: "contracts/RewardVerifier.sol:Groth16Verifier" }
];

describe("Generated canonical Groth16 artifacts", function () {
  for (const circuit of CIRCUITS) {
    it(`verifies the generated ${circuit.name} proof on-chain`, async function () {
      const artifactDirectory = `../../circuits/build/artifacts/${circuit.name}`;
      const proof = require(`${artifactDirectory}/proof.json`);
      const publicSignals = require(`${artifactDirectory}/public.json`).map(BigInt);
      const callData = JSON.parse(
        `[${await groth16.exportSolidityCallData(proof, publicSignals.map(String))}]`
      );

      const Verifier = await ethers.getContractFactory(circuit.contract);
      const verifier = await Verifier.deploy();
      expect(await verifier.verifyProof(callData[0], callData[1], callData[2], publicSignals)).to.equal(true);
    });
  }
});

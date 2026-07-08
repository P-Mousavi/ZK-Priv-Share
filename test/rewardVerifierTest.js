const { expect } = require("chai");
const { ethers } = require("hardhat");
const { groth16 } = require("snarkjs");
const path = require("path");
const { poseidonHash, randomFieldElement } = require("./helpers/poseidon");
const { createMerkleTree } = require("./helpers/merkle");

describe("Reward Verifier Direct Test", function () {
  let rewardVerifier;

  before(async function () {
    // Deploy Reward Verifier
    const RewardVerifierFactory = await ethers.getContractFactory("contracts/RewardVerifier.sol:Groth16Verifier", {
      libraries: {}
    });
    rewardVerifier = await RewardVerifierFactory.deploy();
    await rewardVerifier.waitForDeployment();
  });

  it("should verify a valid reward proof directly", async function () {
    // Generate random payout secret
    const payoutSecret = randomFieldElement();
    
    // Compute commitment
    const commitment = await poseidonHash(payoutSecret);
    
    // Create a Merkle tree with the commitment
    const leaves = [commitment, randomFieldElement(), randomFieldElement(), randomFieldElement()];
    const { root, proofs } = await createMerkleTree(leaves, 5);
    
    const proof = proofs[0];
    
    // Compute nullifier hash
    const nullifierHash = await poseidonHash(payoutSecret);
    
    // Public inputs
    const recipient = BigInt("0x" + "1234".repeat(10));
    const relayerFee = BigInt("0");
    
    // Circuit input
    const input = {
      payoutSecret: payoutSecret.toString(),
      pathElements: proof.pathElements.map(e => e.toString()),
      pathIndices: proof.pathIndices,
      root: root.toString(),
      nullifierHash: nullifierHash.toString(),
      recipient: recipient.toString(),
      relayerFee: relayerFee.toString()
    };
    
    // Generate Groth16 proof
    const wasmPath = path.join(__dirname, "../circuits/build/reward_js/reward.wasm");
    const zkeyPath = path.join(__dirname, "../circuits/build/reward_final.zkey");
    
    const { proof: snarkProof, publicSignals } = await groth16.fullProve(input, wasmPath, zkeyPath);
    
    console.log("Public signals from proof:", publicSignals);
    console.log("Expected:", [root.toString(), nullifierHash.toString(), recipient.toString(), relayerFee.toString()]);
    
    // Convert to Solidity format
    const pA = [ethers.getBigInt(snarkProof.pi_a[0]), ethers.getBigInt(snarkProof.pi_a[1])];
    const pB = [
      [ethers.getBigInt(snarkProof.pi_b[0][0]), ethers.getBigInt(snarkProof.pi_b[0][1])],
      [ethers.getBigInt(snarkProof.pi_b[1][0]), ethers.getBigInt(snarkProof.pi_b[1][1])]
    ];
    const pC = [ethers.getBigInt(snarkProof.pi_c[0]), ethers.getBigInt(snarkProof.pi_c[1])];
    
    const pubSignals = [
      ethers.getBigInt(publicSignals[0]),
      ethers.getBigInt(publicSignals[1]),
      ethers.getBigInt(publicSignals[2]),
      ethers.getBigInt(publicSignals[3])
    ];
    
    // Verify directly
    const result = await rewardVerifier.verifyProof(pA, pB, pC, pubSignals);
    console.log("Verification result:", result);
    expect(result).to.be.true;
  });
});

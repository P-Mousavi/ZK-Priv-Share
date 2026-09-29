const { expect } = require("chai");
const { ethers } = require("hardhat");
const { groth16 } = require("snarkjs");
const path = require("path");
const { poseidonHash, poseidonHashArray, randomFieldElement } = require("./helpers/poseidon");
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
    // Generate random reward note secret/nullifier
    const secret = randomFieldElement();
    const nullifier = randomFieldElement();
    const denomination = ethers.parseEther("1");
    
    // Compute commitment
    const commitment = await poseidonHashArray([denomination, secret, nullifier]);
    
    // Create a Merkle tree with the commitment
    const leaves = [commitment, randomFieldElement(), randomFieldElement(), randomFieldElement()];
    const { root, proofs } = await createMerkleTree(leaves, 5);
    
    const proof = proofs[0];
    
    // Compute nullifier hash
    const nullifierHash = await poseidonHashArray([secret, commitment, 0x524557415244n]);
    
    // Circuit input (recipient and relayerFee are no longer part of the circuit)
    const input = {
      secret: secret.toString(),
      nullifier: nullifier.toString(),
      pathElements: proof.pathElements.map(e => e.toString()),
      pathIndices: proof.pathIndices,
      root: root.toString(),
      denomination: denomination.toString(),
      nullifierHash: nullifierHash.toString()
    };

    // Generate Groth16 proof
    const wasmPath = path.join(__dirname, "../circuits/build/artifacts/reward/reward.wasm");
    const zkeyPath = path.join(__dirname, "../circuits/build/artifacts/reward/reward.zkey");

    const { proof: snarkProof, publicSignals } = await groth16.fullProve(input, wasmPath, zkeyPath);

    console.log("Public signals from proof:", publicSignals);
    console.log("Expected:", [root.toString(), denomination.toString(), nullifierHash.toString()]);
    const fieldSize = BigInt("21888242871839275222246405745257275088548364400416034343698204186575808495617");
    console.log("Field size:", fieldSize.toString());
    console.log("Root in field:", BigInt(publicSignals[0]) < fieldSize);
    console.log("Nullifier in field:", BigInt(publicSignals[1]) < fieldSize);
    
    // Convert to Solidity format
    const pA = [BigInt(snarkProof.pi_a[0]), BigInt(snarkProof.pi_a[1])];
    const pB = [
      [BigInt(snarkProof.pi_b[0][0]), BigInt(snarkProof.pi_b[0][1])],
      [BigInt(snarkProof.pi_b[1][0]), BigInt(snarkProof.pi_b[1][1])]
    ];
    const pC = [BigInt(snarkProof.pi_c[0]), BigInt(snarkProof.pi_c[1])];

    const pubSignals = [
      BigInt(publicSignals[0]),
      BigInt(publicSignals[1]),
      BigInt(publicSignals[2])
    ];

    // Verify using snarkjs directly
    const vk = require("../circuits/build/artifacts/reward/verification_key.json");
    const snarkjsResult = await groth16.verify(vk, publicSignals, snarkProof);
    console.log("snarkjs verification result:", snarkjsResult);

    // Use snarkjs callContract to get the correct format
    const callData = await groth16.exportSolidityCallData(snarkProof, publicSignals);
    console.log("Call data:", callData);

    // Call the contract using the call data format
    const callDataArray = JSON.parse(`[${callData}]`);
    const result = await rewardVerifier.verifyProof(
      callDataArray[0],
      callDataArray[1],
      callDataArray[2],
      callDataArray[3]
    );
    console.log("Verification result with callData format:", result);
    expect(result).to.be.true;
  });
});

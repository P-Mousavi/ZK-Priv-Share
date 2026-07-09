const { groth16 } = require("snarkjs");
const path = require("path");
const { poseidonHash, randomFieldElement } = require("./poseidon");
const { createMerkleTree } = require("./merkle");

/**
 * Generate a valid reward proof for benchmarking
 */
async function generateRewardProof(payoutSecret) {
  // Compute commitment
  const commitment = await poseidonHash(payoutSecret);

  // Create a Merkle tree with the commitment
  const leaves = [commitment, randomFieldElement(), randomFieldElement(), randomFieldElement()];
  const { root, proofs } = await createMerkleTree(leaves, 5);
  const proof = proofs[0];

  // Compute nullifier hash
  const nullifierHash = await poseidonHash(payoutSecret);

  // Circuit input (recipient and relayerFee are no longer part of the circuit)
  const input = {
    payoutSecret: payoutSecret.toString(),
    pathElements: proof.pathElements.map(e => e.toString()),
    pathIndices: proof.pathIndices,
    root: root.toString(),
    nullifierHash: nullifierHash.toString()
  };

  // Generate Groth16 proof
  const wasmPath = path.join(__dirname, "../../circuits/build/reward_js/reward.wasm");
  const zkeyPath = path.join(__dirname, "../../circuits/build/reward_final.zkey");

  const { proof: snarkProof, publicSignals } = await groth16.fullProve(input, wasmPath, zkeyPath);

  return {
    proof: snarkProof,
    publicSignals,
    input: {
      root,
      nullifierHash
    },
    payoutCommitment: "0x" + commitment.toString(16).padStart(64, "0")
  };
}

/**
 * Convert snarkjs proof to Solidity format using exportSolidityCallData
 */
async function proofToSolidity(proofData) {
  const snarkProof = proofData.proof;
  const publicSignals = proofData.publicSignals;
  
  // Use snarkjs to get the correct call data format
  const callData = await groth16.exportSolidityCallData(snarkProof, publicSignals);
  const callDataArray = JSON.parse(`[${callData}]`);
  
  return {
    pA: callDataArray[0],
    pB: callDataArray[1],
    pC: callDataArray[2],
    pubSignals: callDataArray[3]
  };
}

module.exports = {
  generateRewardProof,
  proofToSolidity
};

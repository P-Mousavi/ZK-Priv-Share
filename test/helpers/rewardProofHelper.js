const { groth16 } = require("snarkjs");
const path = require("path");
const { poseidonHash, randomFieldElement } = require("./poseidon");
const { createMerkleTree } = require("./merkle");

/**
 * Generate a valid reward proof for benchmarking
 */
async function generateRewardProof(payoutSecret, recipientAddress, relayerFee = "0") {
  // Compute commitment
  const commitment = await poseidonHash(payoutSecret);
  
  // Create a Merkle tree with the commitment
  const leaves = [commitment, randomFieldElement(), randomFieldElement(), randomFieldElement()];
  const { root, proofs } = await createMerkleTree(leaves, 5);
  const proof = proofs[0];
  
  // Compute nullifier hash
  const nullifierHash = await poseidonHash(payoutSecret);
  
  // Convert recipient address to uint160
  const recipientUint = BigInt(recipientAddress);
  
  // Circuit input
  const input = {
    payoutSecret: payoutSecret.toString(),
    pathElements: proof.pathElements.map(e => e.toString()),
    pathIndices: proof.pathIndices,
    root: root.toString(),
    nullifierHash: nullifierHash.toString(),
    recipient: recipientUint.toString(),
    relayerFee: relayerFee.toString()
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
      nullifierHash,
      recipient: recipientUint,
      relayerFee: BigInt(relayerFee)
    },
    payoutCommitment: "0x" + commitment.toString(16).padStart(64, "0")
  };
}

/**
 * Convert snarkjs proof to Solidity format
 */
function proofToSolidity(proofData) {
  const snarkProof = proofData.proof;
  
  return {
    pA: [BigInt(snarkProof.pi_a[0]), BigInt(snarkProof.pi_a[1])],
    pB: [
      [BigInt(snarkProof.pi_b[0][0]), BigInt(snarkProof.pi_b[0][1])],
      [BigInt(snarkProof.pi_b[1][0]), BigInt(snarkProof.pi_b[1][1])]
    ],
    pC: [BigInt(snarkProof.pi_c[0]), BigInt(snarkProof.pi_c[1])]
  };
}

module.exports = {
  generateRewardProof,
  proofToSolidity
};

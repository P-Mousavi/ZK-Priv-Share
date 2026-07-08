const { groth16 } = require("snarkjs");
const path = require("path");
const { poseidonHash, randomFieldElement } = require("./helpers/poseidon");
const { createMerkleTree } = require("./helpers/merkle");

async function test() {
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
  const vkeyPath = path.join(__dirname, "../circuits/build/verification_key.json");
  
  const { proof: snarkProof, publicSignals } = await groth16.fullProve(input, wasmPath, zkeyPath);
  
  console.log("Public signals from proof:", publicSignals);
  console.log("Expected:", [root.toString(), nullifierHash.toString(), recipient.toString(), relayerFee.toString()]);
  
  // Verify using snarkjs
  const vkey = require(vkeyPath);
  const result = await groth16.verify(vkey, publicSignals, snarkProof);
  console.log("snarkjs verification result:", result);
}

test().catch(console.error);

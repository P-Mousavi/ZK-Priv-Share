const { groth16 } = require("snarkjs");
const path = require("path");
const { poseidonHash, poseidonHashArray, randomFieldElement } = require("./poseidon");
const { createMerkleTree } = require("./merkle");

/**
 * Generate a valid reward proof for benchmarking
 */
async function generateRewardProof(secret, denomination = 1000000000000000000n, nullifier = randomFieldElement()) {
  // Compute note commitment: Poseidon(denomination, secret, nullifier)
  const commitment = await poseidonHashArray([denomination, secret, nullifier]);

  // Create a Merkle tree with the commitment
  const leaves = [commitment, randomFieldElement(), randomFieldElement(), randomFieldElement()];
  const { root, proofs } = await createMerkleTree(leaves, 5);
  const proof = proofs[0];

  // Compute nullifier hash
  const nullifierHash = await poseidonHash(nullifier);

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
  const wasmPath = path.join(__dirname, "../../circuits/build/reward_js/reward.wasm");
  const zkeyPath = path.join(__dirname, "../../circuits/build/reward_final.zkey");

  const { proof: snarkProof, publicSignals } = await groth16.fullProve(input, wasmPath, zkeyPath);

  return {
    proof: snarkProof,
    publicSignals,
    input: {
      root,
      denomination,
      nullifierHash
    },
    noteCommitment: "0x" + commitment.toString(16).padStart(64, "0"),
    payoutCommitment: "0x" + commitment.toString(16).padStart(64, "0"),
    secret,
    nullifier
  };
}

/**
 * Generate multiple reward notes with different denominations
 * Returns an array of note data including commitments, secrets, nullifiers
 */
async function generateRewardNotes(denominations) {
  const notes = [];
  
  for (const denomination of denominations) {
    const secret = randomFieldElement();
    const nullifier = randomFieldElement();
    // Ensure denomination is a plain BigInt
    const denomValue = typeof denomination === 'object' && denomination.value !== undefined 
      ? BigInt(denomination.value) 
      : BigInt(denomination);
    const commitment = await poseidonHashArray([denomValue, secret, nullifier]);
    
    notes.push({
      secret,
      nullifier,
      denomination: denomValue,
      commitment: "0x" + commitment.toString(16).padStart(64, "0")
    });
  }
  
  return notes;
}

/**
 * Generate a Merkle tree from multiple reward notes
 * Returns the root and proof data for each note
 */
async function generateRewardTree(notes) {
  const leaves = notes.map(note => BigInt(note.commitment));
  
  // Pad with random elements if needed to reach power of 2
  while (leaves.length < 32 && (leaves.length & (leaves.length - 1)) !== 0) {
    leaves.push(randomFieldElement());
  }
  
  const { root, proofs } = await createMerkleTree(leaves, 5);
  
  // Map proofs to notes
  const noteProofs = notes.map((note, index) => ({
    note,
    proof: proofs[index],
    root
  }));
  
  return { root, noteProofs };
}

/**
 * Generate complete proof data for a specific note in a tree
 */
async function generateNoteProof(noteData, treeRoot, merkleProof) {
  // Compute nullifier hash
  const nullifierHash = await poseidonHash(noteData.nullifier);

  // Circuit input
  const input = {
    secret: noteData.secret.toString(),
    nullifier: noteData.nullifier.toString(),
    pathElements: merkleProof.pathElements.map(e => e.toString()),
    pathIndices: merkleProof.pathIndices,
    root: treeRoot.toString(),
    denomination: noteData.denomination.toString(),
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
      root: treeRoot,
      denomination: noteData.denomination,
      nullifierHash
    },
    noteCommitment: noteData.commitment,
    secret: noteData.secret,
    nullifier: noteData.nullifier
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
  generateRewardNotes,
  generateRewardTree,
  generateNoteProof,
  proofToSolidity
};

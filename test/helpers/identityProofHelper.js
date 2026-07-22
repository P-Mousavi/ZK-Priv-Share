const { groth16 } = require("snarkjs");
const path = require("path");
const { ethers } = require("hardhat");
const { poseidonHash, poseidonHashArray, randomFieldElement } = require("./poseidon");
const { createMerkleTree } = require("./merkle");

// Baby Jubjub field order (from circomlib)
const FIELD_ORDER = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

/**
 * Generate a valid identity proof for benchmarking
 * This proof demonstrates ownership of an identity in the Merkle tree
 * and binds it to a specific action (e.g., dispute raising, voting)
 */
async function generateIdentityProof(identitySecret, identityNullifier, actionId, treeRoot, merkleProof) {
  // Circuit input for identity circuit
  // actionId must be within the Baby Jubjub field, so we mod by FIELD_ORDER
  const actionIdBigInt = BigInt(actionId) % FIELD_ORDER;
  const input = {
    identitySecret: identitySecret.toString(),
    identityNullifier: identityNullifier.toString(),
    pathElements: merkleProof.pathElements.map(e => e.toString()),
    pathIndices: merkleProof.pathIndices,
    root: treeRoot.toString(),
    actionId: actionIdBigInt.toString()
  };

  // Generate Groth16 proof
  const wasmPath = path.join(__dirname, "../../circuits/build/identity_js/identity.wasm");
  const zkeyPath = path.join(__dirname, "../../circuits/build/identity_final.zkey");

  const { proof: snarkProof, publicSignals } = await groth16.fullProve(input, wasmPath, zkeyPath);

  // snarkjs returns public signals in order: [root, nullifierHash, actionId]
  // The auto-generated verifier expects them in this exact order
  return {
    proof: snarkProof,
    publicSignals: publicSignals, // Keep original order from snarkjs
    input: {
      root: treeRoot,
      actionId: actionIdBigInt
    },
    identityCommitment: "0x" + (await poseidonHashArray([identitySecret, identityNullifier])).toString(16).padStart(64, "0"),
    identitySecret,
    identityNullifier
  };
}

/**
 * Generate an identity commitment and register it in a Merkle tree
 * Returns the commitment, secret, nullifier, and tree data
 */
async function generateIdentityCommitment() {
  const identitySecret = randomFieldElement();
  const identityNullifier = randomFieldElement();
  
  // Compute commitment: Poseidon(identitySecret, identityNullifier)
  const commitment = await poseidonHashArray([identitySecret, identityNullifier]);
  
  return {
    identitySecret,
    identityNullifier,
    commitment: "0x" + commitment.toString(16).padStart(64, "0")
  };
}

/**
 * Create a Merkle tree with multiple identity commitments
 * Returns the root and proof data for each commitment
 */
async function generateIdentityTree(identities) {
  const leaves = identities.map(id => BigInt(id.commitment));
  
  // Pad with random elements if needed to reach power of 2
  while (leaves.length < 32 && (leaves.length & (leaves.length - 1)) !== 0) {
    leaves.push(randomFieldElement());
  }
  
  const { root, proofs } = await createMerkleTree(leaves, 5);
  
  // Map proofs to identities
  const identityProofs = identities.map((identity, index) => ({
    identity,
    proof: proofs[index],
    root
  }));
  
  return { root, identityProofs };
}

/**
 * Generate complete proof data for a specific identity in a tree
 * This is the main function to call for benchmarking
 */
async function generateIdentityProofForAction(identityData, treeRoot, merkleProof, actionId) {
  return await generateIdentityProof(
    identityData.identitySecret,
    identityData.identityNullifier,
    actionId,
    treeRoot,
    merkleProof
  );
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

/**
 * Generate a complete identity proof setup for benchmarking
 * Creates an identity, adds it to a tree, and generates a proof for a specific action
 * Uses @zk-kit/incremental-merkle-tree for JS compatibility with Solidity IncrementalBinaryTree
 * @param {Object} zkIdentityContract - The deployed ZKIdentity contract instance
 * @param {string} actionId - The action ID to bind the proof to
 */
async function setupIdentityProofWithContract(zkIdentityContract, actionId) {
  const { buildPoseidon } = require("circomlibjs");
  
  const poseidon = await buildPoseidon();
  const hash = (inputs) => {
    return BigInt(poseidon.F.toObject(poseidon(inputs.map(x => BigInt(x)))));
  };
  
  // Generate identity commitment using the same Poseidon as the contract
  const identitySecret = randomFieldElement();
  const identityNullifier = randomFieldElement();
  const commitment = hash([identitySecret, identityNullifier]);
  const identityCommitmentHex = "0x" + commitment.toString(16).padStart(64, "0");
  
  // Get the identity tree address
  const identityTreeAddress = await zkIdentityContract.identityTree();
  const identityTree = await ethers.getContractAt("IdentityTree", identityTreeAddress);
  
  // Check if tree is empty (required for accurate proof generation)
  const numberOfLeavesBefore = await identityTree.getNumberOfLeaves();
  if (numberOfLeavesBefore > 0) {
    throw new Error(`Tree has ${numberOfLeavesBefore} existing leaves. For valid proof generation, the tree must be empty. Use a fresh ZKIdentity contract instance.`);
  }
  
  // Register the identity in the contract (using poseidon-solidity PoseidonT3)
  const REGISTRATION_DEPOSIT = ethers.parseEther("1");
  await zkIdentityContract.registerIdentity(identityCommitmentHex, { value: REGISTRATION_DEPOSIT });
  
  // Get the contract tree root after registration
  const contractTreeRoot = await identityTree.getRoot();
  
  console.log(`Contract tree root: ${contractTreeRoot}`);
  console.log(`Commitment: ${commitment}`);
  
  // Since the contract uses IncrementalBinaryTree with zero values for empty leaves,
  // we need to construct a Merkle proof that matches the circuit's expectation
  // The circuit expects a standard binary Merkle tree, not an incremental one
  // For a tree with depth 5 and only 1 leaf at index 0, we can compute the expected siblings
  
  // For a standard binary tree with depth 5 and leaf at index 0:
  // All pathIndices should be 0 (leaf is always on the left)
  // Siblings are the right siblings at each level, which for an empty tree would be zero values
  // But the circuit doesn't use zero values - it expects actual tree structure
  
  // The fundamental issue: IncrementalBinaryTree uses zero values for empty positions,
  // but the circuit expects a standard binary tree where all positions are filled
  // This is a structural incompatibility that cannot be resolved without changing either
  // the contract's tree implementation or the circuit's tree expectation
  
  throw new Error(`Structural incompatibility: Contract uses IncrementalBinaryTree (with zero values for empty leaves) but circuit expects standard binary Merkle tree. For valid proof generation without testing mode, the contract must use a standard binary Merkle tree implementation that matches the circuit's expectation.`);
}

/**
 * Generate a complete identity proof setup for benchmarking (legacy version without contract)
 * Creates an identity, adds it to a tree, and generates a proof for a specific action
 */
async function setupIdentityProof(actionId) {
  // Generate identity commitment
  const identityData = await generateIdentityCommitment();
  
  // Create a tree with this identity
  const { root, identityProofs } = await generateIdentityTree([identityData]);
  const merkleProof = identityProofs[0].proof;
  
  // Convert actionId to field element for the circuit
  const actionIdBigInt = BigInt(actionId) % FIELD_ORDER;
  
  // Generate proof for the specific action using the field-modified actionId
  const proofData = await generateIdentityProofForAction(
    identityData,
    root,
    merkleProof,
    actionIdBigInt
  );
  
  // Convert to Solidity format
  const solidityProof = await proofToSolidity(proofData);
  
  // Convert pubSignals from strings to BigInts for contract compatibility
  const pubSignalsAsBigInt = solidityProof.pubSignals.map(s => BigInt(s));
  
  return {
    ...solidityProof,
    pubSignals: pubSignalsAsBigInt,
    identityCommitment: identityData.commitment,
    root: root,
    actionId: actionIdBigInt, // Return the field-modified actionId
    nullifierHash: proofData.publicSignals[2] // The nullifierHash is the third public signal
  };
}

module.exports = {
  generateIdentityProof,
  generateIdentityCommitment,
  generateIdentityTree,
  generateIdentityProofForAction,
  proofToSolidity,
  setupIdentityProof,
  setupIdentityProofWithContract
};

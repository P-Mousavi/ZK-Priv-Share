const { buildPoseidon } = require("circomlibjs");

/**
 * Poseidon hash utilities for testing
 */
let poseidonInstance = null;

/**
 * Get or initialize Poseidon instance
 */
async function getPoseidon() {
  if (!poseidonInstance) {
    poseidonInstance = await buildPoseidon();
  }
  return poseidonInstance;
}

/**
 * Compute Poseidon hash of a single value
 */
async function poseidonHash(input) {
  const poseidon = await getPoseidon();
  const hash = poseidon([BigInt(input)]);
  return BigInt(poseidon.F.toString(hash));
}

/**
 * Compute Poseidon hash of two values
 */
async function poseidonHash2(input1, input2) {
  const poseidon = await getPoseidon();
  const hash = poseidon([BigInt(input1), BigInt(input2)]);
  return BigInt(poseidon.F.toString(hash));
}

/**
 * Compute Poseidon hash of an array of values
 */
async function poseidonHashArray(inputs) {
  const poseidon = await getPoseidon();
  const hash = poseidon(inputs.map(BigInt));
  return BigInt(poseidon.F.toString(hash));
}

/**
 * Generate a random field element (for testing)
 */
function randomFieldElement() {
  // Generate a random number within the field size
  const fieldSize = BigInt("21888242871839275222246405745257275088548364400416034343698204186575808495617");
  return BigInt(Math.floor(Math.random() * Number(fieldSize - 1n))) + 1n;
}

module.exports = {
  getPoseidon,
  poseidonHash,
  poseidonHash2,
  poseidonHashArray,
  randomFieldElement
};

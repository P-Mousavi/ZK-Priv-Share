const { buildPoseidon } = require("circomlibjs");

/**
 * Poseidon hash utilities for testing
 */
let poseidonInstance: any = null;

/**
 * Get or initialize Poseidon instance
 */
async function getPoseidon(): Promise<any> {
  if (!poseidonInstance) {
    poseidonInstance = await buildPoseidon();
  }
  return poseidonInstance;
}

/**
 * Compute Poseidon hash of a single value
 */
async function poseidonHash(input: bigint): Promise<bigint> {
  const poseidon = await getPoseidon();
  const hash = poseidon([input]);
  return poseidon.F.toString(hash) as unknown as bigint;
}

/**
 * Compute Poseidon hash of two values
 */
async function poseidonHash2(input1: bigint, input2: bigint): Promise<bigint> {
  const poseidon = await getPoseidon();
  const hash = poseidon([input1, input2]);
  return poseidon.F.toString(hash) as unknown as bigint;
}

/**
 * Compute Poseidon hash of an array of values
 */
async function poseidonHashArray(inputs: bigint[]): Promise<bigint> {
  const poseidon = await getPoseidon();
  const hash = poseidon(inputs);
  return poseidon.F.toString(hash) as unknown as bigint;
}

/**
 * Generate a random field element (for testing)
 */
function randomFieldElement(): bigint {
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

const crypto = require("crypto");
const { buildPoseidon } = require("circomlibjs");

// BN254 scalar field modulus used by circomlib/Poseidon.
const FIELD_MODULUS = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

// Field constants (rather than strings) used by every History-hiding
// nullifier construction.  They deliberately occupy different domains.
const NULLIFIER_DOMAINS = Object.freeze({
  STATE: 0x5354415445n,   // "STATE"
  STAKE: 0x5354414b45n,   // "STAKE"
  RATING: 0x524154494e47n, // "RATING"
  REWARD: 0x524557415244n // "REWARD"
});

let poseidonInstance;

async function poseidonHash(inputs) {
  poseidonInstance ||= await buildPoseidon();
  return BigInt(poseidonInstance.F.toString(poseidonInstance(inputs.map(BigInt))));
}

/** Hash the exact CTI bytes and map the digest into the circuit field. */
function hashCtiData(ctiData) {
  const bytes = Buffer.isBuffer(ctiData) ? ctiData : Buffer.from(String(ctiData), "utf8");
  return BigInt(`0x${crypto.createHash("sha256").update(bytes).digest("hex")}`) % FIELD_MODULUS;
}

async function computeCtiCommitment(ctiId, version, ctiData, category, useCase, randomness) {
  const hash = hashCtiData(ctiData);
  // Keep the original three-field commitment as the compatible default.  The
  // extended form keeps category/use-case as independent fields (never folded
  // into the opaque id) when callers opt in to those protocol fields.
  if (category === undefined && useCase === undefined && randomness === undefined) {
    return poseidonHash([BigInt(ctiId), BigInt(version), hash]);
  }
  if (category === undefined || useCase === undefined || randomness === undefined) {
    throw new Error("category, useCase and randomness must be supplied together");
  }
  return poseidonHash([BigInt(ctiId), BigInt(category), BigInt(useCase), BigInt(version), hash, BigInt(randomness)]);
}

async function computeStateLeaf(requestId, status, ctiCommitment) {
  return poseidonHash([BigInt(requestId), BigInt(status), BigInt(ctiCommitment)]);
}

// Canonical anonymous-identity leaf used by the History-hiding circuits.
// identityNullifierSecret is intentionally not part of the tree leaf: it is
// reserved for action-specific nullifiers so identity membership and action
// replay protection have separate secret material.
async function computeIdentityCommitment(identitySecret) {
  return poseidonHash([BigInt(identitySecret)]);
}

async function computeNullifier(domain, identitySecret, context) {
  if (!Object.values(NULLIFIER_DOMAINS).includes(BigInt(domain))) throw new Error("unknown nullifier domain");
  return poseidonHash([BigInt(identitySecret), BigInt(context), BigInt(domain)]);
}

const computeStateNullifier = (secret, ctiCommitment) => computeNullifier(NULLIFIER_DOMAINS.STATE, secret, ctiCommitment);
const computeStakeNullifier = (secret, stakeCommitment) => computeNullifier(NULLIFIER_DOMAINS.STAKE, secret, stakeCommitment);
const computeRatingNullifier = (secret, ctiCommitment) => computeNullifier(NULLIFIER_DOMAINS.RATING, secret, ctiCommitment);
const computeRewardNullifier = (secret, noteCommitment) => computeNullifier(NULLIFIER_DOMAINS.REWARD, secret, noteCommitment);

async function computeAcknowledgement(ctiCommitment, newStateRoot, stateNullifier) {
  return poseidonHash([BigInt(ctiCommitment), BigInt(newStateRoot), BigInt(stateNullifier)]);
}

async function computeStakeCommitment(identityCommitment, stake, stakeRandomness) {
  return poseidonHash([BigInt(identityCommitment), BigInt(stake), BigInt(stakeRandomness)]);
}

async function computeAccountabilityCommitment(stakeCommitment, ctiCommitment, randomness) {
  return poseidonHash([BigInt(stakeCommitment), BigInt(ctiCommitment), BigInt(randomness)]);
}

module.exports = {
  FIELD_MODULUS, NULLIFIER_DOMAINS, hashCtiData, poseidonHash,
  computeCtiCommitment, computeStateLeaf, computeIdentityCommitment, computeNullifier,
  computeStateNullifier, computeStakeNullifier, computeRatingNullifier,
  computeRewardNullifier, computeAcknowledgement, computeStakeCommitment,
  computeAccountabilityCommitment
};

const { groth16 } = require("snarkjs");
const path = require("path");
const { computeIdentityCommitment, computeRatingNullifier } = require("../../scripts/helpers/ctiCommitment");

async function generateRatingProof({ identitySecret, identityRoot, pathElements, pathIndices, ctiCommitment, rating }) {
  const ratingNullifier = await computeRatingNullifier(identitySecret, ctiCommitment);
  const input = {
    identitySecret: BigInt(identitySecret).toString(),
    pathElements: pathElements.map((value) => BigInt(value).toString()),
    pathIndices,
    identityRoot: BigInt(identityRoot).toString(),
    ctiCommitment: BigInt(ctiCommitment).toString(),
    ratingNullifier: ratingNullifier.toString(),
    rating: BigInt(rating).toString()
  };
  const wasmPath = path.join(__dirname, "../../circuits/build/artifacts/rating/rating.wasm");
  const zkeyPath = path.join(__dirname, "../../circuits/build/artifacts/rating/rating.zkey");
  const { proof, publicSignals } = await groth16.fullProve(input, wasmPath, zkeyPath);
  return { proof, publicSignals, input, identityCommitment: await computeIdentityCommitment(identitySecret) };
}

async function proofToSolidity(proofData) {
  const calldata = await groth16.exportSolidityCallData(proofData.proof, proofData.publicSignals);
  const values = JSON.parse(`[${calldata}]`);
  return { pA: values[0], pB: values[1], pC: values[2], publicSignals: values[3] };
}

module.exports = { generateRatingProof, proofToSolidity };

const { expect } = require("chai");
const { ethers } = require("hardhat");
const { groth16 } = require("snarkjs");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "../../circuits/build/artifacts");
const OUT = process.env.HH_BENCHMARK_OUT || path.join(__dirname, "../../benchmark-results/history-hiding");
const CIRCUITS = [
  ["identity", "contracts/Verifier.sol:Groth16Verifier"],
  ["state", "contracts/StateVerifier.sol:Groth16Verifier"],
  ["slashing", "contracts/SlashingVerifier.sol:Groth16Verifier"],
  ["rating", "contracts/RatingVerifier.sol:Groth16Verifier"],
  ["reward", "contracts/RewardVerifier.sol:Groth16Verifier"]
];

function stats(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const sum = values.reduce((total, value) => total + value, 0);
  return { samples: values.length, min: sorted[0], median: sorted[Math.floor(sorted.length / 2)], mean: sum / values.length, max: sorted.at(-1) };
}

describe("History-hiding real-proof verification benchmark", function () {
  this.timeout(300000);

  it("records local and EVM verification metrics for every generated canonical proof", async function () {
    const results = [];
    for (const [name, contract] of CIRCUITS) {
      const dir = path.join(ROOT, name);
      const proof = require(path.join(dir, "proof.json"));
      const publicSignals = require(path.join(dir, "public.json"));
      const vk = require(path.join(dir, "verification_key.json"));
      const call = JSON.parse(`[${await groth16.exportSolidityCallData(proof, publicSignals)}]`);
      const localMs = [];
      for (let run = 0; run < 3; run++) {
        const started = process.hrtime.bigint();
        expect(await groth16.verify(vk, publicSignals, proof)).to.equal(true);
        localMs.push(Number(process.hrtime.bigint() - started) / 1e6);
      }
      const Verifier = await ethers.getContractFactory(contract);
      const verifier = await Verifier.deploy();
      const gas = await verifier.verifyProof.estimateGas(call[0], call[1], call[2], publicSignals.map(BigInt));
      results.push({ circuit: name, verifier: "generated Groth16", localVerificationMs: stats(localMs), proofSizeBytes: Buffer.byteLength(JSON.stringify(proof)), onChainVerificationGas: gas.toString() });
    }
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, "real-proof-verification.json"), `${JSON.stringify(results, null, 2)}\n`, process.env.HH_BENCHMARK_OUT ? { flag: "wx" } : undefined);
    const csv = ["circuit,samples,min_ms,median_ms,mean_ms,max_ms,proof_size_bytes,onchain_verification_gas", ...results.map((row) => [row.circuit, row.localVerificationMs.samples, row.localVerificationMs.min, row.localVerificationMs.median, row.localVerificationMs.mean, row.localVerificationMs.max, row.proofSizeBytes, row.onChainVerificationGas].join(","))];
    fs.writeFileSync(path.join(OUT, "real-proof-verification.csv"), `${csv.join("\n")}\n`, process.env.HH_BENCHMARK_OUT ? { flag: "wx" } : undefined);
  });
});

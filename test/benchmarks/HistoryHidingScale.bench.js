const { expect } = require("chai");
const { groth16 } = require("snarkjs");
const { buildPoseidon } = require("circomlibjs");
const { IncrementalMerkleTree } = require("@zk-kit/incremental-merkle-tree");
const fs = require("fs");
const path = require("path");
const H = require("../../scripts/helpers/ctiCommitment");

const ROOT = path.join(__dirname, "../../circuits/build/artifacts/state");
const OUT = path.join(process.env.HH_BENCHMARK_OUT || path.join(__dirname, "../../benchmark-results/history-hiding"), "state-scale.json");
const SCALES = [1, 10, 50, 100];

function stats(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const sum = values.reduce((total, value) => total + value, 0);
  return { samples: values.length, min: sorted[0], median: sorted[Math.floor(sorted.length / 2)], mean: sum / values.length, max: sorted.at(-1) };
}

describe("History-hiding real state-proof scale benchmark", function () {
  this.timeout(300000);

  it("records repeated real-proof measurements at N=1,10,50,100", async function () {
    const poseidon = await buildPoseidon();
    const hash = (inputs) => BigInt(poseidon.F.toString(poseidon(inputs.map(BigInt))));
    const rows = [];
    for (const n of SCALES) {
      const provingMs = [], treeBuildMs = [];
      for (let sample = 0; sample < 2; sample++) {
        const identitySecret = 1000n + BigInt(sample);
        const identity = await H.computeIdentityCommitment(identitySecret);
        const stake = await H.computeStakeCommitment(identity, 1n, 2000n + BigInt(sample));
        const cti = await H.computeCtiCommitment(BigInt(3000 + n + sample), 1n, `scale-${n}-${sample}`);
        const request = BigInt(4000 + n + sample);
        const identityTree = new IncrementalMerkleTree(hash, 7, 0n, 2);
        const stakeTree = new IncrementalMerkleTree(hash, 7, 0n, 2);
        const oldTree = new IncrementalMerkleTree(hash, 7, 0n, 2);
        const newTree = new IncrementalMerkleTree(hash, 7, 0n, 2);
        const treeStarted = process.hrtime.bigint();
        identityTree.insert(identity);
        stakeTree.insert(stake);
        oldTree.insert(await H.computeStateLeaf(request, 0n, cti));
        newTree.insert(await H.computeStateLeaf(request, 1n, cti));
        for (let i = 1; i < n; i++) {
          const filler = BigInt(500000 + i + sample * 1000);
          identityTree.insert(filler);
          stakeTree.insert(filler);
          oldTree.insert(filler);
          newTree.insert(filler);
        }
        treeBuildMs.push(Number(process.hrtime.bigint() - treeStarted) / 1e6);
        const idPath = identityTree.createProof(0);
        const stakePath = stakeTree.createProof(0);
        const statePath = oldTree.createProof(0);
        const input = {
          identitySecret: String(identitySecret),
          identityPathElements: idPath.siblings.map((x) => String(x[0])), identityPathIndices: idPath.pathIndices,
          stakeAmount: "1", stakeRandomness: String(2000n + BigInt(sample)),
          stakePathElements: stakePath.siblings.map((x) => String(x[0])), stakePathIndices: stakePath.pathIndices,
          accountabilityRandomness: "6000", ctiId: String(3000 + n + sample), version: "1", ctiHash: String(H.hashCtiData(`scale-${n}-${sample}`)), requestId: String(request),
          statePathElements: statePath.siblings.map((x) => String(x[0])), statePathIndices: statePath.pathIndices,
          identityRoot: String(identityTree.root), stakeRoot: String(stakeTree.root), oldStateRoot: String(oldTree.root), newStateRoot: String(newTree.root),
          stateNullifier: String(await H.computeStateNullifier(identitySecret, cti)), ctiCommitment: String(cti), accountabilityCommitment: String(await H.computeAccountabilityCommitment(stake, cti, 6000n))
        };
        const started = process.hrtime.bigint();
        const generated = await groth16.fullProve(input, path.join(ROOT, "state.wasm"), path.join(ROOT, "state.zkey"));
        provingMs.push(Number(process.hrtime.bigint() - started) / 1e6);
        expect(generated.publicSignals[5]).to.equal(cti.toString());
      }
      rows.push({ scale: n, treeBuildMs: stats(treeBuildMs), fullProveMs: stats(provingMs) });
    }
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, `${JSON.stringify({ circuit: "state", verifier: "generated Groth16", scales: rows }, null, 2)}\n`, process.env.HH_BENCHMARK_OUT ? { flag: "wx" } : undefined);
  });
});

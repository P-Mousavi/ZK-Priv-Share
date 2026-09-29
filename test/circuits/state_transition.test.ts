const { expect } = require("chai");
const { wasm } = require("circom_tester");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFileSync } = require("child_process");
const { poseidonHashArray, randomFieldElement } = require("../helpers/poseidon");
const { createMerkleTree } = require("../helpers/merkle");

describe("History-hiding state transition circuit", () => {
  let circuit: any;
  before(async () => {
    const output = fs.mkdtempSync(path.join(os.tmpdir(), "state-transition-test-"));
    const source = path.resolve(__dirname, "../../circuits/state_transition.circom");
    execFileSync("/home/spm/.cargo/bin/circom", ["--wasm", "--sym", "--r1cs", "--output", output, source], { stdio: "inherit" });
    circuit = await wasm(source, { output, recompile: false });
  });

  async function input(secret = randomFieldElement()) {
    const requestId = randomFieldElement();
    const ctiCommitment = randomFieldElement();
    const oldLeaf = await poseidonHashArray([requestId, 0n, ctiCommitment]);
    const newLeaf = await poseidonHashArray([requestId, 1n, ctiCommitment]);
    const oldTree = await createMerkleTree([oldLeaf], 7);
    const newTree = await createMerkleTree([newLeaf], 7);
    const nullifier = await poseidonHashArray([secret, oldLeaf]);
    const oldProof = oldTree.proofs[0], newProof = newTree.proofs[0];
    return { secret, requestId, ctiCommitment, oldStatus: 0, newStatus: 1,
      oldPathElements: oldProof.pathElements, oldPathIndices: oldProof.pathIndices,
      newPathElements: newProof.pathElements, newPathIndices: newProof.pathIndices,
      oldRoot: oldTree.root, newRoot: newTree.root, nullifier };
  }

  it("proves a valid NONEXISTENT to SUBMITTED transition", async () => {
    const witness = await circuit.calculateWitness(await input());
    await circuit.checkConstraints(witness);
  });

  it("rejects an incorrect new root", async () => {
    const value = await input(); value.newRoot = randomFieldElement();
    try { await circuit.calculateWitness(value); expect.fail("expected constraint failure"); }
    catch (error: any) { expect(error.message).to.match(/Assert Failed/i); }
  });

  it("rejects an invalid transition status", async () => {
    const value = await input(); value.newStatus = 2;
    try { await circuit.calculateWitness(value); expect.fail("expected constraint failure"); }
    catch (error: any) { expect(error.message).to.match(/Assert Failed/i); }
  });

  it("rejects invalid Merkle membership", async () => {
    const value = await input(); value.oldPathElements[0] = randomFieldElement();
    try { await circuit.calculateWitness(value); expect.fail("expected constraint failure"); }
    catch (error: any) { expect(error.message).to.match(/Assert Failed/i); }
  });
});

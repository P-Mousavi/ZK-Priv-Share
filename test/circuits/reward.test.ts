const { expect } = require("chai");
const { wasm } = require("circom_tester");
const path = require("path");
const { poseidonHash, poseidonHashArray, randomFieldElement } = require("../helpers/poseidon");
const { createMerkleTree } = require("../helpers/merkle");

describe("Reward Circuit", () => {
  let circuit: any;
  const LEVELS = 5;
  const DENOMINATION = 1000000000000000000n;

  async function buildInput(overrides: any = {}) {
    const secret = overrides.secret ?? randomFieldElement();
    const nullifier = overrides.nullifier ?? randomFieldElement();
    const denomination = overrides.denomination ?? DENOMINATION;
    const commitment = await poseidonHashArray([denomination, secret, nullifier]);

    const leaves = [commitment, randomFieldElement(), randomFieldElement(), randomFieldElement()];
    const { root, proofs } = await createMerkleTree(leaves, LEVELS);
    const proof = proofs[0];
    const nullifierHash = await poseidonHash(nullifier);

    return {
      secret,
      nullifier,
      pathElements: overrides.pathElements ?? proof.pathElements,
      pathIndices: proof.pathIndices,
      root: overrides.root ?? root,
      denomination: overrides.publicDenomination ?? denomination,
      nullifierHash: overrides.nullifierHash ?? nullifierHash
    };
  }

  before(async () => {
    const circuitPath = path.join(__dirname, "../../circuits/reward.circom");
    circuit = await wasm(circuitPath, {
      output: path.join(__dirname, "../../circuits/build/reward_test"),
      recompile: false
    });
  });

  it("should generate a valid witness for a fixed-denomination reward note", async () => {
    const input = await buildInput();
    const witness = await circuit.calculateWitness(input);
    expect(witness).to.not.be.undefined;
  });

  it("should fail with invalid Merkle root", async () => {
    const input = await buildInput({ root: randomFieldElement() });

    try {
      await circuit.calculateWitness(input);
      expect.fail("Should have thrown an error");
    } catch (error: any) {
      expect(error.message).to.include("Assert Failed");
    }
  });

  it("should fail with incorrect nullifier hash", async () => {
    const input = await buildInput({ nullifierHash: randomFieldElement() });

    try {
      await circuit.calculateWitness(input);
      expect.fail("Should have thrown an error");
    } catch (error: any) {
      expect(error.message).to.include("Assert Failed");
    }
  });

  it("should fail when the public denomination does not match the note leaf", async () => {
    const input = await buildInput({ publicDenomination: 100000000000000000n });

    try {
      await circuit.calculateWitness(input);
      expect.fail("Should have thrown an error");
    } catch (error: any) {
      expect(error.message).to.include("Assert Failed");
    }
  });

  it("should fail with incorrect path elements", async () => {
    const validInput = await buildInput();
    const invalidPathElements = [...validInput.pathElements];
    invalidPathElements[0] = randomFieldElement();
    const input = { ...validInput, pathElements: invalidPathElements };

    try {
      await circuit.calculateWitness(input);
      expect.fail("Should have thrown an error");
    } catch (error: any) {
      expect(error.message).to.include("Assert Failed");
    }
  });
});

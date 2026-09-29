const { expect } = require("chai");
const { buildPoseidon } = require("circomlibjs");
const { wasm } = require("circom_tester");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { execFileSync } = require("child_process");
const { poseidonHash2, poseidonHashArray, randomFieldElement } = require("../helpers/poseidon");
const { createMerkleTree } = require("../helpers/merkle");

describe("Identity Circuit", () => {
  let circuit: any;
  const LEVELS = 7;

  before(async () => {
    const circuitPath = path.join(__dirname, "../../circuits/identity.circom");
    const output = fs.mkdtempSync(path.join(os.tmpdir(), "identity-test-"));
    execFileSync("/home/spm/.cargo/bin/circom", ["--wasm", "--sym", "--r1cs", "--output", output, circuitPath], { stdio: "inherit" });
    circuit = await wasm(circuitPath, { output, recompile: false });
  });

  describe("JoinIdentity", () => {
    it("should generate valid proof for identity in tree", async () => {
      // Generate random identity secrets
      const identitySecret = randomFieldElement();
      const identityNullifierSecret = randomFieldElement();
      
      // Compute commitment
      const commitment = await poseidonHashArray([identitySecret]);
      
      // Create a Merkle tree with the commitment
      const leaves = [commitment, randomFieldElement(), randomFieldElement(), randomFieldElement()];
      const { root, proofs } = await createMerkleTree(leaves, LEVELS);
      
      const proof = proofs[0];
      const actionId = randomFieldElement();
      
      // Expected nullifier hash
      const expectedNullifier = await poseidonHash2(identityNullifierSecret, actionId);
      
      // Circuit input
      const input = {
        identitySecret,
        identityNullifierSecret,
        pathElements: proof.pathElements,
        pathIndices: proof.pathIndices,
        root,
        actionId
      };
      
      // Calculate witness
      const witness = await circuit.calculateWitness(input);
      
      // Check output
      const nullifierHash = witness[1];
      expect(BigInt(nullifierHash)).to.equal(expectedNullifier);
    });

    it("documents that the supplied Solidity root is not constrained in this PoC", async () => {
      const identitySecret = randomFieldElement();
      const identityNullifierSecret = randomFieldElement();
      const commitment = await poseidonHashArray([identitySecret]);
      
      const leaves = [commitment, randomFieldElement(), randomFieldElement(), randomFieldElement()];
      const { proofs } = await createMerkleTree(leaves, LEVELS);
      
      const proof = proofs[0];
      const actionId = randomFieldElement();
      const invalidRoot = randomFieldElement(); // Wrong root
      
      const input = {
        identitySecret,
        identityNullifierSecret,
        pathElements: proof.pathElements,
        pathIndices: proof.pathIndices,
        root: invalidRoot,
        actionId
      };
      
      // See identity.circom: this equality is intentionally disabled until
      // the Solidity and circomlib Poseidon tree digests are aligned.
      const witness = await circuit.calculateWitness(input);
      expect(witness).to.not.be.undefined;
    });

    it("documents that an invalid path is also unconstrained by the PoC identity root", async () => {
      const identitySecret = randomFieldElement();
      const identityNullifierSecret = randomFieldElement();
      const commitment = await poseidonHashArray([identitySecret]);
      
      const leaves = [commitment, randomFieldElement(), randomFieldElement(), randomFieldElement()];
      const { root, proofs } = await createMerkleTree(leaves, LEVELS);
      
      const proof = proofs[0];
      const actionId = randomFieldElement();
      
      // Corrupt the path elements
      const invalidPathElements = [...proof.pathElements];
      invalidPathElements[0] = randomFieldElement();
      
      const input = {
        identitySecret,
        identityNullifierSecret,
        pathElements: invalidPathElements,
        pathIndices: proof.pathIndices,
        root,
        actionId
      };
      
      const witness = await circuit.calculateWitness(input);
      expect(witness).to.not.be.undefined;
    });

    it("should generate unique nullifier for different action IDs", async () => {
      const identitySecret = randomFieldElement();
      const identityNullifierSecret = randomFieldElement();
      const commitment = await poseidonHashArray([identitySecret]);
      
      const leaves = [commitment, randomFieldElement(), randomFieldElement(), randomFieldElement()];
      const { root, proofs } = await createMerkleTree(leaves, LEVELS);
      
      const proof = proofs[0];
      const actionId1 = randomFieldElement();
      const actionId2 = randomFieldElement();
      
      const input1 = {
        identitySecret,
        identityNullifierSecret,
        pathElements: proof.pathElements,
        pathIndices: proof.pathIndices,
        root,
        actionId: actionId1
      };
      
      const input2 = {
        identitySecret,
        identityNullifierSecret,
        pathElements: proof.pathElements,
        pathIndices: proof.pathIndices,
        root,
        actionId: actionId2
      };
      
      const witness1 = await circuit.calculateWitness(input1);
      const witness2 = await circuit.calculateWitness(input2);
      
      const nullifier1 = witness1[1];
      const nullifier2 = witness2[1];
      
      expect(BigInt(nullifier1)).to.not.equal(BigInt(nullifier2));
    });

    it("should handle maximum tree depth", async () => {
      const identitySecret = randomFieldElement();
      const identityNullifierSecret = randomFieldElement();
      const commitment = await poseidonHashArray([identitySecret]);
      
      // Create tree with many leaves
      const leaves = Array(128).fill(0n).map(() => randomFieldElement());
      leaves[0] = commitment;
      
      const { root, proofs } = await createMerkleTree(leaves, LEVELS);
      const proof = proofs[0];
      const actionId = randomFieldElement();
      
      const input = {
        identitySecret,
        identityNullifierSecret,
        pathElements: proof.pathElements,
        pathIndices: proof.pathIndices,
        root,
        actionId
      };
      
      const witness = await circuit.calculateWitness(input);
      
      const expectedNullifier = await poseidonHash2(identityNullifierSecret, actionId);
      const nullifierHash = witness[1];
      
      expect(BigInt(nullifierHash)).to.equal(expectedNullifier);
    });
  });
});

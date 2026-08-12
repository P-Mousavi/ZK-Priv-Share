const { expect } = require("chai");
const { buildPoseidon } = require("circomlibjs");
const { wasm } = require("circom_tester");
const path = require("path");
const { poseidonHash2, randomFieldElement } = require("../helpers/poseidon");
const { createMerkleTree } = require("../helpers/merkle");

describe("Identity Circuit", () => {
  let circuit: any;
  const LEVELS = 7;

  before(async () => {
    const circuitPath = path.join(__dirname, "../../circuits/identity.circom");
    circuit = await wasm(circuitPath);
  });

  describe("JoinIdentity", () => {
    it("should generate valid proof for identity in tree", async () => {
      // Generate random identity secrets
      const identitySecret = randomFieldElement();
      const identityNullifier = randomFieldElement();
      
      // Compute commitment
      const commitment = await poseidonHash2(identitySecret, identityNullifier);
      
      // Create a Merkle tree with the commitment
      const leaves = [commitment, randomFieldElement(), randomFieldElement(), randomFieldElement()];
      const { root, proofs } = await createMerkleTree(leaves, LEVELS);
      
      const proof = proofs[0];
      const actionId = randomFieldElement();
      
      // Expected nullifier hash
      const expectedNullifier = await poseidonHash2(identityNullifier, actionId);
      
      // Circuit input
      const input = {
        identitySecret,
        identityNullifier,
        pathElements: proof.pathElements,
        pathIndices: proof.pathIndices,
        root,
        actionId
      };
      
      // Calculate witness
      const witness = await circuit.calculateWitness(input);
      
      // Check output
      const nullifierHash = witness[witness.length - 1];
      expect(BigInt(nullifierHash)).to.equal(expectedNullifier);
    });

    it("should fail with invalid Merkle root", async () => {
      const identitySecret = randomFieldElement();
      const identityNullifier = randomFieldElement();
      const commitment = await poseidonHash2(identitySecret, identityNullifier);
      
      const leaves = [commitment, randomFieldElement(), randomFieldElement(), randomFieldElement()];
      const { proofs } = await createMerkleTree(leaves, LEVELS);
      
      const proof = proofs[0];
      const actionId = randomFieldElement();
      const invalidRoot = randomFieldElement(); // Wrong root
      
      const input = {
        identitySecret,
        identityNullifier,
        pathElements: proof.pathElements,
        pathIndices: proof.pathIndices,
        root: invalidRoot,
        actionId
      };
      
      // Should fail to satisfy constraints
      try {
        await circuit.calculateWitness(input);
        expect.fail("Should have thrown an error");
      } catch (error: any) {
        expect(error.message).to.include("Assert fail");
      }
    });

    it("should fail with incorrect path elements", async () => {
      const identitySecret = randomFieldElement();
      const identityNullifier = randomFieldElement();
      const commitment = await poseidonHash2(identitySecret, identityNullifier);
      
      const leaves = [commitment, randomFieldElement(), randomFieldElement(), randomFieldElement()];
      const { root, proofs } = await createMerkleTree(leaves, LEVELS);
      
      const proof = proofs[0];
      const actionId = randomFieldElement();
      
      // Corrupt the path elements
      const invalidPathElements = [...proof.pathElements];
      invalidPathElements[0] = randomFieldElement();
      
      const input = {
        identitySecret,
        identityNullifier,
        pathElements: invalidPathElements,
        pathIndices: proof.pathIndices,
        root,
        actionId
      };
      
      try {
        await circuit.calculateWitness(input);
        expect.fail("Should have thrown an error");
      } catch (error: any) {
        expect(error.message).to.include("Assert fail");
      }
    });

    it("should generate unique nullifier for different action IDs", async () => {
      const identitySecret = randomFieldElement();
      const identityNullifier = randomFieldElement();
      const commitment = await poseidonHash2(identitySecret, identityNullifier);
      
      const leaves = [commitment, randomFieldElement(), randomFieldElement(), randomFieldElement()];
      const { root, proofs } = await createMerkleTree(leaves, LEVELS);
      
      const proof = proofs[0];
      const actionId1 = randomFieldElement();
      const actionId2 = randomFieldElement();
      
      const input1 = {
        identitySecret,
        identityNullifier,
        pathElements: proof.pathElements,
        pathIndices: proof.pathIndices,
        root,
        actionId: actionId1
      };
      
      const input2 = {
        identitySecret,
        identityNullifier,
        pathElements: proof.pathElements,
        pathIndices: proof.pathIndices,
        root,
        actionId: actionId2
      };
      
      const witness1 = await circuit.calculateWitness(input1);
      const witness2 = await circuit.calculateWitness(input2);
      
      const nullifier1 = witness1[witness1.length - 1];
      const nullifier2 = witness2[witness2.length - 1];
      
      expect(BigInt(nullifier1)).to.not.equal(BigInt(nullifier2));
    });

    it("should handle maximum tree depth", async () => {
      const identitySecret = randomFieldElement();
      const identityNullifier = randomFieldElement();
      const commitment = await poseidonHash2(identitySecret, identityNullifier);
      
      // Create tree with many leaves
      const leaves = Array(128).fill(0n).map(() => randomFieldElement());
      leaves[0] = commitment;
      
      const { root, proofs } = await createMerkleTree(leaves, LEVELS);
      const proof = proofs[0];
      const actionId = randomFieldElement();
      
      const input = {
        identitySecret,
        identityNullifier,
        pathElements: proof.pathElements,
        pathIndices: proof.pathIndices,
        root,
        actionId
      };
      
      const witness = await circuit.calculateWitness(input);
      
      const expectedNullifier = await poseidonHash2(identityNullifier, actionId);
      const nullifierHash = witness[witness.length - 1];
      
      expect(BigInt(nullifierHash)).to.equal(expectedNullifier);
    });
  });
});

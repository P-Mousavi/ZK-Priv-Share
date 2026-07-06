const { expect } = require("chai");
const { wasm } = require("circom_tester");
const path = require("path");
const { poseidonHash2, randomFieldElement } = require("../helpers/poseidon");
const { createMerkleTree } = require("../helpers/merkle");

describe("Merkle Tree Circuit", () => {
  let circuit: any;
  const LEVELS = 5;

  before(async () => {
    const circuitPath = path.join(__dirname, "../../circuits/lib/merkleTree.circom");
    circuit = await wasm(circuitPath);
  });

  describe("MerkleTreeInclusionProof", () => {
    it("should verify valid Merkle proof", async () => {
      const leaf = randomFieldElement();
      const leaves = [leaf, randomFieldElement(), randomFieldElement(), randomFieldElement()];
      const { root, proofs } = await createMerkleTree(leaves, LEVELS);
      
      const proof = proofs[0];
      
      const input = {
        leaf,
        pathElements: proof.pathElements,
        pathIndices: proof.pathIndices
      };
      
      const witness = await circuit.calculateWitness(input);
      const computedRoot = BigInt(witness[witness.length - 1]);
      
      expect(computedRoot).to.equal(root);
    });

    it("should fail with invalid path elements", async () => {
      const leaf = randomFieldElement();
      const leaves = [leaf, randomFieldElement(), randomFieldElement(), randomFieldElement()];
      const { root, proofs } = await createMerkleTree(leaves, LEVELS);
      
      const proof = proofs[0];
      
      // Corrupt the path elements
      const invalidPathElements = [...proof.pathElements];
      invalidPathElements[0] = randomFieldElement();
      
      const input = {
        leaf,
        pathElements: invalidPathElements,
        pathIndices: proof.pathIndices
      };
      
      try {
        await circuit.calculateWitness(input);
        expect.fail("Should have thrown an error");
      } catch (error: any) {
        expect(error.message).to.include("Assert fail");
      }
    });

    it("should fail with invalid path indices", async () => {
      const leaf = randomFieldElement();
      const leaves = [leaf, randomFieldElement(), randomFieldElement(), randomFieldElement()];
      const { root, proofs } = await createMerkleTree(leaves, LEVELS);
      
      const proof = proofs[0];
      
      // Corrupt the path indices
      const invalidPathIndices = [...proof.pathIndices];
      invalidPathIndices[0] = invalidPathIndices[0] === 0 ? 1 : 0;
      
      const input = {
        leaf,
        pathElements: proof.pathElements,
        pathIndices: invalidPathIndices
      };
      
      try {
        await circuit.calculateWitness(input);
        expect.fail("Should have thrown an error");
      } catch (error: any) {
        expect(error.message).to.include("Assert fail");
      }
    });

    it("should verify proof for different leaf positions", async () => {
      const leaves = Array(8).fill(0n).map(() => randomFieldElement());
      const { root, proofs } = await createMerkleTree(leaves, LEVELS);
      
      for (let i = 0; i < leaves.length; i++) {
        const input = {
          leaf: leaves[i],
          pathElements: proofs[i].pathElements,
          pathIndices: proofs[i].pathIndices
        };
        
        const witness = await circuit.calculateWitness(input);
        const computedRoot = BigInt(witness[witness.length - 1]);
        
        expect(computedRoot).to.equal(root);
      }
    });

    it("should handle single leaf tree", async () => {
      const leaf = randomFieldElement();
      const leaves = [leaf];
      const { root, proofs } = await createMerkleTree(leaves, LEVELS);
      
      const proof = proofs[0];
      
      const input = {
        leaf,
        pathElements: proof.pathElements,
        pathIndices: proof.pathIndices
      };
      
      const witness = await circuit.calculateWitness(input);
      const computedRoot = BigInt(witness[witness.length - 1]);
      
      expect(computedRoot).to.equal(root);
    });

    it("should handle maximum tree depth", async () => {
      const leaf = randomFieldElement();
      const leaves = Array(32).fill(0n).map(() => randomFieldElement());
      leaves[0] = leaf;
      
      const { root, proofs } = await createMerkleTree(leaves, LEVELS);
      const proof = proofs[0];
      
      const input = {
        leaf,
        pathElements: proof.pathElements,
        pathIndices: proof.pathIndices
      };
      
      const witness = await circuit.calculateWitness(input);
      const computedRoot = BigInt(witness[witness.length - 1]);
      
      expect(computedRoot).to.equal(root);
    });

    it("should compute same root as helper function", async () => {
      const leaf = randomFieldElement();
      const leaves = [leaf, randomFieldElement(), randomFieldElement(), randomFieldElement()];
      const { root, proofs } = await createMerkleTree(leaves, LEVELS);
      
      const proof = proofs[0];
      
      const input = {
        leaf,
        pathElements: proof.pathElements,
        pathIndices: proof.pathIndices
      };
      
      const witness = await circuit.calculateWitness(input);
      const circuitRoot = BigInt(witness[witness.length - 1]);
      
      expect(circuitRoot).to.equal(root);
    });

    it("should handle zero leaf", async () => {
      const leaf = 0n;
      const leaves = [leaf, randomFieldElement(), randomFieldElement(), randomFieldElement()];
      const { root, proofs } = await createMerkleTree(leaves, LEVELS);
      
      const proof = proofs[0];
      
      const input = {
        leaf,
        pathElements: proof.pathElements,
        pathIndices: proof.pathIndices
      };
      
      const witness = await circuit.calculateWitness(input);
      const computedRoot = BigInt(witness[witness.length - 1]);
      
      expect(computedRoot).to.equal(root);
    });

    it("should handle maximum field element", async () => {
      const maxField = BigInt("21888242871839275222246405745257275088548364400416034343698204186575808495616");
      const leaf = maxField;
      const leaves = [leaf, randomFieldElement(), randomFieldElement(), randomFieldElement()];
      const { root, proofs } = await createMerkleTree(leaves, LEVELS);
      
      const proof = proofs[0];
      
      const input = {
        leaf,
        pathElements: proof.pathElements,
        pathIndices: proof.pathIndices
      };
      
      const witness = await circuit.calculateWitness(input);
      const computedRoot = BigInt(witness[witness.length - 1]);
      
      expect(computedRoot).to.equal(root);
    });
  });
});

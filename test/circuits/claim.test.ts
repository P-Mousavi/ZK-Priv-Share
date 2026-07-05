import { expect } from "chai";
import { buildPoseidon } from "circomlibjs";
import { wasm } from "circom_tester";
import path from "path";
import { poseidonHash, randomFieldElement } from "../helpers/poseidon";
import { createMerkleTree } from "../helpers/merkle";

describe("Claim Circuit", () => {
  let circuit: any;
  const LEVELS = 5;

  before(async () => {
    const circuitPath = path.join(__dirname, "../../circuits/claim.circom");
    circuit = await wasm(circuitPath);
  });

  describe("ClaimReward", () => {
    it("should generate valid proof for reward claim", async () => {
      // Generate random payout secret
      const payoutSecret = randomFieldElement();
      
      // Compute commitment
      const commitment = await poseidonHash(payoutSecret);
      
      // Create a Merkle tree with the commitment
      const leaves = [commitment, randomFieldElement(), randomFieldElement(), randomFieldElement()];
      const { root, proofs } = await createMerkleTree(leaves, LEVELS);
      
      const proof = proofs[0];
      
      // Compute nullifier hash
      const nullifierHash = await poseidonHash(payoutSecret);
      
      // Public inputs
      const recipient = BigInt("0x" + "1234".repeat(10)); // Random address
      const relayerFee = BigInt("100000000000000000"); // 0.1 ether
      
      // Circuit input
      const input = {
        payoutSecret,
        pathElements: proof.pathElements,
        pathIndices: proof.pathIndices,
        root,
        nullifierHash,
        recipient,
        relayerFee
      };
      
      // Calculate witness
      const witness = await circuit.calculateWitness(input);
      
      // Check that the witness was computed successfully
      expect(witness).to.not.be.undefined;
    });

    it("should fail with invalid Merkle root", async () => {
      const payoutSecret = randomFieldElement();
      const commitment = await poseidonHash(payoutSecret);
      
      const leaves = [commitment, randomFieldElement(), randomFieldElement(), randomFieldElement()];
      const { proofs } = await createMerkleTree(leaves, LEVELS);
      
      const proof = proofs[0];
      const nullifierHash = await poseidonHash(payoutSecret);
      const invalidRoot = randomFieldElement();
      const recipient = BigInt("0x" + "1234".repeat(10));
      const relayerFee = BigInt("100000000000000000");
      
      const input = {
        payoutSecret,
        pathElements: proof.pathElements,
        pathIndices: proof.pathIndices,
        root: invalidRoot,
        nullifierHash,
        recipient,
        relayerFee
      };
      
      try {
        await circuit.calculateWitness(input);
        expect.fail("Should have thrown an error");
      } catch (error: any) {
        expect(error.message).to.include("Assert fail");
      }
    });

    it("should fail with incorrect nullifier hash", async () => {
      const payoutSecret = randomFieldElement();
      const commitment = await poseidonHash(payoutSecret);
      
      const leaves = [commitment, randomFieldElement(), randomFieldElement(), randomFieldElement()];
      const { root, proofs } = await createMerkleTree(leaves, LEVELS);
      
      const proof = proofs[0];
      const invalidNullifierHash = randomFieldElement();
      const recipient = BigInt("0x" + "1234".repeat(10));
      const relayerFee = BigInt("100000000000000000");
      
      const input = {
        payoutSecret,
        pathElements: proof.pathElements,
        pathIndices: proof.pathIndices,
        root,
        nullifierHash: invalidNullifierHash,
        recipient,
        relayerFee
      };
      
      try {
        await circuit.calculateWitness(input);
        expect.fail("Should have thrown an error");
      } catch (error: any) {
        expect(error.message).to.include("Assert fail");
      }
    });

    it("should fail with incorrect path elements", async () => {
      const payoutSecret = randomFieldElement();
      const commitment = await poseidonHash(payoutSecret);
      
      const leaves = [commitment, randomFieldElement(), randomFieldElement(), randomFieldElement()];
      const { root, proofs } = await createMerkleTree(leaves, LEVELS);
      
      const proof = proofs[0];
      const nullifierHash = await poseidonHash(payoutSecret);
      
      // Corrupt the path elements
      const invalidPathElements = [...proof.pathElements];
      invalidPathElements[0] = randomFieldElement();
      
      const recipient = BigInt("0x" + "1234".repeat(10));
      const relayerFee = BigInt("100000000000000000");
      
      const input = {
        payoutSecret,
        pathElements: invalidPathElements,
        pathIndices: proof.pathIndices,
        root,
        nullifierHash,
        recipient,
        relayerFee
      };
      
      try {
        await circuit.calculateWitness(input);
        expect.fail("Should have thrown an error");
      } catch (error: any) {
        expect(error.message).to.include("Assert fail");
      }
    });

    it("should handle different recipient addresses", async () => {
      const payoutSecret = randomFieldElement();
      const commitment = await poseidonHash(payoutSecret);
      
      const leaves = [commitment, randomFieldElement(), randomFieldElement(), randomFieldElement()];
      const { root, proofs } = await createMerkleTree(leaves, LEVELS);
      
      const proof = proofs[0];
      const nullifierHash = await poseidonHash(payoutSecret);
      
      const recipient1 = BigInt("0x" + "1111".repeat(10));
      const recipient2 = BigInt("0x" + "2222".repeat(10));
      const relayerFee = BigInt("100000000000000000");
      
      const input1 = {
        payoutSecret,
        pathElements: proof.pathElements,
        pathIndices: proof.pathIndices,
        root,
        nullifierHash,
        recipient: recipient1,
        relayerFee
      };
      
      const input2 = {
        payoutSecret,
        pathElements: proof.pathElements,
        pathIndices: proof.pathIndices,
        root,
        nullifierHash,
        recipient: recipient2,
        relayerFee
      };
      
      const witness1 = await circuit.calculateWitness(input1);
      const witness2 = await circuit.calculateWitness(input2);
      
      expect(witness1).to.not.be.undefined;
      expect(witness2).to.not.be.undefined;
    });

    it("should handle different relayer fees", async () => {
      const payoutSecret = randomFieldElement();
      const commitment = await poseidonHash(payoutSecret);
      
      const leaves = [commitment, randomFieldElement(), randomFieldElement(), randomFieldElement()];
      const { root, proofs } = await createMerkleTree(leaves, LEVELS);
      
      const proof = proofs[0];
      const nullifierHash = await poseidonHash(payoutSecret);
      const recipient = BigInt("0x" + "1234".repeat(10));
      
      const relayerFee1 = BigInt("0");
      const relayerFee2 = BigInt("100000000000000000");
      
      const input1 = {
        payoutSecret,
        pathElements: proof.pathElements,
        pathIndices: proof.pathIndices,
        root,
        nullifierHash,
        recipient,
        relayerFee: relayerFee1
      };
      
      const input2 = {
        payoutSecret,
        pathElements: proof.pathElements,
        pathIndices: proof.pathIndices,
        root,
        nullifierHash,
        recipient,
        relayerFee: relayerFee2
      };
      
      const witness1 = await circuit.calculateWitness(input1);
      const witness2 = await circuit.calculateWitness(input2);
      
      expect(witness1).to.not.be.undefined;
      expect(witness2).to.not.be.undefined;
    });

    it("should handle maximum tree depth", async () => {
      const payoutSecret = randomFieldElement();
      const commitment = await poseidonHash(payoutSecret);
      
      // Create tree with many leaves
      const leaves = Array(32).fill(0n).map(() => randomFieldElement());
      leaves[0] = commitment;
      
      const { root, proofs } = await createMerkleTree(leaves, LEVELS);
      const proof = proofs[0];
      const nullifierHash = await poseidonHash(payoutSecret);
      const recipient = BigInt("0x" + "1234".repeat(10));
      const relayerFee = BigInt("100000000000000000");
      
      const input = {
        payoutSecret,
        pathElements: proof.pathElements,
        pathIndices: proof.pathIndices,
        root,
        nullifierHash,
        recipient,
        relayerFee
      };
      
      const witness = await circuit.calculateWitness(input);
      expect(witness).to.not.be.undefined;
    });
  });
});

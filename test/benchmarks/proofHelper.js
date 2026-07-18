const { groth16 } = require("snarkjs");
const fs = require("fs");
const path = require("path");
const { buildPoseidon } = require("circomlibjs");
const { ethers } = require("hardhat");

/**
 * Proof generation helper for benchmarking
 * Generates valid Groth16 proofs for ZK operations
 */

class ProofHelper {
  constructor() {
    this.buildDir = path.join(__dirname, "../../circuits/build");
    this.poseidon = null;
  }

  async init() {
    this.poseidon = await buildPoseidon();
  }

  /**
   * Generate a random field element
   */
  randomFieldElement() {
    return BigInt("0x" + Array.from({ length: 31 }, () => Math.floor(Math.random() * 16).toString(16)).join(""));
  }

  /**
   * Hash using Poseidon
   */
  poseidonHash(input) {
    if (Array.isArray(input)) {
      const hash = this.poseidon(input.map(BigInt));
      return BigInt(this.poseidon.F.toString(hash));
    }
    const hash = this.poseidon([BigInt(input)]);
    return BigInt(this.poseidon.F.toString(hash));
  }

  /**
   * Create a Merkle tree and return root + merkleProofs
   */
  async createMerkleTree(leaves, levels = 5) {
    // Build the tree level by level
    let currentLevel = [...leaves];
    const treeLevels = [currentLevel];
    
    for (let level = 0; level < levels; level++) {
      const nextLevel = [];
      for (let i = 0; i < currentLevel.length; i += 2) {
        const left = currentLevel[i];
        const right = (i + 1 < currentLevel.length) ? currentLevel[i + 1] : currentLevel[i];
        const hash = await this.poseidonHash([left, right]);
        nextLevel.push(hash);
      }
      treeLevels.push(nextLevel);
      currentLevel = nextLevel;
    }
    
    const root = currentLevel[0];
    
    // Generate proofs for each leaf
    const merkleProofs = [];
    for (let i = 0; i < leaves.length; i++) {
      const pathElements = [];
      const pathIndices = [];
      let index = i;
      
      for (let level = 0; level < levels; level++) {
        const siblingIndex = index ^ 1;
        const levelLeaves = treeLevels[level];
        
        if (siblingIndex < levelLeaves.length) {
          pathElements.push(levelLeaves[siblingIndex]);
        } else {
          pathElements.push(0n);
        }
        pathIndices.push(index % 2);
        index = Math.floor(index / 2);
      }
      
      merkleProofs.push({ pathElements, pathIndices });
    }
    
    return { root, merkleProofs };
  }

  /**
   * Generate a reward claim proof
   */
  async generateRewardProof(secret, recipient, relayerFee = 0n, denomination = ethers.parseEther("1"), nullifier = this.randomFieldElement()) {
    const commitment = await this.poseidonHash([denomination, secret, nullifier]);
    
    // Create Merkle tree with the commitment
    const leaves = [commitment, this.randomFieldElement(), this.randomFieldElement(), this.randomFieldElement()];
    const { root, merkleProofs } = this.createMerkleTree(leaves, 5);
    const merkleProof = merkleProofs[0];
    
    // Compute nullifier hash
    const nullifierHash = await this.poseidonHash(nullifier);
    
    // Circuit input
    const input = {
      secret: secret.toString(),
      nullifier: nullifier.toString(),
      pathElements: merkleProof.pathElements.map(e => e.toString()),
      pathIndices: merkleProof.pathIndices,
      root: root.toString(),
      denomination: denomination.toString(),
      nullifierHash: nullifierHash.toString()
    };
    
    // Generate Groth16 proof
    const wasmPath = path.join(this.buildDir, "reward_js", "reward.wasm");
    const zkeyPath = path.join(this.buildDir, "reward_final.zkey");
    
    const { proof: snarkProof, publicSignals } = await groth16.fullProve(input, wasmPath, zkeyPath);
    
    // Convert proof values to BigInt immediately to avoid locale string issues
    const toBigInt = (val) => {
      if (typeof val === 'bigint') return val;
      if (typeof val === 'number') return BigInt(val);
      if (typeof val === 'string') {
        // Remove any commas and spaces before conversion
        const clean = val.replace(/[, ]/g, '').replace(/^0x/i, '');
        return BigInt('0x' + clean);
      }
      return BigInt(val);
    };
    
    const convertProof = (val) => {
      if (Array.isArray(val)) {
        return val.map(convertProof);
      }
      return toBigInt(val);
    };
    
    return {
      proof: {
        pi_a: convertProof(snarkProof.pi_a),
        pi_b: convertProof(snarkProof.pi_b),
        pi_c: convertProof(snarkProof.pi_c)
      },
      publicSignals: convertProof(publicSignals),
      input: {
        root: root,  // Already a BigInt from poseidonHash
        denomination: denomination,
        nullifierHash: nullifierHash,  // Already a BigInt from poseidonHash
        recipient: recipient,
        relayerFee: relayerFee  // Already a BigInt
      },
      noteCommitment: commitment
    };
  }

  /**
   * Generate an identity proof
   */
  async generateIdentityProof(identitySecret, recipient) {
    const commitment = this.poseidonHash(identitySecret);
    
    // Create Merkle tree with the commitment
    const leaves = [commitment, this.randomFieldElement(), this.randomFieldElement(), this.randomFieldElement()];
    const { root, merkleProofs } = this.createMerkleTree(leaves, 5);
    const merkleProof = merkleProofs[0];
    
    // Circuit input for identity circuit
    const input = {
      identitySecret: identitySecret.toString(),
      pathElements: merkleProof.pathElements.map(e => e.toString()),
      pathIndices: merkleProof.pathIndices,
      root: root.toString(),
      recipient: recipient.toString()
    };
    
    // Generate Groth16 proof (using identity circuit)
    const wasmPath = path.join(this.buildDir, "identity_js", "identity.wasm");
    const zkeyPath = path.join(this.buildDir, "identity_final.zkey");
    
    // Check if identity circuit files exist
    if (!fs.existsSync(wasmPath) || !fs.existsSync(zkeyPath)) {
      throw new Error("Identity circuit not built. Run: npx circomkit compile identity");
    }
    
    const { proof: snarkProof, publicSignals } = await groth16.fullProve(input, wasmPath, zkeyPath);
    
    return {
      proof: {
        pi_a: snarkProof.pi_a,
        pi_b: snarkProof.pi_b,
        pi_c: snarkProof.pi_c
      },
      publicSignals,
      input: {
        root: root.toString(),
        recipient: recipient.toString()
      }
    };
  }

  /**
   * Convert proof to Solidity format
   */
  proofToSolidity(proofData) {
    // Ensure all values are BigInt and convert to hex string for ethers
    const toBigInt = (val) => {
      if (typeof val === 'bigint') return val;
      if (typeof val === 'number') return BigInt(val);
      if (typeof val === 'string') {
        // Remove any commas and spaces before conversion
        const clean = val.replace(/[, ]/g, '').replace(/^0x/i, '');
        return BigInt('0x' + clean);
      }
      return BigInt(val);
    };

    const convertProof = (val) => {
      if (Array.isArray(val)) {
        return val.map(convertProof);
      }
      return toBigInt(val);
    };

    return {
      pA: convertProof(proofData.proof.pi_a),
      pB: convertProof(proofData.proof.pi_b),
      pC: convertProof(proofData.proof.pi_c),
      pubSignals: convertProof(proofData.publicSignals)
    };
  }

  /**
   * Format BigInt to hex string without commas
   */
  toHex(bigint) {
    return "0x" + bigint.toString(16);
  }
}

module.exports = ProofHelper;

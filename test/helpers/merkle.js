const { buildPoseidon } = require("circomlibjs");

/**
 * Merkle Tree utilities for testing
 */
class MerkleTree {
  constructor(levels = 5) {
    this.levels = levels;
    this.leaves = [];
  }

  async init() {
    this.poseidon = await buildPoseidon();
  }

  /**
   * Add a leaf to the tree
   */
  addLeaf(leaf) {
    this.leaves.push(BigInt(leaf));
  }

  /**
   * Compute Poseidon hash of two values
   */
  hash(left, right) {
    const hash = this.poseidon([BigInt(left), BigInt(right)]);
    return BigInt(this.poseidon.F.toString(hash));
  }

  /**
   * Build the Merkle tree and return the root
   */
  getRoot() {
    if (this.leaves.length === 0) {
      return 0n;
    }

    let currentLevel = [...this.leaves];
    
    for (let level = 0; level < this.levels; level++) {
      const nextLevel = [];
      
      for (let i = 0; i < currentLevel.length; i += 2) {
        const left = currentLevel[i];
        const right = i + 1 < currentLevel.length ? currentLevel[i + 1] : currentLevel[i];
        nextLevel.push(this.hash(left, right));
      }
      
      currentLevel = nextLevel;
    }
    
    return currentLevel[0];
  }

  /**
   * Get Merkle proof for a leaf at a specific index
   */
  getProof(leafIndex) {
    const pathElements = [];
    const pathIndices = [];
    
    let currentLevel = [...this.leaves];
    let currentIndex = leafIndex;
    
    for (let level = 0; level < this.levels; level++) {
      const siblingIndex = currentIndex % 2 === 0 ? currentIndex + 1 : currentIndex - 1;
      const sibling = siblingIndex < currentLevel.length ? currentLevel[siblingIndex] : currentLevel[currentIndex];
      
      pathElements.push(sibling);
      pathIndices.push(currentIndex % 2 === 0 ? 0 : 1);
      
      currentIndex = Math.floor(currentIndex / 2);
      
      // Build next level
      const nextLevel = [];
      for (let i = 0; i < currentLevel.length; i += 2) {
        const left = currentLevel[i];
        const right = i + 1 < currentLevel.length ? currentLevel[i + 1] : currentLevel[i];
        nextLevel.push(this.hash(left, right));
      }
      currentLevel = nextLevel;
    }
    
    return { pathElements, pathIndices };
  }

  /**
   * Verify a Merkle proof
   */
  verifyProof(leaf, proof, root) {
    let current = BigInt(leaf);
    
    for (let i = 0; i < proof.pathElements.length; i++) {
      const sibling = BigInt(proof.pathElements[i]);
      const index = proof.pathIndices[i];
      
      if (index === 0) {
        current = this.hash(current, sibling);
      } else {
        current = this.hash(sibling, current);
      }
    }
    
    return current === BigInt(root);
  }
}

/**
 * Create a simple Merkle tree with given leaves
 */
async function createMerkleTree(leaves, levels = 5) {
  const tree = new MerkleTree(levels);
  await tree.init();
  
  for (const leaf of leaves) {
    tree.addLeaf(leaf);
  }
  
  const root = tree.getRoot();
  const proofs = leaves.map((_, index) => tree.getProof(index));
  
  return { tree, root, proofs };
}

module.exports = {
  MerkleTree,
  createMerkleTree
};

import { buildPoseidon } from "circomlibjs";

/**
 * Merkle Tree utilities for testing
 */
export class MerkleTree {
  private levels: number;
  private leaves: bigint[];
  private poseidon: any;

  constructor(levels: number = 5) {
    this.levels = levels;
    this.leaves = [];
  }

  async init() {
    this.poseidon = await buildPoseidon();
  }

  /**
   * Add a leaf to the tree
   */
  addLeaf(leaf: bigint) {
    this.leaves.push(leaf);
  }

  /**
   * Compute Poseidon hash of two values
   */
  private hash(left: bigint, right: bigint): bigint {
    const hash = this.poseidon([left, right]);
    return this.poseidon.F.toString(hash) as unknown as bigint;
  }

  /**
   * Build the Merkle tree and return the root
   */
  getRoot(): bigint {
    if (this.leaves.length === 0) {
      return 0n;
    }

    let currentLevel = [...this.leaves];
    
    for (let level = 0; level < this.levels; level++) {
      const nextLevel: bigint[] = [];
      
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
  getProof(leafIndex: number): { pathElements: bigint[]; pathIndices: number[] } {
    const pathElements: bigint[] = [];
    const pathIndices: number[] = [];
    
    let currentLevel = [...this.leaves];
    let currentIndex = leafIndex;
    
    for (let level = 0; level < this.levels; level++) {
      const siblingIndex = currentIndex % 2 === 0 ? currentIndex + 1 : currentIndex - 1;
      const sibling = siblingIndex < currentLevel.length ? currentLevel[siblingIndex] : currentLevel[currentIndex];
      
      pathElements.push(sibling);
      pathIndices.push(currentIndex % 2 === 0 ? 0 : 1);
      
      currentIndex = Math.floor(currentIndex / 2);
      
      // Build next level
      const nextLevel: bigint[] = [];
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
  verifyProof(leaf: bigint, proof: { pathElements: bigint[]; pathIndices: number[] }, root: bigint): boolean {
    let current = leaf;
    
    for (let i = 0; i < proof.pathElements.length; i++) {
      const sibling = proof.pathElements[i];
      const index = proof.pathIndices[i];
      
      if (index === 0) {
        current = this.hash(current, sibling);
      } else {
        current = this.hash(sibling, current);
      }
    }
    
    return current === root;
  }
}

/**
 * Create a simple Merkle tree with given leaves
 */
export async function createMerkleTree(leaves: bigint[], levels: number = 5): Promise<{
  tree: MerkleTree;
  root: bigint;
  proofs: Array<{ pathElements: bigint[]; pathIndices: number[] }>;
}> {
  const tree = new MerkleTree(levels);
  await tree.init();
  
  for (const leaf of leaves) {
    tree.addLeaf(leaf);
  }
  
  const root = tree.getRoot();
  const proofs = leaves.map((_, index) => tree.getProof(index));
  
  return { tree, root, proofs };
}

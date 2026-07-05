const { buildPoseidon } = require("circomlibjs");
const fs = require("fs");
const path = require("path");

/**
 * Simple Merkle Tree implementation using Poseidon hash
 * Compatible with circomlib's MerkleTreeInclusionProof
 */
class PoseidonMerkleTree {
    constructor(depth, poseidon) {
        this.depth = depth;
        this.poseidon = poseidon;
        this.leaves = [];
        this.zeroValue = BigInt(0);
        this.maxLeaves = 2 ** depth;
    }

    /**
     * Insert a leaf into the tree
     */
    insert(leaf) {
        if (this.leaves.length >= this.maxLeaves) {
            throw new Error("Tree is full");
        }
        this.leaves.push(leaf);
    }

    /**
     * Hash two values using Poseidon
     */
    hash(left, right) {
        const result = this.poseidon([left, right]);
        return BigInt(this.poseidon.F.toString(result));
    }

    /**
     * Get the root of the tree
     */
    getRoot() {
        if (this.leaves.length === 0) {
            let zeroRoot = this.zeroValue;
            for (let i = 0; i < this.depth; i++) {
                zeroRoot = this.hash(zeroRoot, zeroRoot);
            }
            return zeroRoot;
        }
        
        let currentLevel = [...this.leaves];
        const maxLeavesAtLevel = 2 ** this.depth;
        
        while (currentLevel.length < maxLeavesAtLevel) {
            currentLevel.push(this.zeroValue);
        }
        
        for (let level = 0; level < this.depth; level++) {
            const nextLevel = [];
            for (let i = 0; i < currentLevel.length; i += 2) {
                const left = currentLevel[i];
                const right = currentLevel[i + 1];
                nextLevel.push(this.hash(left, right));
            }
            currentLevel = nextLevel;
        }
        
        return currentLevel[0];
    }

    /**
     * Generate Merkle proof for a leaf at the given index
     */
    genMerklePath(leafIndex) {
        const pathElements = [];
        const pathIndices = [];
        
        let currentLevel = [...this.leaves];
        const maxLeavesAtLevel = 2 ** this.depth;
        
        while (currentLevel.length < maxLeavesAtLevel) {
            currentLevel.push(this.zeroValue);
        }
        
        let currentIndex = leafIndex;
        
        for (let level = 0; level < this.depth; level++) {
            const siblingIndex = currentIndex % 2 === 0 ? currentIndex + 1 : currentIndex - 1;
            pathElements.push(currentLevel[siblingIndex].toString());
            pathIndices.push((currentIndex % 2).toString());
            
            const nextLevel = [];
            for (let i = 0; i < currentLevel.length; i += 2) {
                const left = currentLevel[i];
                const right = currentLevel[i + 1];
                nextLevel.push(this.hash(left, right));
            }
            currentLevel = nextLevel;
            currentIndex = Math.floor(currentIndex / 2);
        }
        
        return { pathElements, pathIndices };
    }
}

async function generateClaimInput() {
    const TREE_DEPTH = 5;
    
    const poseidon = await buildPoseidon();
    
    const payoutSecret = BigInt("1234567890123456789012345678901234567890123456789012345678901234");
    
    console.log("Generating Claim Circuit Input...");
    console.log(`Tree Depth: ${TREE_DEPTH}`);
    console.log(`Payout Secret: ${payoutSecret.toString()}`);
    
    // Step 1: Compute commitment (Poseidon(payoutSecret))
    const commitmentResult = poseidon([payoutSecret]);
    const commitment = BigInt(poseidon.F.toString(commitmentResult));
    console.log(`\nCommitment (Poseidon(payoutSecret)): ${commitment.toString()}`);
    
    // Step 2: Create Merkle Tree
    const tree = new PoseidonMerkleTree(TREE_DEPTH, poseidon);
    
    // Step 3: Insert the commitment as a leaf at index 0
    const leafIndex = 0;
    tree.insert(commitment);
    
    // Add dummy leaves
    for (let i = 1; i < 5; i++) {
        const dummySecret = BigInt(i * 1000);
        const dummyCommitmentResult = poseidon([dummySecret]);
        const dummyCommitment = BigInt(poseidon.F.toString(dummyCommitmentResult));
        tree.insert(dummyCommitment);
    }
    
    // Step 4: Generate Merkle proof
    const proof = tree.genMerklePath(leafIndex);
    const pathElements = proof.pathElements;
    const pathIndices = proof.pathIndices;
    const root = tree.getRoot().toString();
    
    console.log(`\nMerkle Root: ${root}`);
    console.log(`Leaf Index: ${leafIndex}`);
    console.log(`Path Elements: [${pathElements.join(", ")}]`);
    console.log(`Path Indices: [${pathIndices.join(", ")}]`);
    
    // Step 5: Compute nullifier hash (Poseidon(payoutSecret))
    const nullifierHashResult = poseidon([payoutSecret]);
    const nullifierHash = BigInt(poseidon.F.toString(nullifierHashResult));
    
    console.log(`\nNullifier Hash: ${nullifierHash.toString()}`);
    
    // Step 6: Set recipient and relayer fee
    const recipient = BigInt("1234567890123456789012345678901234567890123456789012345678901234");
    const relayerFee = BigInt("1000000000000000000"); // 1 ETH
    
    // Step 7: Create input.json for the claim circuit
    const input = {
        payoutSecret: payoutSecret.toString(),
        pathElements: pathElements,
        pathIndices: pathIndices,
        root: root,
        nullifierHash: nullifierHash.toString(),
        recipient: recipient.toString(),
        relayerFee: relayerFee.toString()
    };
    
    const inputPath = path.join(__dirname, "..", "circuits", "claim_input.json");
    fs.writeFileSync(inputPath, JSON.stringify(input, null, 2));
    
    console.log(`\n✅ Successfully generated claim_input.json at: ${inputPath}`);
    console.log("\nInput structure:");
    console.log(JSON.stringify(input, null, 2));
    
    return {
        root,
        nullifierHash: nullifierHash.toString(),
        commitment: commitment.toString(),
        leafIndex
    };
}

generateClaimInput()
    .then((result) => {
        console.log("\n✅ Claim input generation completed successfully!");
        console.log(`  Root: ${result.root}`);
        console.log(`  Nullifier Hash: ${result.nullifierHash}`);
        console.log(`  Commitment: ${result.commitment}`);
        console.log(`  Leaf Index: ${result.leafIndex}`);
    })
    .catch((error) => {
        console.error("❌ Error generating claim input:", error);
        process.exit(1);
    });

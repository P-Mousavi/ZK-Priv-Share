pragma circom 2.0.0;

include "../../node_modules/circomlib/circuits/poseidon.circom";

// Custom Merkle Tree Inclusion Proof template using Poseidon hash
// Adapted to work with IncrementalBinaryTree's zero-value approach
// pathIndices[i] = 0 means current node is on the left, 1 means on the right
template MerkleTreeInclusionProof(levels) {
    signal input leaf;
    signal input pathElements[levels];
    signal input pathIndices[levels];
    
    signal output root;
    
    component hashers[levels];
    
    // Start with the leaf
    signal level[levels + 1];
    signal left[levels];
    signal right[levels];
    signal oneMinusIndex[levels];
    signal leftTerm1[levels];
    signal leftTerm2[levels];
    signal rightTerm1[levels];
    signal rightTerm2[levels];
    
    level[0] <== leaf;
    
    // For each level, hash the current node with its sibling
    // If pathIndices[i] == 0: hash(level[i], pathElements[i])
    // If pathIndices[i] == 1: hash(pathElements[i], level[i])
    // pathElements can be zero values (Z_0, Z_1, etc.) for empty positions in IncrementalBinaryTree
    for (var i = 0; i < levels; i++) {
        // Compute 1 - pathIndices[i]
        oneMinusIndex[i] <== 1 - pathIndices[i];
        
        // Break down left computation: (1 - pathIndices[i]) * level[i] + pathIndices[i] * pathElements[i]
        leftTerm1[i] <== oneMinusIndex[i] * level[i];
        leftTerm2[i] <== pathIndices[i] * pathElements[i];
        left[i] <== leftTerm1[i] + leftTerm2[i];
        
        // Break down right computation: pathIndices[i] * level[i] + (1 - pathIndices[i]) * pathElements[i]
        rightTerm1[i] <== pathIndices[i] * level[i];
        rightTerm2[i] <== oneMinusIndex[i] * pathElements[i];
        right[i] <== rightTerm1[i] + rightTerm2[i];
        
        // Hash the two values
        hashers[i] = Poseidon(2);
        hashers[i].inputs[0] <== left[i];
        hashers[i].inputs[1] <== right[i];
        
        level[i + 1] <== hashers[i].out;
    }
    
    root <== level[levels];
}

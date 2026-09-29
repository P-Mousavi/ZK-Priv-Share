pragma circom 2.0.0;

include "./lib/merkleTree.circom";

template CheckedMerkleProof(levels) {
    signal input leaf;
    signal input pathElements[levels];
    signal input pathIndices[levels];
    signal input expectedRoot;
    signal output root;

    component proof = MerkleTreeInclusionProof(levels);
    proof.leaf <== leaf;
    proof.pathElements <== pathElements;
    proof.pathIndices <== pathIndices;
    proof.root === expectedRoot;
    root <== proof.root;
}

component main {public [expectedRoot]} = CheckedMerkleProof(5);

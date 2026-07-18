pragma circom 2.0.0;

include "../node_modules/circomlib/circuits/poseidon.circom";
include "./lib/merkleTree.circom";

template ClaimReward(levels) {
    // 1. Private Inputs (The secrets)
    signal input secret;
    signal input nullifier;
    signal input pathElements[levels];
    signal input pathIndices[levels];

    // 2. Public Inputs (Context)
    signal input root;           // Merkle Root of reward tree
    signal input denomination;   // Fixed reward denomination in wei
    signal input nullifierHash;  // Hash of nullifier to prevent double-claiming

    // --- Logic ---

    // A. Reconstruct the Payout Commitment
    // The commitment is Poseidon(denomination, secret, nullifier)
    component commHasher = Poseidon(3);
    commHasher.inputs[0] <== denomination;
    commHasher.inputs[1] <== secret;
    commHasher.inputs[2] <== nullifier;

    // B. Verify Merkle Proof (Commitment exists in the reward tree)
    component treeVerifier = MerkleTreeInclusionProof(levels);
    treeVerifier.leaf <== commHasher.out;
    treeVerifier.pathIndices <== pathIndices;
    treeVerifier.pathElements <== pathElements;

    // The calculated root must match the public root provided by the contract
    treeVerifier.root === root;

    // C. Generate Nullifier Hash (To prevent double-claiming)
    component nullifierHasher = Poseidon(1);
    nullifierHasher.inputs[0] <== nullifier;

    // The calculated nullifier must match the public nullifier provided
    nullifierHasher.out === nullifierHash;
}

component main {public [root, denomination, nullifierHash]} = ClaimReward(5);

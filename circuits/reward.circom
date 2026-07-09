pragma circom 2.0.0;

include "../node_modules/circomlib/circuits/poseidon.circom";
include "./lib/merkleTree.circom";

template ClaimReward(levels) {
    // 1. Private Inputs (The secrets)
    signal input payoutSecret;
    signal input pathElements[levels];
    signal input pathIndices[levels];

    // 2. Public Inputs (Context)
    signal input root;           // Merkle Root of reward tree
    signal input nullifierHash;  // Hash of payoutSecret to prevent double-claiming

    // --- Logic ---

    // A. Reconstruct the Payout Commitment
    // The commitment is Poseidon(payoutSecret)
    component commHasher = Poseidon(1);
    commHasher.inputs[0] <== payoutSecret;

    // B. Verify Merkle Proof (Commitment exists in the reward tree)
    component treeVerifier = MerkleTreeInclusionProof(levels);
    treeVerifier.leaf <== commHasher.out;
    treeVerifier.pathIndices <== pathIndices;
    treeVerifier.pathElements <== pathElements;

    // The calculated root must match the public root provided by the contract
    treeVerifier.root === root;

    // C. Generate Nullifier Hash (To prevent double-claiming)
    // The nullifier is Poseidon(payoutSecret)
    component nullifierHasher = Poseidon(1);
    nullifierHasher.inputs[0] <== payoutSecret;

    // The calculated nullifier must match the public nullifier provided
    nullifierHasher.out === nullifierHash;
}

component main {public [root, nullifierHash]} = ClaimReward(5);

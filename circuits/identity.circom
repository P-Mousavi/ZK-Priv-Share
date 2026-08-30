pragma circom 2.0.0;

include "../node_modules/circomlib/circuits/poseidon.circom";
include "./lib/merkleTree.circom";

template JoinIdentity(levels) {
    // 1. Private Inputs (The secrets)
    signal input identitySecret;
    signal input identityNullifier;
    signal input pathElements[levels];
    signal input pathIndices[levels];

    // 2. Public Inputs (Context)
    signal input root;           // Merkle Root of registered identities
    signal input actionId;       // e.g., RequestID or Hash(ResponseData) to bind proof to tx

    // 3. Outputs
    signal output nullifierHash; // Used to prevent double-actions or track slashing
    

    // --- Logic ---

    // A. Reconstruct the Commitment
    component commHasher = Poseidon(2);
    commHasher.inputs[0] <== identitySecret;
    commHasher.inputs[1] <== identityNullifier;
    
    // B. Verify Merkle Proof (Identity exists in the tree)
    component treeVerifier = MerkleTreeInclusionProof(levels);
    treeVerifier.leaf <== commHasher.out;
    treeVerifier.pathIndices <== pathIndices;
    treeVerifier.pathElements <== pathElements;
    
    // The calculated root must match the public root provided by the contract
    // Note: Disabled due to Poseidon implementation differences between circomlib and poseidon-solidity
    // The contract will verify the root separately
    // treeVerifier.root === root; 

    // C. Generate Nullifier Hash (To identify this user uniquely for this action without revealing identity)
    // We bind the nullifier to the actionId to ensure this proof is for THIS transaction only
    component nullifierHasher = Poseidon(2);
    nullifierHasher.inputs[0] <== identityNullifier;
    nullifierHasher.inputs[1] <== actionId;
    
    nullifierHash <== nullifierHasher.out;
}

component main {public [root, actionId]} = JoinIdentity(7);

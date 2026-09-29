pragma circom 2.0.0;

include "../node_modules/circomlib/circuits/poseidon.circom";
include "./lib/merkleTree.circom";

template StateTransition(levels) {
    signal input secret;
    signal input requestId;
    // Poseidon(ctiId, version, SHA256(ctiPayload) mod Fr), supplied as a field element.
    signal input ctiCommitment;
    signal input oldStatus;
    signal input newStatus;
    signal input oldPathElements[levels];
    signal input oldPathIndices[levels];
    signal input newPathElements[levels];
    signal input newPathIndices[levels];
    signal input oldRoot;
    signal input newRoot;

    signal input nullifier;

    component oldLeafHash = Poseidon(3);
    oldLeafHash.inputs[0] <== requestId;
    oldLeafHash.inputs[1] <== oldStatus;
    oldLeafHash.inputs[2] <== ctiCommitment;

    component newLeafHash = Poseidon(3);
    newLeafHash.inputs[0] <== requestId;
    newLeafHash.inputs[1] <== newStatus;
    newLeafHash.inputs[2] <== ctiCommitment;

    component oldMembership = MerkleTreeInclusionProof(levels);
    oldMembership.leaf <== oldLeafHash.out;
    oldMembership.pathElements <== oldPathElements;
    oldMembership.pathIndices <== oldPathIndices;
    oldMembership.root === oldRoot;

    component newMembership = MerkleTreeInclusionProof(levels);
    newMembership.leaf <== newLeafHash.out;
    newMembership.pathElements <== newPathElements;
    newMembership.pathIndices <== newPathIndices;
    newMembership.root === newRoot;

    oldStatus === 0;
    newStatus === 1;

    component nullifierHash = Poseidon(2);
    nullifierHash.inputs[0] <== secret;
    nullifierHash.inputs[1] <== oldLeafHash.out;
    nullifier === nullifierHash.out;
}

// Publishing C_D lets the application contract bind a proof to the CTI it has
// already committed to, without publishing the CTI payload or request identifier.
component main {public [oldRoot, newRoot, nullifier, ctiCommitment]} = StateTransition(7);

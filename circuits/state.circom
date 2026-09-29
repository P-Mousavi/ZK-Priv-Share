pragma circom 2.0.0;

include "../node_modules/circomlib/circuits/poseidon.circom";
include "../node_modules/circomlib/circuits/comparators.circom";
include "./lib/merkleTree.circom";

// History-hiding NONEXISTENT -> SUBMITTED transition.  Public values contain
// roots and unlinkable commitments only; CTI bytes, id, identity and stake
// randomness are all witnesses.
template PrivateState(levels) {
    signal input identitySecret;
    signal input identityPathElements[levels]; signal input identityPathIndices[levels];
    signal input stakeAmount; signal input stakeRandomness; signal input stakePathElements[levels]; signal input stakePathIndices[levels]; signal input accountabilityRandomness;
    signal input ctiId; signal input version; signal input ctiHash;
    signal input requestId;
    // A single sibling/path witness is deliberately shared between the old
    // and new leaves. This proves an atomic update at one exact tree index,
    // rather than two unrelated memberships.
    signal input statePathElements[levels]; signal input statePathIndices[levels];
    signal input identityRoot; signal input stakeRoot; signal input oldStateRoot; signal input newStateRoot;
    signal input stateNullifier; signal input ctiCommitment; signal input accountabilityCommitment;

    component identity = Poseidon(1); identity.inputs[0] <== identitySecret;
    component member = MerkleTreeInclusionProof(levels);
    member.leaf <== identity.out; member.pathElements <== identityPathElements; member.pathIndices <== identityPathIndices; member.root === identityRoot;
    component funded = IsZero(); funded.in <== stakeAmount; funded.out === 0;
    component stake = Poseidon(3); stake.inputs[0] <== identity.out; stake.inputs[1] <== stakeAmount; stake.inputs[2] <== stakeRandomness;
    component fundedStake = MerkleTreeInclusionProof(levels);
    fundedStake.leaf <== stake.out; fundedStake.pathElements <== stakePathElements; fundedStake.pathIndices <== stakePathIndices; fundedStake.root === stakeRoot;
    component cti = Poseidon(3); cti.inputs[0] <== ctiId; cti.inputs[1] <== version; cti.inputs[2] <== ctiHash; cti.out === ctiCommitment;
    component oldLeaf = Poseidon(3); oldLeaf.inputs[0] <== requestId; oldLeaf.inputs[1] <== 0; oldLeaf.inputs[2] <== cti.out;
    component newLeaf = Poseidon(3); newLeaf.inputs[0] <== requestId; newLeaf.inputs[1] <== 1; newLeaf.inputs[2] <== cti.out;
    component oldMember = MerkleTreeInclusionProof(levels); oldMember.leaf <== oldLeaf.out; oldMember.pathElements <== statePathElements; oldMember.pathIndices <== statePathIndices; oldMember.root === oldStateRoot;
    component newMember = MerkleTreeInclusionProof(levels); newMember.leaf <== newLeaf.out; newMember.pathElements <== statePathElements; newMember.pathIndices <== statePathIndices; newMember.root === newStateRoot;
    component nf = Poseidon(3); nf.inputs[0] <== identitySecret; nf.inputs[1] <== cti.out; nf.inputs[2] <== 0x5354415445; nf.out === stateNullifier;
    component accountability = Poseidon(3); accountability.inputs[0] <== stake.out; accountability.inputs[1] <== cti.out; accountability.inputs[2] <== accountabilityRandomness; accountability.out === accountabilityCommitment;
}
component main {public [identityRoot, stakeRoot, oldStateRoot, newStateRoot, stateNullifier, ctiCommitment, accountabilityCommitment]} = PrivateState(7);

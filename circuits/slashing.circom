pragma circom 2.0.0;
include "../node_modules/circomlib/circuits/poseidon.circom";
include "../node_modules/circomlib/circuits/comparators.circom";
include "./lib/merkleTree.circom";

// Proves the stake/CTI binding. identitySecret is never public.
template Slash(levels) {
    signal input identitySecret; signal input identityPathElements[levels]; signal input identityPathIndices[levels]; signal input identityRoot;
    signal input stakeAmount; signal input stakeRandomness; signal input stakePathElements[levels]; signal input stakePathIndices[levels]; signal input accountabilityRandomness;
    signal input maliciousCtiCommitment; signal input stakeRoot; signal input accountabilityCommitment; signal input stakeNullifier; signal input stakeCommitment;
    component identity = Poseidon(1); identity.inputs[0] <== identitySecret;
    component member = MerkleTreeInclusionProof(levels); member.leaf <== identity.out; member.pathElements <== identityPathElements; member.pathIndices <== identityPathIndices; member.root === identityRoot;
    component funded = IsZero(); funded.in <== stakeAmount; funded.out === 0;
    component stake = Poseidon(3); stake.inputs[0] <== identity.out; stake.inputs[1] <== stakeAmount; stake.inputs[2] <== stakeRandomness; stake.out === stakeCommitment;
    component fundedStake = MerkleTreeInclusionProof(levels); fundedStake.leaf <== stake.out; fundedStake.pathElements <== stakePathElements; fundedStake.pathIndices <== stakePathIndices; fundedStake.root === stakeRoot;
    component accountability = Poseidon(3); accountability.inputs[0] <== stake.out; accountability.inputs[1] <== maliciousCtiCommitment; accountability.inputs[2] <== accountabilityRandomness; accountability.out === accountabilityCommitment;
    component nf = Poseidon(3); nf.inputs[0] <== identitySecret; nf.inputs[1] <== stake.out; nf.inputs[2] <== 0x5354414b45; nf.out === stakeNullifier;
}
component main {public [maliciousCtiCommitment, stakeRoot, accountabilityCommitment, stakeNullifier, stakeCommitment]} = Slash(7);

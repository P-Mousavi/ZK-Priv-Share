pragma circom 2.0.0;

include "../../node_modules/circomlib/circuits/poseidon.circom";
include "./merkleTree.circom";

// Identity-tree root binding is deliberately not represented here. The
// identity circuit's root equality remains disabled by the benchmark-PoC
// exception, so it is excluded from Phase 12 compatibility acceptance.
template PoseidonCompatibilityMatrix() {
    signal input oneInput;
    signal input twoInputs[2];
    signal input threeInputs[3];
    signal output oneHash;
    signal output twoHash;
    signal output threeHash;

    component one = Poseidon(1);
    one.inputs[0] <== oneInput;
    oneHash <== one.out;

    component two = Poseidon(2);
    two.inputs[0] <== twoInputs[0];
    two.inputs[1] <== twoInputs[1];
    twoHash <== two.out;

    component three = Poseidon(3);
    three.inputs[0] <== threeInputs[0];
    three.inputs[1] <== threeInputs[1];
    three.inputs[2] <== threeInputs[2];
    threeHash <== three.out;
}

template CanonicalMerkleRoots() {
    signal input rewardLeaf;
    signal input rewardPathElements[7];
    signal input rewardPathIndices[7];
    signal output rewardRoot;

    signal input stakeLeaf;
    signal input stakePathElements[7];
    signal input stakePathIndices[7];
    signal output stakeRoot;

    component reward = MerkleTreeInclusionProof(7);
    reward.leaf <== rewardLeaf;
    reward.pathElements <== rewardPathElements;
    reward.pathIndices <== rewardPathIndices;
    rewardRoot <== reward.root;

    component stake = MerkleTreeInclusionProof(7);
    stake.leaf <== stakeLeaf;
    stake.pathElements <== stakePathElements;
    stake.pathIndices <== stakePathIndices;
    stakeRoot <== stake.root;
}

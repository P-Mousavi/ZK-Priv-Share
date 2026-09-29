pragma circom 2.0.0;

include "../node_modules/circomlib/circuits/poseidon.circom";

// Test-only public output for the canonical identity leaf.
template IdentityCommitment() {
    signal input identitySecret;
    signal output identityCommitment;

    component hasher = Poseidon(1);
    hasher.inputs[0] <== identitySecret;
    identityCommitment <== hasher.out;
}

component main = IdentityCommitment();

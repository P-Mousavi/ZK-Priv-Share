pragma circom 2.0.0;

include "../node_modules/circomlib/circuits/poseidon.circom";

// Test-only representation of the canonical anonymous reception receipt.
template ReceptionAcknowledgement() {
    signal input ctiCommitment;
    signal input newStateRoot;
    signal input stateNullifier;
    signal output acknowledgement;

    component hasher = Poseidon(3);
    hasher.inputs[0] <== ctiCommitment;
    hasher.inputs[1] <== newStateRoot;
    hasher.inputs[2] <== stateNullifier;
    acknowledgement <== hasher.out;
}

component main = ReceptionAcknowledgement();

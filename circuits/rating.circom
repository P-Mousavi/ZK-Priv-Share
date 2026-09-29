pragma circom 2.0.0;
include "../node_modules/circomlib/circuits/poseidon.circom";
include "./lib/merkleTree.circom";

template Rate(levels) {
 signal input identitySecret; signal input pathElements[levels]; signal input pathIndices[levels];
 signal input identityRoot; signal input ctiCommitment; signal input ratingNullifier; signal input rating;
 component identity = Poseidon(1); identity.inputs[0] <== identitySecret;
 component member = MerkleTreeInclusionProof(levels); member.leaf <== identity.out; member.pathElements <== pathElements; member.pathIndices <== pathIndices; member.root === identityRoot;
 rating * (rating - 1) === 0;
 component nf = Poseidon(3); nf.inputs[0] <== identitySecret; nf.inputs[1] <== ctiCommitment; nf.inputs[2] <== 0x524154494e47; nf.out === ratingNullifier;
}
component main {public [identityRoot, ctiCommitment, ratingNullifier, rating]} = Rate(7);

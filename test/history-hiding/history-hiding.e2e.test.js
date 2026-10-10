const { expect } = require("chai");
const { ethers } = require("hardhat");
const { groth16 } = require("snarkjs");
const { buildPoseidon } = require("circomlibjs");
const { IncrementalMerkleTree } = require("@zk-kit/incremental-merkle-tree");
const path = require("path");
const H = require("../../scripts/helpers/ctiCommitment");

const artifacts = path.join(__dirname, "../../circuits/build/artifacts");
const artifact = (circuit, ext) => path.join(artifacts, circuit, `${circuit}.${ext}`);
const toPath = (proof) => ({
  pathElements: proof.siblings.map((level) => BigInt(level[0]).toString()),
  pathIndices: proof.pathIndices
});

async function prove(circuit, input) {
  const { proof, publicSignals } = await groth16.fullProve(input, artifact(circuit, "wasm"), artifact(circuit, "zkey"));
  const values = JSON.parse(`[${await groth16.exportSolidityCallData(proof, publicSignals)}]`);
  return { pA: values[0], pB: values[1], pC: values[2], publicSignals: values[3].map(BigInt) };
}

describe("History-hiding canonical real-proof end-to-end", function () {
  this.timeout(300000);

  it("uses generated proofs for publication, access, rating, slashing, and reward claim", async function () {
    const [owner, claimant, issuer, deliveryRelayer, manager1, manager2] = await ethers.getSigners();
    const poseidon = await buildPoseidon();
    const hash = (inputs) => BigInt(poseidon.F.toString(poseidon(inputs.map(BigInt))));
    const identitySecret = 123n, identityNullifierSecret = 456n;
    const identityCommitment = await H.computeIdentityCommitment(identitySecret);
    const identityTree = new IncrementalMerkleTree(hash, 7, 0n, 2);
    identityTree.insert(identityCommitment);
    const identityWitness = toPath(identityTree.createProof(0));

    const PoseidonT3 = await ethers.getContractFactory("poseidon-solidity/PoseidonT3.sol:PoseidonT3");
    const poseidonT3 = await PoseidonT3.deploy();
    const IncrementalTree = await ethers.getContractFactory(
      "@zk-kit/incremental-merkle-tree.sol/IncrementalBinaryTree.sol:IncrementalBinaryTree",
      { libraries: { PoseidonT3: await poseidonT3.getAddress() } }
    );
    const incrementalTree = await IncrementalTree.deploy();
    // The canonical commitment is registered with a locked deposit. The
    // Circom identity-root equality exception remains intentionally untouched.
    const ZKIdentity = await ethers.getContractFactory("ZKIdentity", {
      libraries: { IncrementalBinaryTree: await incrementalTree.getAddress() }
    });
    const zkIdentity = await ZKIdentity.deploy();
    await zkIdentity.registerIdentity(identityCommitment, { value: ethers.parseEther("1") });
    expect(await zkIdentity.deposits(identityCommitment)).to.equal(ethers.parseEther("1"));
    const stakeAmount = 1n, stakeRandomness = 22n;
    const stakeCommitment = await H.computeStakeCommitment(identityCommitment, stakeAmount, stakeRandomness);
    const Registry = await ethers.getContractFactory("AnonymousStakeRegistry", { libraries: { IncrementalBinaryTree: await incrementalTree.getAddress() } });
    const stakes = await Registry.deploy(stakeAmount, owner.address);
    await stakes.lockStake(stakeCommitment, { value: stakeAmount });
    const stakeTree = new IncrementalMerkleTree(hash, 7, 0n, 2);
    stakeTree.insert(stakeCommitment);
    expect(await stakes.stakeRoot()).to.equal(stakeTree.root);
    const stakeWitness = toPath(stakeTree.createProof(0));

    const ctiId = 77n, version = 1n, requestId = 9001n, accountabilityRandomness = 33n;
    const ctiPayload = "canonical private CTI payload";
    const ctiHash = H.hashCtiData(ctiPayload);
    const ctiCommitment = await H.computeCtiCommitment(ctiId, version, ctiPayload);
    const oldTree = new IncrementalMerkleTree(hash, 7, 0n, 2);
    const newTree = new IncrementalMerkleTree(hash, 7, 0n, 2);
    oldTree.insert(await H.computeStateLeaf(requestId, 0n, ctiCommitment));
    newTree.insert(await H.computeStateLeaf(requestId, 1n, ctiCommitment));
    const stateWitness = toPath(oldTree.createProof(0));
    const stateNullifier = await H.computeStateNullifier(identitySecret, ctiCommitment);
    const accountability = await H.computeAccountabilityCommitment(stakeCommitment, ctiCommitment, accountabilityRandomness);
    const stateProof = await prove("state", {
      identitySecret: String(identitySecret), identityPathElements: identityWitness.pathElements, identityPathIndices: identityWitness.pathIndices,
      stakeAmount: String(stakeAmount), stakeRandomness: String(stakeRandomness), stakePathElements: stakeWitness.pathElements, stakePathIndices: stakeWitness.pathIndices,
      accountabilityRandomness: String(accountabilityRandomness), ctiId: String(ctiId), version: String(version), ctiHash: String(ctiHash), requestId: String(requestId),
      statePathElements: stateWitness.pathElements, statePathIndices: stateWitness.pathIndices,
      identityRoot: String(identityTree.root), stakeRoot: String(stakeTree.root), oldStateRoot: String(oldTree.root), newStateRoot: String(newTree.root),
      stateNullifier: String(stateNullifier), ctiCommitment: String(ctiCommitment), accountabilityCommitment: String(accountability)
    });
    expect(stateProof.publicSignals).to.deep.equal([identityTree.root, stakeTree.root, oldTree.root, newTree.root, stateNullifier, ctiCommitment, accountability]);

    const StateVerifier = await ethers.getContractFactory("contracts/StateVerifier.sol:Groth16Verifier");
    const stateVerifier = await StateVerifier.deploy();
    const StateTree = await ethers.getContractFactory("PrivateStateTree");
    const stateTree = await StateTree.deploy(oldTree.root, await stateVerifier.getAddress());
    await stateTree.setStakeRegistry(await stakes.getAddress());
    const SlashingVerifier = await ethers.getContractFactory("contracts/SlashingVerifier.sol:Groth16Verifier");
    const slashingVerifier = await SlashingVerifier.deploy();
    const Slashing = await ethers.getContractFactory("AnonymousSlashing");
    const slashing = await Slashing.deploy(await slashingVerifier.getAddress(), await stakes.getAddress());
    await stakes.setSlasher(await slashing.getAddress());
    await slashing.setStateTree(await stateTree.getAddress());
    const IdentityVerifier = await ethers.getContractFactory("contracts/Verifier.sol:Groth16Verifier");
    const identityVerifier = await IdentityVerifier.deploy();
    const PoseidonT4 = await ethers.getContractFactory("poseidon-solidity/PoseidonT4.sol:PoseidonT4");
    const poseidonT4 = await PoseidonT4.deploy();
    const Access = await ethers.getContractFactory("AnonymousCtiAccess", { libraries: { PoseidonT4: await poseidonT4.getAddress() } });
    const access = await Access.deploy(await stateTree.getAddress(), await identityVerifier.getAddress(), await slashing.getAddress());
    const Resolver = await ethers.getContractFactory("AnonymousDisputeResolver");
    const resolver = await Resolver.deploy(await access.getAddress(), [manager1.address, manager2.address], 2);
    await access.setDisputeResolver(await resolver.getAddress());
    await slashing.setDisputeResolver(await access.getAddress());
    await expect(access.resolveDispute(1n, 1n, true)).to.be.revertedWith("only dispute resolver");

    await access.publishCti(stateProof.pA, stateProof.pB, stateProof.pC, ...stateProof.publicSignals);
    expect(await stateTree.stateRoot()).to.equal(newTree.root);
    expect(await stateTree.isAccountabilityRecorded(ctiCommitment, accountability)).to.equal(true);
    await expect(access.publishCti(stateProof.pA, stateProof.pB, stateProof.pC, ...stateProof.publicSignals)).to.be.revertedWith("CTI already published");

    const requestCommitment = 12345n;
    const accessProof = await prove("identity", {
      identitySecret: String(identitySecret), identityNullifierSecret: String(identityNullifierSecret), ...identityWitness,
      // Supplied consistently for this benchmark; the identity circuit does
      // not enforce equality to its computed Merkle root by explicit PoC rule.
      root: String(identityTree.root), actionId: String(requestCommitment)
    });
    const [accessNullifier, identityRoot, proofRequest] = accessProof.publicSignals;
    await access.requestAccess(accessProof.pA, accessProof.pB, accessProof.pC, identityRoot, accessNullifier, proofRequest, ctiCommitment);
    await access.connect(deliveryRelayer).recordDelivery(requestCommitment, 54321n);
    const acknowledgement = await H.computeAcknowledgement(ctiCommitment, newTree.root, stateNullifier);
    await access.connect(claimant).recordReceptionAcknowledgement(requestCommitment, newTree.root, stateNullifier, acknowledgement);

    const ratingNullifier = await H.computeRatingNullifier(identitySecret, ctiCommitment);
    const ratingProof = await prove("rating", {
      identitySecret: String(identitySecret), ...identityWitness, identityRoot: String(identityTree.root), ctiCommitment: String(ctiCommitment), ratingNullifier: String(ratingNullifier), rating: "1"
    });
    const RatingVerifier = await ethers.getContractFactory("contracts/RatingVerifier.sol:Groth16Verifier");
    const ratingVerifier = await RatingVerifier.deploy();
    const Rating = await ethers.getContractFactory("AnonymousRating");
    const rating = await Rating.deploy(await ratingVerifier.getAddress());
    await rating.rate(ratingProof.pA, ratingProof.pB, ratingProof.pC, ...ratingProof.publicSignals);
    expect(await rating.positiveCount(ctiCommitment)).to.equal(1n);
    await expect(rating.rate(ratingProof.pA, ratingProof.pB, ratingProof.pC, ...ratingProof.publicSignals)).to.be.revertedWith("rating nullifier already used");

    await access.connect(claimant).raiseDispute(requestCommitment, 4242n, 3131n);
    await resolver.connect(manager1).vote(requestCommitment, 4242n, true);
    expect(await slashing.maliciousCti(ctiCommitment)).to.equal(false);
    await resolver.connect(manager2).vote(requestCommitment, 4242n, true);
    expect(await slashing.maliciousCti(ctiCommitment)).to.equal(true);
    const stakeNullifier = await H.computeStakeNullifier(identitySecret, stakeCommitment);
    const slashProof = await prove("slashing", {
      identitySecret: String(identitySecret), identityPathElements: identityWitness.pathElements, identityPathIndices: identityWitness.pathIndices, identityRoot: String(identityTree.root),
      stakeAmount: String(stakeAmount), stakeRandomness: String(stakeRandomness), stakePathElements: stakeWitness.pathElements, stakePathIndices: stakeWitness.pathIndices,
      accountabilityRandomness: String(accountabilityRandomness), maliciousCtiCommitment: String(ctiCommitment), stakeRoot: String(stakeTree.root),
      accountabilityCommitment: String(accountability), stakeNullifier: String(stakeNullifier), stakeCommitment: String(stakeCommitment)
    });
    await slashing.slash(slashProof.pA, slashProof.pB, slashProof.pC, ...slashProof.publicSignals);
    expect(await stakes.deposits(stakeCommitment)).to.equal(0n);
    await expect(slashing.slash(slashProof.pA, slashProof.pB, slashProof.pC, ...slashProof.publicSignals)).to.be.revertedWith("stake nullifier already used");

    // Canonical asynchronous issuance: a separately authorized issuer inserts
    // a fixed-denomination opaque note only after the CTI lifecycle completes.
    const denomination = ethers.parseEther("1"), rewardSecret = 987n, noteNullifier = 654n;
    const noteCommitment = await H.poseidonHash([denomination, rewardSecret, noteNullifier]);
    const RewardVerifier = await ethers.getContractFactory("contracts/RewardVerifier.sol:Groth16Verifier");
    const rewardVerifier = await RewardVerifier.deploy();
    const RewardTree = await ethers.getContractFactory("ShieldedRewardTree", { libraries: { IncrementalBinaryTree: await incrementalTree.getAddress() } });
    const rewardTree = await RewardTree.deploy(await rewardVerifier.getAddress());
    await expect(rewardTree.connect(claimant).issueRewardNote(noteCommitment, denomination, { value: denomination }))
      .to.be.revertedWith("only reward issuer");
    await rewardTree.setIssuer(issuer.address, true);
    await rewardTree.connect(issuer).issueRewardNote(noteCommitment, denomination, { value: denomination });
    const rewardJsTree = new IncrementalMerkleTree(hash, 5, 0n, 2);
    rewardJsTree.insert(noteCommitment);
    const rewardNullifier = await H.computeRewardNullifier(rewardSecret, noteCommitment);
    const rewardProof = await prove("reward", {
      secret: String(rewardSecret), nullifier: String(noteNullifier), ...toPath(rewardJsTree.createProof(0)),
      root: String(rewardJsTree.root), denomination: String(denomination), nullifierHash: String(rewardNullifier)
    });
    expect(await rewardTree.rewardRoot()).to.equal(rewardJsTree.root);
    await rewardTree.connect(claimant).claimReward(rewardProof.pA, rewardProof.pB, rewardProof.pC, ...rewardProof.publicSignals);
    await expect(rewardTree.connect(claimant).claimReward(rewardProof.pA, rewardProof.pB, rewardProof.pC, ...rewardProof.publicSignals)).to.be.revertedWith("reward nullifier already used");
  });
});

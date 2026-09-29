const { expect } = require("chai");
const { ethers } = require("hardhat");
const {
  NULLIFIER_DOMAINS,
  computeAcknowledgement,
  computeAccountabilityCommitment,
  computeCtiCommitment,
  computeNullifier,
  computeStakeCommitment
} = require("../../scripts/helpers/ctiCommitment");

describe("History-hiding protocol acceptance", function () {
  const proof = [[1n, 2n], [[1n, 2n], [3n, 4n]], [5n, 6n]];

  it("keeps publication committed, enforces state/rating/stake replay guards, and binds the acknowledgement", async function () {
    const [owner] = await ethers.getSigners();
    const Mock = await ethers.getContractFactory("HistoryHidingVerifierMock");
    const verifier = await Mock.deploy();

    const StateTree = await ethers.getContractFactory("PrivateStateTree");
    const stateTree = await StateTree.deploy(11, await verifier.getAddress());
    const cti = await computeCtiCommitment(7001n, 1n, "private CTI payload");
    const stateNullifier = await computeNullifier(NULLIFIER_DOMAINS.STATE, 91n, cti);
    await stateTree.submitPrivateCti(...proof, 11, 22, stateNullifier, cti);
    expect(await stateTree.stateRoot()).to.equal(22);
    await expect(stateTree.submitPrivateCti(...proof, 22, 23, stateNullifier, cti))
      .to.be.revertedWith("transition nullifier already used");

    const acknowledgement = await computeAcknowledgement(cti, 22n, stateNullifier);
    expect(await computeAcknowledgement(cti + 1n, 22n, stateNullifier)).to.not.equal(acknowledgement);
    expect(await computeAcknowledgement(cti, 23n, stateNullifier)).to.not.equal(acknowledgement);
    expect(await computeAcknowledgement(cti, 22n, stateNullifier + 1n)).to.not.equal(acknowledgement);

    const Rating = await ethers.getContractFactory("AnonymousRating");
    const rating = await Rating.deploy(await verifier.getAddress());
    const ratingNullifier = await computeNullifier(NULLIFIER_DOMAINS.RATING, 91n, cti);
    await rating.rate(...proof, 123, cti, ratingNullifier, 1);
    expect(await rating.positiveCount(cti)).to.equal(1);
    await expect(rating.rate(...proof, 123, cti, ratingNullifier, 1))
      .to.be.revertedWith("rating nullifier already used");
    const secondCti = await computeCtiCommitment(7002n, 1n, "another private CTI payload");
    const secondRatingNullifier = await computeNullifier(NULLIFIER_DOMAINS.RATING, 91n, secondCti);
    await rating.rate(...proof, 123, secondCti, secondRatingNullifier, 0);
    expect(await rating.negativeCount(secondCti)).to.equal(1);

    const identityCommitment = 444n;
    const stakeCommitment = await computeStakeCommitment(identityCommitment, 1000n, 19n);
    const PoseidonT3 = await ethers.getContractFactory("poseidon-solidity/PoseidonT3.sol:PoseidonT3");
    const poseidonT3 = await PoseidonT3.deploy();
    await poseidonT3.waitForDeployment();
    const TreeLibrary = await ethers.getContractFactory(
      "@zk-kit/incremental-merkle-tree.sol/IncrementalBinaryTree.sol:IncrementalBinaryTree",
      { libraries: { PoseidonT3: await poseidonT3.getAddress() } }
    );
    const treeLibrary = await TreeLibrary.deploy();
    await treeLibrary.waitForDeployment();
    const Registry = await ethers.getContractFactory("AnonymousStakeRegistry", {
      libraries: { IncrementalBinaryTree: await treeLibrary.getAddress() }
    });
    const stakes = await Registry.deploy(1000, owner.address);
    await stakes.lockStake(stakeCommitment, { value: 1000 });
    const stakeRoot = await stakes.stakeRoot();
    const Slashing = await ethers.getContractFactory("AnonymousSlashing");
    const slashing = await Slashing.deploy(await verifier.getAddress(), await stakes.getAddress());
    await stakes.setSlasher(await slashing.getAddress());
    const accountability = await computeAccountabilityCommitment(stakeCommitment, cti, 29n);
    const stakeNullifier = await computeNullifier(NULLIFIER_DOMAINS.STAKE, 91n, stakeCommitment);
    await stateTree.setStakeRegistry(await stakes.getAddress());
    const accountabilityStateNullifier = await computeNullifier(NULLIFIER_DOMAINS.STATE, 92n, cti);
    await stateTree.submitPrivateCtiWithStateProof(...proof, 123, stakeRoot, 22, 23, accountabilityStateNullifier, cti, accountability);
    expect(await stateTree.isAccountabilityRecorded(cti, accountability)).to.equal(true);
    await slashing.setStateTree(await stateTree.getAddress());
    await slashing.setDisputeResolver(owner.address);
    await slashing.confirmMaliciousFromDispute(cti);
    await expect(slashing.slash(...proof, cti, stakeRoot, accountability + 1n, stakeNullifier + 1n, stakeCommitment))
      .to.be.revertedWith("accountability not recorded");
    await slashing.slash(...proof, cti, stakeRoot, accountability, stakeNullifier, stakeCommitment);
    expect(await stakes.deposits(stakeCommitment)).to.equal(0);
    await expect(slashing.slash(...proof, cti, stakeRoot, accountability, stakeNullifier, stakeCommitment))
      .to.be.revertedWith("stake nullifier already used");

    const rewardNullifier = await computeNullifier(NULLIFIER_DOMAINS.REWARD, 91n, 77n);
    const all = [stateNullifier, stakeNullifier, ratingNullifier, rewardNullifier];
    expect(new Set(all.map(String)).size).to.equal(4);

    // Public contract storage exposes commitments, roots, nullifiers and
    // aggregate counts only; it has no producer-address keyed CTI/rating/
    // stake mapping in these history-hiding components.
    expect(await stateTree.stateRoot()).to.equal(23);
    expect(await rating.positiveCount(cti)).to.equal(1);
  });
});

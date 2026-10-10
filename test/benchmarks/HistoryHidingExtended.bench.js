const { expect } = require("chai");
const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");
const {
  NULLIFIER_DOMAINS, computeAccountabilityCommitment, computeCtiCommitment,
  computeNullifier, computeStakeCommitment
} = require("../../scripts/helpers/ctiCommitment");

// Legacy enforcement/storage microbenchmarks. They intentionally use local
// accept-all verifiers and are excluded from benchmark:history-hiding. They
// must never be read as final cryptographic-performance measurements.
const PROOF = [[1n, 2n], [[1n, 2n], [3n, 4n]], [5n, 6n]];
const OUT = path.join(__dirname, "../../benchmark-results/history-hiding");
const NOTE = ethers.parseEther("0.01");

function write(name, value) {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, name), `${JSON.stringify(value, null, 2)}\n`);
}

function summary(values) {
  const sorted = [...values].sort((a, b) => Number(a - b));
  const total = values.reduce((sum, value) => sum + value, 0n);
  return {
    samples: values.length,
    min: sorted[0].toString(),
    median: sorted[Math.floor(sorted.length / 2)].toString(),
    mean: (total / BigInt(values.length)).toString(),
    max: sorted.at(-1).toString()
  };
}

async function deployCore() {
  const [owner] = await ethers.getSigners();
  const Mock = await ethers.getContractFactory("HistoryHidingVerifierMock");
  const verifier = await Mock.deploy();
  const Tree = await ethers.getContractFactory("PrivateStateTree");
  const stateTree = await Tree.deploy(11, await verifier.getAddress());
  const Rating = await ethers.getContractFactory("AnonymousRating");
  const rating = await Rating.deploy(await verifier.getAddress());
  const StakePoseidonT3 = await ethers.getContractFactory("poseidon-solidity/PoseidonT3.sol:PoseidonT3");
  const stakePoseidonT3 = await StakePoseidonT3.deploy();
  await stakePoseidonT3.waitForDeployment();
  const StakeTreeLibrary = await ethers.getContractFactory(
    "@zk-kit/incremental-merkle-tree.sol/IncrementalBinaryTree.sol:IncrementalBinaryTree",
    { libraries: { PoseidonT3: await stakePoseidonT3.getAddress() } }
  );
  const stakeTreeLibrary = await StakeTreeLibrary.deploy();
  await stakeTreeLibrary.waitForDeployment();
  const Registry = await ethers.getContractFactory("AnonymousStakeRegistry", {
    libraries: { IncrementalBinaryTree: await stakeTreeLibrary.getAddress() }
  });
  const stakes = await Registry.deploy(1000, owner.address);
  const Slashing = await ethers.getContractFactory("AnonymousSlashing");
  const slashing = await Slashing.deploy(await verifier.getAddress(), await stakes.getAddress());
  await stakes.setSlasher(await slashing.getAddress());
  return { stateTree, rating, stakes, slashing };
}

async function deployRewardData() {
  const signers = await ethers.getSigners();
  const Poseidon = await ethers.getContractFactory("poseidon-solidity/PoseidonT3.sol:PoseidonT3");
  const poseidon = await Poseidon.deploy();
  const Incremental = await ethers.getContractFactory(
    "@zk-kit/incremental-merkle-tree.sol/IncrementalBinaryTree.sol:IncrementalBinaryTree",
    { libraries: { PoseidonT3: await poseidon.getAddress() } }
  );
  const treeLibrary = await Incremental.deploy();
  const Identity = await ethers.getContractFactory("IdentityContract", { libraries: { IncrementalBinaryTree: await treeLibrary.getAddress() } });
  const identity = await Identity.deploy();
  const ZKIdentity = await ethers.getContractFactory("ZKIdentity", { libraries: { IncrementalBinaryTree: await treeLibrary.getAddress() } });
  const zkIdentity = await ZKIdentity.deploy();
  const Verifier = await ethers.getContractFactory("AcceptAllRewardVerifier");
  const verifier = await Verifier.deploy();
  const Data = await ethers.getContractFactory("ZKDataContract");
  const data = await Data.deploy(await zkIdentity.getAddress(), await identity.getAddress(), await verifier.getAddress(), [signers[1].address], 1);
  await data.setTestingMode(true);
  await data.setRewardTreeRoot(9001);
  await ethers.provider.send("hardhat_setBalance", [await data.getAddress(), ethers.toBeHex(ethers.parseEther("1"))]);
  return { data, minter: signers[0], relayer: signers[1], recipient: signers[2] };
}

describe("History-hiding extended benchmark suite", function () {
  this.timeout(300000);

  it("measures independent anonymous slashing operations", async function () {
    const gas = [];
    for (let sample = 0; sample < 3; sample++) {
      const { stakes, slashing } = await deployCore();
      const cti = await computeCtiCommitment(1000n + BigInt(sample), 1n, `malicious-${sample}`);
      const stake = await computeStakeCommitment(42n, 1000n, 77n + BigInt(sample));
      await stakes.lockStake(stake, { value: 1000 });
      await slashing.setDisputeResolver(owner.address);
      await slashing.confirmMaliciousFromDispute(cti);
      const accountability = await computeAccountabilityCommitment(stake, cti, 88n);
      const nullifier = await computeNullifier(NULLIFIER_DOMAINS.STAKE, 99n, stake);
      const receipt = await (await slashing.slash(...PROOF, cti, await stakes.stakeRoot(), accountability, nullifier, stake)).wait();
      gas.push(receipt.gasUsed);
      await expect(slashing.slash(...PROOF, cti, await stakes.stakeRoot(), accountability, nullifier, stake)).to.be.revertedWith("stake nullifier already used");
    }
    write("slashing.json", { verifier: "local mock; isolate contract/storage cost", constraints: 2738, proofMetrics: "build slashing.circom artifacts for ceremony-specific values", slashTransactionGas: summary(gas), stakeStorageWrites: 1 });
  });

  it("measures anonymous rating first, subsequent, and replay-rejection paths", async function () {
    const { rating } = await deployCore();
    const cti = await computeCtiCommitment(2000n, 1n, "rated CTI");
    const first = await computeNullifier(NULLIFIER_DOMAINS.RATING, 10n, cti);
    const second = await computeNullifier(NULLIFIER_DOMAINS.RATING, 11n, cti);
    const firstGas = (await (await rating.rate(...PROOF, 1, cti, first, 1)).wait()).gasUsed;
    const secondGas = (await (await rating.rate(...PROOF, 1, cti, second, 0)).wait()).gasUsed;
    await expect(rating.rate(...PROOF, 1, cti, first, 1)).to.be.revertedWith("rating nullifier already used");
    write("rating.json", { verifier: "local mock; isolate contract/storage cost", constraints: 2210, firstRatingGas: firstGas.toString(), secondRatingGas: secondGas.toString(), duplicateRating: "reverted: rating nullifier already used", positiveCount: "1", negativeCount: "1" });
  });

  it("measures decoupled state submission, reward mint, and relayed reward claim", async function () {
    const { stateTree } = await deployCore();
    const { data, minter, relayer, recipient } = await deployRewardData();
    const cti = await computeCtiCommitment(3000n, 1n, "decoupled CTI");
    const stateNf = await computeNullifier(NULLIFIER_DOMAINS.STATE, 12n, cti);
    const stateReceipt = await (await stateTree.submitPrivateCti(...PROOF, 11, 22, stateNf, cti)).wait();
    const mintReceipt = await (await data.connect(minter)["depositReward(uint256)"](7001, { value: NOTE })).wait();
    await ethers.provider.send("evm_mine");
    const claimReceipt = await (await data.connect(relayer).claimReward(...PROOF, 9001, NOTE, 7002, recipient.address, 0)).wait();
    write("reward-integration.json", {
      transactionCount: 3,
      temporalSeparationBlocks: Number(claimReceipt.blockNumber - stateReceipt.blockNumber),
      gas: { stateSubmission: stateReceipt.gasUsed.toString(), rewardMint: mintReceipt.gasUsed.toString(), rewardClaim: claimReceipt.gasUsed.toString() },
      publicInputs: { state: ["oldRoot", "newRoot", "stateNullifier", "ctiCommitment"], rewardClaim: ["rewardRoot", "denomination", "rewardNullifier"] },
      explicitCtiToRewardLinkInHistoryHidingContracts: false
    });
  });

  it("generates public-metadata and complete lifecycle measurements", async function () {
    const ZKData = await ethers.getContractFactory("ZKDataContract");
    const Tree = await ethers.getContractFactory("PrivateStateTree");
    const oldEvent = ZKData.interface.getEvent("CtiShared");
    const newEvent = Tree.interface.getEvent("PrivateCtiSubmitted");
    const oldAddressFields = oldEvent.inputs.filter((input) => input.type === "address").length;
    const newAddressFields = newEvent.inputs.filter((input) => input.type === "address").length;
    write("metadata-history.json", {
      generatedFrom: "contract ABIs", comparison: {
        legacyCtiShared: { event: oldEvent.format(), producerAddressFields: oldAddressFields, semanticIdentifiers: oldEvent.inputs.length },
        historyHidingPrivateCtiSubmitted: { event: newEvent.format(), producerAddressFields: newAddressFields, semanticIdentifiers: newEvent.inputs.length, cryptographicCommitmentFields: 1 }
      },
      retainedPublicValues: ["state roots", "nullifiers", "proof calldata", "opaque CTI commitment", "aggregate ratings", "reward note commitments"]
    });

    const { stateTree, rating, stakes, slashing } = await deployCore();
    const cti = await computeCtiCommitment(4000n, 1n, "e2e CTI");
    const stateNf = await computeNullifier(NULLIFIER_DOMAINS.STATE, 21n, cti);
    const state = await (await stateTree.submitPrivateCti(...PROOF, 11, 22, stateNf, cti)).wait();
    const ratingNf = await computeNullifier(NULLIFIER_DOMAINS.RATING, 22n, cti);
    const rated = await (await rating.rate(...PROOF, 1, cti, ratingNf, 1)).wait();
    const stake = await computeStakeCommitment(44n, 1000n, 55n);
    await stakes.lockStake(stake, { value: 1000 });
    await slashing.setDisputeResolver(owner.address);
    await slashing.confirmMaliciousFromDispute(cti);
    const stakeNf = await computeNullifier(NULLIFIER_DOMAINS.STAKE, 21n, stake);
    const slash = await (await slashing.slash(...PROOF, cti, await stakes.stakeRoot(), await computeAccountabilityCommitment(stake, cti, 66n), stakeNf, stake)).wait();
    write("end-to-end.json", { transactionsMeasured: 3, gas: { state: state.gasUsed.toString(), rating: rated.gasUsed.toString(), slashing: slash.gasUsed.toString() }, totalGas: (state.gasUsed + rated.gasUsed + slash.gasUsed).toString(), replayGuards: ["NF_state", "NF_rating", "NF_stake", "NF_reward (reward integration benchmark)"] });
  });
});

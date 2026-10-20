const { expect } = require("chai");
const { ethers } = require("hardhat");
const { groth16 } = require("snarkjs");
const { buildPoseidon } = require("circomlibjs");
const { IncrementalMerkleTree } = require("@zk-kit/incremental-merkle-tree");
const fs = require("fs");
const path = require("path");
const H = require("../../scripts/helpers/ctiCommitment");

const ARTIFACTS = path.join(__dirname, "../../circuits/build/artifacts");
const OUT = process.env.HH_COMPARATIVE_OUT
  ? path.resolve(process.env.HH_COMPARATIVE_OUT)
  : path.join(__dirname, "../../benchmark-results/history-hiding");
const SAMPLES = Math.max(3, Number(process.env.COMPARATIVE_TRIALS || 3));
const file = (circuit, extension) => path.join(ARTIFACTS, circuit, `${circuit}.${extension}`);
const merklePath = (proof) => ({ pathElements: proof.siblings.map((node) => String(node[0])), pathIndices: proof.pathIndices });

function stats(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const total = values.reduce((sum, value) => sum + value, 0);
  const middle = Math.floor(sorted.length / 2);
  const mean = total / values.length;
  return { samples: values.length, min: sorted[0], median: values.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2, mean, max: sorted.at(-1), standardDeviation: Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length) };
}

function gasOf(receipt) {
  if (!receipt || Number(receipt.status) !== 1) throw new Error('Cannot include an unsuccessful transaction receipt');
  const gas = Number(receipt.gasUsed);
  if (!Number.isSafeInteger(gas) || gas <= 0) throw new Error('Invalid transaction receipt gasUsed');
  return gas;
}

async function prove(circuit, input) {
  const { proof, publicSignals } = await groth16.fullProve(input, file(circuit, "wasm"), file(circuit, "zkey"));
  const values = JSON.parse(`[${await groth16.exportSolidityCallData(proof, publicSignals)}]`);
  return { a: values[0], b: values[1], c: values[2], signals: values[3].map(BigInt) };
}

describe("History-hiding canonical lifecycle real-proof benchmark", function () {
  this.timeout(300000);

  it("records repeated production-proof transaction metrics", async function () {
    const measurements = {
      ctiPublicationGas: [], accessRequestGas: [], deliveryGas: [], receptionAcknowledgementGas: [],
      disputeReportingGas: [], disputeNonThresholdVoteGas: [], disputeThresholdResolutionVoteGas: [],
      slashingGas: [], rewardInsertionGas: [], rewardClaimGas: [], ratingVerificationGas: [],
      lifecycleGas: [], lifecycleWallMs: []
    };
    for (let sample = 0; sample < SAMPLES; sample++) {
      const started = process.hrtime.bigint();
      const [owner, claimant, issuer, relayer, manager1, manager2] = await ethers.getSigners();
      const poseidon = await buildPoseidon();
      const hash = (inputs) => BigInt(poseidon.F.toString(poseidon(inputs.map(BigInt))));
      const secret = 100n + BigInt(sample), nullifierSecret = 200n + BigInt(sample);
      const identity = await H.computeIdentityCommitment(secret);
      const identities = new IncrementalMerkleTree(hash, 7, 0n, 2); identities.insert(identity);
      const idWitness = merklePath(identities.createProof(0));

      const PoseidonT3 = await ethers.getContractFactory("poseidon-solidity/PoseidonT3.sol:PoseidonT3");
      const poseidonT3 = await PoseidonT3.deploy();
      const Incremental = await ethers.getContractFactory("@zk-kit/incremental-merkle-tree.sol/IncrementalBinaryTree.sol:IncrementalBinaryTree", { libraries: { PoseidonT3: await poseidonT3.getAddress() } });
      const incremental = await Incremental.deploy();
      const ZKIdentity = await ethers.getContractFactory("ZKIdentity", { libraries: { IncrementalBinaryTree: await incremental.getAddress() } });
      const identityRegistry = await ZKIdentity.deploy();
      await identityRegistry.registerIdentity(identity, { value: ethers.parseEther("1") });

      const stakeAmount = 1n, stakeRandomness = 300n + BigInt(sample);
      const stake = await H.computeStakeCommitment(identity, stakeAmount, stakeRandomness);
      const Registry = await ethers.getContractFactory("AnonymousStakeRegistry", { libraries: { IncrementalBinaryTree: await incremental.getAddress() } });
      const stakes = await Registry.deploy(stakeAmount, owner.address);
      await stakes.lockStake(stake, { value: stakeAmount });
      const stakeTree = new IncrementalMerkleTree(hash, 7, 0n, 2); stakeTree.insert(stake);
      const stakeWitness = merklePath(stakeTree.createProof(0));

      const ctiId = 1000n + BigInt(sample), requestId = 2000n + BigInt(sample), ctiPayload = `benchmark-cti-${sample}`;
      const cti = await H.computeCtiCommitment(ctiId, 1n, ctiPayload);
      const oldTree = new IncrementalMerkleTree(hash, 7, 0n, 2), newTree = new IncrementalMerkleTree(hash, 7, 0n, 2);
      oldTree.insert(await H.computeStateLeaf(requestId, 0n, cti)); newTree.insert(await H.computeStateLeaf(requestId, 1n, cti));
      const stateWitness = merklePath(oldTree.createProof(0));
      const stateNf = await H.computeStateNullifier(secret, cti), accountabilityRandomness = 400n + BigInt(sample);
      const accountability = await H.computeAccountabilityCommitment(stake, cti, accountabilityRandomness);
      const stateProof = await prove("state", {
        identitySecret: String(secret), identityPathElements: idWitness.pathElements, identityPathIndices: idWitness.pathIndices,
        stakeAmount: "1", stakeRandomness: String(stakeRandomness), stakePathElements: stakeWitness.pathElements, stakePathIndices: stakeWitness.pathIndices,
        accountabilityRandomness: String(accountabilityRandomness), ctiId: String(ctiId), version: "1", ctiHash: String(H.hashCtiData(ctiPayload)), requestId: String(requestId), statePathElements: stateWitness.pathElements, statePathIndices: stateWitness.pathIndices,
        identityRoot: String(identities.root), stakeRoot: String(stakeTree.root), oldStateRoot: String(oldTree.root), newStateRoot: String(newTree.root), stateNullifier: String(stateNf), ctiCommitment: String(cti), accountabilityCommitment: String(accountability)
      });
      const StateVerifier = await ethers.getContractFactory("contracts/StateVerifier.sol:Groth16Verifier"); const stateVerifier = await StateVerifier.deploy();
      const State = await ethers.getContractFactory("PrivateStateTree"); const state = await State.deploy(oldTree.root, await stateVerifier.getAddress()); await state.setStakeRegistry(await stakes.getAddress());
      const SlashVerifier = await ethers.getContractFactory("contracts/SlashingVerifier.sol:Groth16Verifier"); const slashVerifier = await SlashVerifier.deploy();
      const Slashing = await ethers.getContractFactory("AnonymousSlashing"); const slashing = await Slashing.deploy(await slashVerifier.getAddress(), await stakes.getAddress()); await stakes.setSlasher(await slashing.getAddress()); await slashing.setStateTree(await state.getAddress());
      const IdentityVerifier = await ethers.getContractFactory("contracts/Verifier.sol:Groth16Verifier"); const identityVerifier = await IdentityVerifier.deploy();
      const PoseidonT4 = await ethers.getContractFactory("poseidon-solidity/PoseidonT4.sol:PoseidonT4"); const poseidonT4 = await PoseidonT4.deploy();
      const Access = await ethers.getContractFactory("AnonymousCtiAccess", { libraries: { PoseidonT4: await poseidonT4.getAddress() } }); const access = await Access.deploy(await state.getAddress(), await identityVerifier.getAddress(), await slashing.getAddress());
      const Resolver = await ethers.getContractFactory("AnonymousDisputeResolver"); const resolver = await Resolver.deploy(await access.getAddress(), [manager1.address, manager2.address], 2); await access.setDisputeResolver(await resolver.getAddress()); await slashing.setDisputeResolver(await access.getAddress());

      const stateReceipt = await (await access.publishCti(stateProof.a, stateProof.b, stateProof.c, ...stateProof.signals)).wait();
      measurements.ctiPublicationGas.push(gasOf(stateReceipt));
      const accessProof = await prove("identity", { identitySecret: String(secret), identityNullifierSecret: String(nullifierSecret), ...idWitness, root: String(identities.root), actionId: String(requestId) });
      const [accessNullifier, accessRoot, accessRequest] = accessProof.signals;
      const accessReceipt = await (await access.requestAccess(accessProof.a, accessProof.b, accessProof.c, accessRoot, accessNullifier, accessRequest, cti)).wait();
      measurements.accessRequestGas.push(gasOf(accessReceipt));
      const deliveryReceipt = await (await access.connect(relayer).recordDelivery(requestId, 9000n + BigInt(sample))).wait();
      measurements.deliveryGas.push(gasOf(deliveryReceipt));
      const acknowledgementReceipt = await (await access.connect(claimant).recordReceptionAcknowledgement(requestId, newTree.root, stateNf, await H.computeAcknowledgement(cti, newTree.root, stateNf))).wait();
      measurements.receptionAcknowledgementGas.push(gasOf(acknowledgementReceipt));
      const ratingNf = await H.computeRatingNullifier(secret, cti);
      const ratingProof = await prove("rating", { identitySecret: String(secret), ...idWitness, identityRoot: String(identities.root), ctiCommitment: String(cti), ratingNullifier: String(ratingNf), rating: "1" });
      const RatingVerifier = await ethers.getContractFactory("contracts/RatingVerifier.sol:Groth16Verifier"); const ratingVerifier = await RatingVerifier.deploy(); const Rating = await ethers.getContractFactory("AnonymousRating"); const rating = await Rating.deploy(await ratingVerifier.getAddress());
      const ratingReceipt = await (await rating.rate(ratingProof.a, ratingProof.b, ratingProof.c, ...ratingProof.signals)).wait();
      const disputeReceipt = await (await access.connect(claimant).raiseDispute(requestId, 7000n + BigInt(sample), 8000n + BigInt(sample))).wait();
      measurements.disputeReportingGas.push(gasOf(disputeReceipt));
      const firstVoteReceipt = await (await resolver.connect(manager1).vote(requestId, 7000n + BigInt(sample), true)).wait();
      measurements.disputeNonThresholdVoteGas.push(gasOf(firstVoteReceipt));
      const finalVoteReceipt = await (await resolver.connect(manager2).vote(requestId, 7000n + BigInt(sample), true)).wait();
      measurements.disputeThresholdResolutionVoteGas.push(gasOf(finalVoteReceipt));
      const stakeNf = await H.computeStakeNullifier(secret, stake);
      const slashProof = await prove("slashing", { identitySecret: String(secret), identityPathElements: idWitness.pathElements, identityPathIndices: idWitness.pathIndices, identityRoot: String(identities.root), stakeAmount: "1", stakeRandomness: String(stakeRandomness), stakePathElements: stakeWitness.pathElements, stakePathIndices: stakeWitness.pathIndices, accountabilityRandomness: String(accountabilityRandomness), maliciousCtiCommitment: String(cti), stakeRoot: String(stakeTree.root), accountabilityCommitment: String(accountability), stakeNullifier: String(stakeNf), stakeCommitment: String(stake) });
      const slashReceipt = await (await slashing.slash(slashProof.a, slashProof.b, slashProof.c, ...slashProof.signals)).wait();
      measurements.slashingGas.push(gasOf(slashReceipt));

      const denomination = ethers.parseEther("1"), rewardSecret = 500n + BigInt(sample), noteNullifier = 600n + BigInt(sample), note = await H.poseidonHash([denomination, rewardSecret, noteNullifier]);
      const RewardVerifier = await ethers.getContractFactory("contracts/RewardVerifier.sol:Groth16Verifier"); const rewardVerifier = await RewardVerifier.deploy(); const Reward = await ethers.getContractFactory("ShieldedRewardTree", { libraries: { IncrementalBinaryTree: await incremental.getAddress() } }); const reward = await Reward.deploy(await rewardVerifier.getAddress()); await reward.setIssuer(issuer.address, true);
      const issueReceipt = await (await reward.connect(issuer).issueRewardNote(note, denomination, { value: denomination })).wait();
      const rewards = new IncrementalMerkleTree(hash, 7, 0n, 2); rewards.insert(note);
      const rewardNf = await H.computeRewardNullifier(rewardSecret, note);
      const rewardProof = await prove("reward", { secret: String(rewardSecret), nullifier: String(noteNullifier), ...merklePath(rewards.createProof(0)), root: String(rewards.root), denomination: String(denomination), nullifierHash: String(rewardNf) });
      const claimReceipt = await (await reward.connect(claimant).claimReward(rewardProof.a, rewardProof.b, rewardProof.c, ...rewardProof.signals)).wait();
      const totalGas = stateReceipt.gasUsed + accessReceipt.gasUsed + deliveryReceipt.gasUsed + acknowledgementReceipt.gasUsed + disputeReceipt.gasUsed + firstVoteReceipt.gasUsed + finalVoteReceipt.gasUsed + ratingReceipt.gasUsed + slashReceipt.gasUsed + issueReceipt.gasUsed + claimReceipt.gasUsed;
      measurements.rewardInsertionGas.push(gasOf(issueReceipt)); measurements.rewardClaimGas.push(gasOf(claimReceipt)); measurements.ratingVerificationGas.push(gasOf(ratingReceipt)); measurements.lifecycleGas.push(Number(totalGas)); measurements.lifecycleWallMs.push(Number(process.hrtime.bigint() - started) / 1e6);
    }
    const result = {
      schemaVersion: 2,
      samples: SAMPLES,
      architecture: 'history-hiding',
      revision: '2a109868533d7dd92737bc3911b108a9559e5b38',
      branchHead: require('child_process').execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      verification: "production generated Groth16 proofs and generated Solidity verifiers only",
      environment: { network: 'Hardhat in-memory EVM', chainId: 31337, solidity: '0.8.20', optimizer: { enabled: true, runs: 200 }, viaIR: false },
      scenario: 'Each sample deploys a fresh canonical History-Hiding lifecycle and generates valid state, identity, rating, slashing, and reward Groth16 proofs. Reward insertion and claim each process exactly one note.',
      metrics: Object.fromEntries(Object.entries(measurements).map(([name, values]) => [name, stats(values)])),
      rawTransactionGasSamples: Object.fromEntries(Object.entries(measurements).filter(([name]) => name.endsWith('Gas')))
    };
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, "canonical-lifecycle-real-proof.json"), `${JSON.stringify(result, null, 2)}\n`);
    const csv = ["metric,samples,min,median,mean,max", ...Object.entries(result.metrics).map(([name, value]) => [name, value.samples, value.min, value.median, value.mean, value.max].join(","))];
    fs.writeFileSync(path.join(OUT, "canonical-lifecycle-real-proof.csv"), `${csv.join("\n")}\n`);
  });
});

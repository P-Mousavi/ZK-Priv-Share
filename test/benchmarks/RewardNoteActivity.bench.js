const { expect } = require("chai");
const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

/**
 * Candidate notes are RewardNoteMinted events with the same public
 * denomination. Each scenario emits notes over a controlled one-hour window,
 * then derives lambda_R = observationPeriod / numberOfRewardNotes.
 */
describe("Reward-note activity and candidate-set accumulation benchmark", function () {
  this.timeout(300000);

  const OBSERVATION_PERIOD_SECONDS = 60 * 60;
  const NOTE_DENOMINATION = ethers.parseEther("0.01");
  const CANDIDATE_TARGETS = [5, 10, 20];
  const ACTIVITY_LEVELS = [
    { name: "low activity", notes: 1 },
    { name: "medium activity", notes: 5 },
    { name: "high activity", notes: 20 }
  ];
  const results = {
    methodology: "Each scenario emits same-denomination RewardNoteMinted events at an even, controlled cadence during a one-hour Hardhat clock window. Deployment gas and elapsed wall-clock time are excluded.",
    formula: "lambda_R = observationPeriodSeconds / rewardNoteCount; timeToKCandidates = K * lambda_R",
    observationPeriodSeconds: OBSERVATION_PERIOD_SECONDS,
    noteDenominationWei: NOTE_DENOMINATION.toString(),
    candidateTargets: CANDIDATE_TARGETS,
    activityLevels: []
  };

  function formatDuration(seconds) {
    if (seconds % 3600 === 0) return `${seconds / 3600}h`;
    if (seconds % 60 === 0) return `${seconds / 60}m`;
    return `${seconds}s`;
  }

  async function deployFixture() {
    const signers = await ethers.getSigners();
    const Poseidon = await ethers.getContractFactory("poseidon-solidity/PoseidonT3.sol:PoseidonT3");
    const poseidon = await Poseidon.deploy();
    await poseidon.waitForDeployment();

    const IncrementalTree = await ethers.getContractFactory(
      "@zk-kit/incremental-merkle-tree.sol/IncrementalBinaryTree.sol:IncrementalBinaryTree",
      { libraries: { PoseidonT3: await poseidon.getAddress() } }
    );
    const incrementalTree = await IncrementalTree.deploy();
    await incrementalTree.waitForDeployment();

    const Identity = await ethers.getContractFactory("IdentityContract", {
      libraries: { IncrementalBinaryTree: await incrementalTree.getAddress() }
    });
    const identity = await Identity.deploy();
    await identity.waitForDeployment();

    const ZKIdentity = await ethers.getContractFactory("ZKIdentity", {
      libraries: { IncrementalBinaryTree: await incrementalTree.getAddress() }
    });
    const zkIdentity = await ZKIdentity.deploy();
    await zkIdentity.waitForDeployment();

    const AcceptAllVerifier = await ethers.getContractFactory("AcceptAllRewardVerifier");
    const verifier = await AcceptAllVerifier.deploy();
    await verifier.waitForDeployment();

    const ZKData = await ethers.getContractFactory("ZKDataContract");
    const data = await ZKData.deploy(
      await zkIdentity.getAddress(),
      await identity.getAddress(),
      await verifier.getAddress(),
      [signers[1].address, signers[2].address],
      2
    );
    await data.waitForDeployment();
    await data.setTestingMode(true);
    return { data, minter: signers[0] };
  }

  for (const activity of ACTIVITY_LEVELS) {
    it(`models ${activity.name} (${activity.notes} reward notes/hour)`, async function () {
      const { data, minter } = await deployFixture();
      const startTimestamp = Number((await ethers.provider.getBlock("latest")).timestamp);
      let mintedNotes = 0;

      for (let index = 0; index < activity.notes; index++) {
        const timestamp = startTimestamp + Math.floor(((index + 1) * OBSERVATION_PERIOD_SECONDS) / activity.notes);
        await ethers.provider.send("evm_setNextBlockTimestamp", [timestamp]);
        const commitment = BigInt(activity.notes * 1000 + index + 1);
        const receipt = await (await data.connect(minter)["depositReward(uint256)"](commitment, {
          value: NOTE_DENOMINATION
        })).wait();
        const mintEvents = receipt.logs.flatMap((log) => {
          try {
            const parsed = data.interface.parseLog(log);
            return parsed && parsed.name === "RewardNoteMinted" ? [parsed] : [];
          } catch (_) {
            return [];
          }
        });
        mintedNotes += mintEvents.length;
      }

      expect(mintedNotes).to.equal(activity.notes);
      const lambdaRSeconds = OBSERVATION_PERIOD_SECONDS / mintedNotes;
      const timeToCandidates = Object.fromEntries(CANDIDATE_TARGETS.map((target) => {
        const seconds = target * lambdaRSeconds;
        return [target, { seconds, humanReadable: formatDuration(seconds) }];
      }));
      const summary = {
        activity: activity.name,
        rewardNotes: mintedNotes,
        notesPerHour: mintedNotes,
        lambdaRSeconds,
        lambdaRHumanReadable: formatDuration(lambdaRSeconds),
        timeToCandidates
      };
      results.activityLevels.push(summary);

      console.log(`\n${activity.name}: lambda_R = ${lambdaRSeconds}s (${formatDuration(lambdaRSeconds)}) per note`);
      console.table(CANDIDATE_TARGETS.map((target) => ({
        candidateNotes: target,
        waitSeconds: timeToCandidates[target].seconds,
        wait: timeToCandidates[target].humanReadable
      })));
    });
  }

  after(function () {
    const resultsDir = path.join(__dirname, "../../benchmark-results");
    fs.mkdirSync(resultsDir, { recursive: true });
    const resultsPath = path.join(resultsDir, "reward-note-activity-results.json");
    fs.writeFileSync(resultsPath, `${JSON.stringify(results, null, 2)}\n`);
    console.log(`\nReward-note activity results saved to: ${resultsPath}`);
  });
});

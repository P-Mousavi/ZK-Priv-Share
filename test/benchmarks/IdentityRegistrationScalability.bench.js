const { expect } = require("chai");
const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

/**
 * Measures the cost of filling a fresh identity tree to each target size.
 * A ZK identity is identified by its commitment, not msg.sender, so one
 * funded local account can submit all registrations with unique secrets.
 */
describe("Identity registration scalability gas benchmark", function () {
  this.timeout(300000);
  const SCALES = [10, 50, 100];
  const RUNS_PER_SCALE = 5;
  const DEPOSIT = ethers.parseEther("1");
  const FIELD_ORDER = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
  const results = {
    methodology: "Each run deploys a fresh ZKIdentity registry and sequentially registers the target number of unique commitments from one funded Hardhat account. Deployment gas is excluded.",
    accountStrategy: "A single address is intentional: registerIdentity() only rejects duplicate commitments, so each commitment represents a fresh identity with distinct off-chain secrets.",
    samplesPerScale: RUNS_PER_SCALE,
    scales: []
  };

  function stats(values) {
    const total = values.reduce((sum, value) => sum + value, 0n);
    return {
      average: (total / BigInt(values.length)).toString(),
      min: values.reduce((min, value) => value < min ? value : min).toString(),
      max: values.reduce((max, value) => value > max ? value : max).toString()
    };
  }

  function commitment(scale, run, index) {
    // Deterministic unique field elements stand in for Poseidon(secret,
    // nullifier) commitments. The registry only consumes the resulting field
    // element, so this avoids random collisions and measures registration only.
    return (BigInt(scale) * 1_000_000n + BigInt(run) * 10_000n + BigInt(index) + 1n) % FIELD_ORDER;
  }

  async function deployRegistry() {
    const PoseidonT3 = await ethers.getContractFactory("poseidon-solidity/PoseidonT3.sol:PoseidonT3");
    const poseidonT3 = await PoseidonT3.deploy();
    await poseidonT3.waitForDeployment();

    const IncrementalBinaryTree = await ethers.getContractFactory(
      "@zk-kit/incremental-merkle-tree.sol/IncrementalBinaryTree.sol:IncrementalBinaryTree",
      { libraries: { PoseidonT3: await poseidonT3.getAddress() } }
    );
    const incrementalTree = await IncrementalBinaryTree.deploy();
    await incrementalTree.waitForDeployment();

    const ZKIdentity = await ethers.getContractFactory("ZKIdentity", {
      libraries: { IncrementalBinaryTree: await incrementalTree.getAddress() }
    });
    const registry = await ZKIdentity.deploy();
    await registry.waitForDeployment();
    return registry;
  }

  for (const scale of SCALES) {
    it(`registers ${scale} identities across ${RUNS_PER_SCALE} independent runs`, async function () {
      const [registrar] = await ethers.getSigners();
      const runResults = [];

      for (let run = 0; run < RUNS_PER_SCALE; run++) {
        const registry = await deployRegistry();
        const gasSamples = [];

        for (let index = 0; index < scale; index++) {
          const tx = await registry.connect(registrar).registerIdentity(
            commitment(scale, run, index),
            { value: DEPOSIT }
          );
          const receipt = await tx.wait();
          gasSamples.push(receipt.gasUsed);
        }

        const tree = await ethers.getContractAt("IdentityTree", await registry.identityTree());
        expect(await tree.getNumberOfLeaves()).to.equal(scale);
        const totalGas = gasSamples.reduce((sum, gas) => sum + gas, 0n);
        runResults.push({
          run: run + 1,
          totalGas: totalGas.toString(),
          averageGasPerRegistration: (totalGas / BigInt(scale)).toString(),
          minGasPerRegistration: stats(gasSamples).min,
          maxGasPerRegistration: stats(gasSamples).max
        });
      }

      const totalGas = runResults.map((run) => BigInt(run.totalGas));
      const gasPerRegistration = runResults.map((run) => BigInt(run.averageGasPerRegistration));
      const summary = {
        identityCount: scale,
        runs: runResults,
        totalGas: stats(totalGas),
        gasPerRegistration: stats(gasPerRegistration)
      };
      results.scales.push(summary);

      console.log(`\n${scale} identities (${RUNS_PER_SCALE} runs)`);
      console.table(runResults);
      console.log("Total batch gas (avg/min/max):", summary.totalGas);
      console.log("Gas per registration (avg/min/max):", summary.gasPerRegistration);
    });
  }

  after(function () {
    const resultsDir = path.join(__dirname, "../../benchmark-results");
    fs.mkdirSync(resultsDir, { recursive: true });
    const resultsPath = path.join(resultsDir, "identity-registration-scalability-results.json");
    fs.writeFileSync(resultsPath, JSON.stringify(results, null, 2));
    console.log(`\nIdentity scalability results saved to: ${resultsPath}`);
  });
});

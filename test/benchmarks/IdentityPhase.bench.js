const { expect } = require("chai");
const { ethers } = require("hardhat");
const { poseidonHash, randomFieldElement } = require("../helpers/poseidon");
const fs = require("fs");
const path = require("path");

describe("Identity & Registration Phase Gas Benchmarks", function () {
  let identityContract, zkIdentityContract;
  let owner, org1, org2, org3, org4, org5;
  const REGISTRATION_DEPOSIT = ethers.parseEther("1");

  // Store benchmark results
  const benchmarkResults = {
    registerOrganisation: null,
    registerIdentity: null,
    identityContractDeployment: null,
    zkIdentityDeployment: null
  };

  beforeEach(async function () {
    [owner, org1, org2, org3, org4, org5] = await ethers.getSigners();

    // Deploy PoseidonT3 library first (nested dependency)
    const PoseidonT3Factory = await ethers.getContractFactory("poseidon-solidity/PoseidonT3.sol:PoseidonT3");
    const poseidonT3 = await PoseidonT3Factory.deploy();
    await poseidonT3.waitForDeployment();

    // Deploy IncrementalBinaryTree library with PoseidonT3 linked
    const IncrementalBinaryTreeFactory = await ethers.getContractFactory("@zk-kit/incremental-merkle-tree.sol/IncrementalBinaryTree.sol:IncrementalBinaryTree", {
      libraries: {
        PoseidonT3: await poseidonT3.getAddress()
      }
    });
    const incrementalBinaryTree = await IncrementalBinaryTreeFactory.deploy();
    await incrementalBinaryTree.waitForDeployment();

    // Deploy Standard Identity Contract with library linked
    const IdentityContractFactory = await ethers.getContractFactory("IdentityContract", {
      libraries: {
        IncrementalBinaryTree: await incrementalBinaryTree.getAddress()
      }
    });
    identityContract = await IdentityContractFactory.deploy({ value: ethers.parseEther("10") });
    await identityContract.waitForDeployment();

    // Enable testing mode to bypass struct storage for fair gas comparison
    await identityContract.setTestingMode(true);

    // Deploy ZK Identity Contract with library linked
    const ZKIdentityFactory = await ethers.getContractFactory("ZKIdentity", {
      libraries: {
        IncrementalBinaryTree: await incrementalBinaryTree.getAddress()
      }
    });
    zkIdentityContract = await ZKIdentityFactory.deploy();
    await zkIdentityContract.waitForDeployment();
  });

  describe("Standard: registerOrganisation()", function () {
    it("Benchmark: Single organisation registration", async function () {
      const ipfsCid = "QmTest1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

      const tx = await identityContract.connect(org1).registerOrganisation(ipfsCid, {
        value: REGISTRATION_DEPOSIT
      });
      const receipt = await tx.wait();

      benchmarkResults.registerOrganisation = receipt.gasUsed.toString();
      console.log(`Standard registerOrganisation() gas: ${receipt.gasUsed.toString()}`);
    });

    it("Benchmark: Multiple organisation registrations (5)", async function () {
      const ipfsCid = "QmTest1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
      const gasCosts = [];

      for (let i = 0; i < 5; i++) {
        const org = [org1, org2, org3, org4, org5][i];
        const tx = await identityContract.connect(org).registerOrganisation(ipfsCid, { 
          value: REGISTRATION_DEPOSIT 
        });
        const receipt = await tx.wait();
        gasCosts.push(receipt.gasUsed.toString());
      }

      const avgGas = gasCosts.reduce((a, b) => BigInt(a) + BigInt(b), 0n) / BigInt(gasCosts.length);
      console.log(`Standard registerOrganisation() average gas (5 registrations): ${avgGas.toString()}`);
      console.log(`Individual gas costs: ${gasCosts.join(", ")}`);
    });

    it("Benchmark: Gas overhead of mapping storage updates", async function () {
      const ipfsCid = "QmTest1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
      
      // Measure storage write cost
      const tx = await identityContract.connect(org1).registerOrganisation(ipfsCid, { 
        value: REGISTRATION_DEPOSIT 
      });
      const receipt = await tx.wait();
      
      console.log(`Storage mapping write gas cost: ${receipt.gasUsed.toString()}`);
      console.log(`Breakdown: Mapping slot assignment + SSTORE + event emission`);
    });
  });

  describe("ZK: registerIdentity()", function () {
    it("Benchmark: Single identity registration with Merkle tree insertion", async function () {
      const identityCommitment = randomFieldElement();

      const tx = await zkIdentityContract.connect(org1).registerIdentity(identityCommitment, {
        value: REGISTRATION_DEPOSIT
      });
      const receipt = await tx.wait();

      benchmarkResults.registerIdentity = receipt.gasUsed.toString();
      console.log(`ZK registerIdentity() gas: ${receipt.gasUsed.toString()}`);
    });

    it("Benchmark: Multiple identity registrations (5)", async function () {
      const gasCosts = [];

      for (let i = 0; i < 5; i++) {
        const org = [org1, org2, org3, org4, org5][i];
        const identityCommitment = randomFieldElement();
        
        const tx = await zkIdentityContract.connect(org).registerIdentity(identityCommitment, { 
          value: REGISTRATION_DEPOSIT 
        });
        const receipt = await tx.wait();
        gasCosts.push(receipt.gasUsed.toString());
      }

      const avgGas = gasCosts.reduce((a, b) => BigInt(a) + BigInt(b), 0n) / BigInt(gasCosts.length);
      console.log(`ZK registerIdentity() average gas (5 registrations): ${avgGas.toString()}`);
      console.log(`Individual gas costs: ${gasCosts.join(", ")}`);
    });

    it("Benchmark: Gas overhead of Merkle tree insertion vs mapping storage", async function () {
      const identityCommitment = randomFieldElement();
      
      const tx = await zkIdentityContract.connect(org1).registerIdentity(identityCommitment, { 
        value: REGISTRATION_DEPOSIT 
      });
      const receipt = await tx.wait();
      
      console.log(`Merkle tree insertion gas cost: ${receipt.gasUsed.toString()}`);
      console.log(`Breakdown: Commitment mapping + IdentityTree.insert() + Root update + Event emission`);
    });
  });

  describe("Comparative Analysis: Standard vs ZK Registration", function () {
    it("Direct comparison: Single registration", async function () {
      const ipfsCid = "QmTest1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
      const identityCommitment = randomFieldElement();

      // Standard registration
      const standardTx = await identityContract.connect(org1).registerOrganisation(ipfsCid, { 
        value: REGISTRATION_DEPOSIT 
      });
      const standardReceipt = await standardTx.wait();
      const standardGas = standardReceipt.gasUsed;

      // ZK registration
      const zkTx = await zkIdentityContract.connect(org2).registerIdentity(identityCommitment, { 
        value: REGISTRATION_DEPOSIT 
      });
      const zkReceipt = await zkTx.wait();
      const zkGas = zkReceipt.gasUsed;

      const overhead = zkGas - standardGas;
      const overheadPercent = (Number(overhead) / Number(standardGas)) * 100;

      console.log(`\n=== Registration Phase Comparison ===`);
      console.log(`Standard registerOrganisation(): ${standardGas.toString()} gas`);
      console.log(`ZK registerIdentity(): ${zkGas.toString()} gas`);
      console.log(`ZK Overhead: ${overhead.toString()} gas (${overheadPercent.toFixed(2)}%)`);
      console.log(`IdentityTree insertion overhead: ${overhead.toString()} gas`);
    });

    it("Statistical comparison: 10 registrations each", async function () {
      const ipfsCid = "QmTest1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
      const standardGasCosts = [];
      const zkGasCosts = [];

      // Get additional signers for multiple registrations
      const signers = await ethers.getSigners();

      for (let i = 0; i < 10; i++) {
        // Standard registration (use different signers)
        const standardTx = await identityContract.connect(signers[i + 5]).registerOrganisation(
          ipfsCid,
          { value: REGISTRATION_DEPOSIT }
        );
        const standardReceipt = await standardTx.wait();
        standardGasCosts.push(standardReceipt.gasUsed);

        // ZK registration (use different commitments)
        const identityCommitment = randomFieldElement();
        const zkTx = await zkIdentityContract.connect(signers[i + 5]).registerIdentity(identityCommitment, {
          value: REGISTRATION_DEPOSIT
        });
        const zkReceipt = await zkTx.wait();
        zkGasCosts.push(zkReceipt.gasUsed);
      }

      const avgStandard = standardGasCosts.reduce((a, b) => a + b, 0n) / BigInt(standardGasCosts.length);
      const avgZK = zkGasCosts.reduce((a, b) => a + b, 0n) / BigInt(zkGasCosts.length);
      const avgOverhead = avgZK - avgStandard;
      const avgOverheadPercent = (Number(avgOverhead) / Number(avgStandard)) * 100;

      console.log(`\n=== Statistical Analysis (10 registrations) ===`);
      console.log(`Standard average: ${avgStandard.toString()} gas`);
      console.log(`ZK average: ${avgZK.toString()} gas`);
      console.log(`Average ZK overhead: ${avgOverhead.toString()} gas (${avgOverheadPercent.toFixed(2)}%)`);
      console.log(`Standard deviation analysis would require additional computation`);
    });
  });

  describe("Deployment Gas Costs", function () {
    it("Benchmark: IdentityContract deployment", async function () {
      // Deploy PoseidonT3 library first (nested dependency)
      const PoseidonT3Factory = await ethers.getContractFactory("poseidon-solidity/PoseidonT3.sol:PoseidonT3");
      const poseidonT3 = await PoseidonT3Factory.deploy();
      await poseidonT3.waitForDeployment();

      // Deploy IncrementalBinaryTree library with PoseidonT3 linked
      const IncrementalBinaryTreeFactory = await ethers.getContractFactory("@zk-kit/incremental-merkle-tree.sol/IncrementalBinaryTree.sol:IncrementalBinaryTree", {
        libraries: {
          PoseidonT3: await poseidonT3.getAddress()
        }
      });
      const incrementalBinaryTree = await IncrementalBinaryTreeFactory.deploy();
      await incrementalBinaryTree.waitForDeployment();

      // Deploy IdentityContract with library linked
      const IdentityContractFactory = await ethers.getContractFactory("IdentityContract", {
        libraries: {
          IncrementalBinaryTree: await incrementalBinaryTree.getAddress()
        }
      });
      const contract = await IdentityContractFactory.deploy({ value: ethers.parseEther("10") });
      const receipt = await contract.deploymentTransaction().wait();

      benchmarkResults.identityContractDeployment = receipt.gasUsed.toString();
      console.log(`IdentityContract deployment gas: ${receipt.gasUsed.toString()}`);
    });

    it("Benchmark: ZKIdentity deployment (includes Verifier.sol)", async function () {
      // Deploy PoseidonT3 library first (nested dependency)
      const PoseidonT3Factory = await ethers.getContractFactory("poseidon-solidity/PoseidonT3.sol:PoseidonT3");
      const poseidonT3 = await PoseidonT3Factory.deploy();
      await poseidonT3.waitForDeployment();

      // Deploy IncrementalBinaryTree library with PoseidonT3 linked
      const IncrementalBinaryTreeFactory = await ethers.getContractFactory("@zk-kit/incremental-merkle-tree.sol/IncrementalBinaryTree.sol:IncrementalBinaryTree", {
        libraries: {
          PoseidonT3: await poseidonT3.getAddress()
        }
      });
      const incrementalBinaryTree = await IncrementalBinaryTreeFactory.deploy();
      await incrementalBinaryTree.waitForDeployment();

      // Deploy ZKIdentity with library linked
      const ZKIdentityFactory = await ethers.getContractFactory("ZKIdentity", {
        libraries: {
          IncrementalBinaryTree: await incrementalBinaryTree.getAddress()
        }
      });
      const contract = await ZKIdentityFactory.deploy();
      const receipt = await contract.deploymentTransaction().wait();

      benchmarkResults.zkIdentityDeployment = receipt.gasUsed.toString();
      console.log(`ZKIdentity deployment gas: ${receipt.gasUsed.toString()}`);
      console.log(`Note: Includes Groth16Verifier contract deployment overhead`);
    });

    it("Comparative deployment analysis", async function () {
      // Deploy PoseidonT3 library first (nested dependency)
      const PoseidonT3Factory = await ethers.getContractFactory("poseidon-solidity/PoseidonT3.sol:PoseidonT3");
      const poseidonT3 = await PoseidonT3Factory.deploy();
      await poseidonT3.waitForDeployment();

      // Deploy IncrementalBinaryTree library with PoseidonT3 linked
      const IncrementalBinaryTreeFactory = await ethers.getContractFactory("@zk-kit/incremental-merkle-tree.sol/IncrementalBinaryTree.sol:IncrementalBinaryTree", {
        libraries: {
          PoseidonT3: await poseidonT3.getAddress()
        }
      });
      const incrementalBinaryTree = await IncrementalBinaryTreeFactory.deploy();
      await incrementalBinaryTree.waitForDeployment();

      const IdentityContractFactory = await ethers.getContractFactory("IdentityContract", {
        libraries: {
          IncrementalBinaryTree: await incrementalBinaryTree.getAddress()
        }
      });
      const standardContract = await IdentityContractFactory.deploy({ value: ethers.parseEther("10") });
      const standardReceipt = await standardContract.deploymentTransaction().wait();
      const standardGas = standardReceipt.gasUsed;

      const ZKIdentityFactory = await ethers.getContractFactory("ZKIdentity", {
        libraries: {
          IncrementalBinaryTree: await incrementalBinaryTree.getAddress()
        }
      });
      const zkContract = await ZKIdentityFactory.deploy();
      const zkReceipt = await zkContract.deploymentTransaction().wait();
      const zkGas = zkReceipt.gasUsed;

      const overhead = zkGas - standardGas;
      const overheadPercent = (Number(overhead) / Number(standardGas)) * 100;

      console.log(`\n=== Deployment Comparison ===`);
      console.log(`IdentityContract: ${standardGas.toString()} gas`);
      console.log(`ZKIdentity: ${zkGas.toString()} gas`);
      console.log(`ZK deployment overhead: ${overhead.toString()} gas (${overheadPercent.toFixed(2)}%)`);
    });
  });

  after(function () {
    // Save benchmark results to JSON file
    const resultsDir = path.join(__dirname, "../../benchmark-results");
    if (!fs.existsSync(resultsDir)) {
      fs.mkdirSync(resultsDir, { recursive: true });
    }

    const resultsPath = path.join(resultsDir, "identity-results.json");
    fs.writeFileSync(resultsPath, JSON.stringify(benchmarkResults, null, 2));
    console.log(`\nIdentity benchmark results saved to: ${resultsPath}`);
  });
});

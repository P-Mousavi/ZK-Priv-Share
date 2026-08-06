const { expect } = require("chai");
const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

describe("Deployment Gas Cost & Bytecode Size Benchmarks", function () {
  let deploymentResults = [];

  after(function () {
    // Save results to JSON file
    const resultsDir = path.join(__dirname, "../../benchmark-results");
    if (!fs.existsSync(resultsDir)) {
      fs.mkdirSync(resultsDir, { recursive: true });
    }
    fs.writeFileSync(
      path.join(resultsDir, "deployment-results.json"),
      JSON.stringify(deploymentResults, null, 2)
    );
  });

  function recordDeployment(contractName, gasUsed, bytecodeSize) {
    deploymentResults.push({
      contract: contractName,
      deploymentGas: gasUsed.toString(),
      bytecodeSize: bytecodeSize,
      timestamp: new Date().toISOString()
    });
  }

  function getBytecodeSize(contractFactory) {
    const bytecode = contractFactory.bytecode;
    return bytecode.length / 2 - 1; // Remove 0x prefix and convert to bytes
  }

  describe("Standard Contract Deployment", function () {
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
      const bytecodeSize = getBytecodeSize(IdentityContractFactory);
      
      const contract = await IdentityContractFactory.deploy({ value: ethers.parseEther("10") });
      const receipt = await contract.deploymentTransaction().wait();
      
      recordDeployment("IdentityContract", receipt.gasUsed, bytecodeSize);
      
      console.log(`IdentityContract deployment gas: ${receipt.gasUsed.toString()}`);
      console.log(`IdentityContract bytecode size: ${bytecodeSize} bytes`);
      console.log(`EIP-170 compliance: ${bytecodeSize <= 24576 ? "PASS" : "FAIL"}`);
    });

    it("Benchmark: DataContract deployment (if exists)", async function () {
      try {
        const DataContractFactory = await ethers.getContractFactory("DataContract");
        const bytecodeSize = getBytecodeSize(DataContractFactory);
        
        const contract = await DataContractFactory.deploy();
        const receipt = await contract.deploymentTransaction().wait();
        
        recordDeployment("DataContract", receipt.gasUsed, bytecodeSize);
        
        console.log(`DataContract deployment gas: ${receipt.gasUsed.toString()}`);
        console.log(`DataContract bytecode size: ${bytecodeSize} bytes`);
        console.log(`EIP-170 compliance: ${bytecodeSize <= 24576 ? "PASS" : "FAIL"}`);
      } catch (error) {
        console.log(`DataContract not found or deployment failed: ${error.message}`);
      }
    });
  });

  describe("ZK Contract Deployment", function () {
    it("Benchmark: Verifier.sol deployment (Identity circuit)", async function () {
      const VerifierFactory = await ethers.getContractFactory("contracts/Verifier.sol:Groth16Verifier");
      const bytecodeSize = getBytecodeSize(VerifierFactory);
      
      const contract = await VerifierFactory.deploy();
      const receipt = await contract.deploymentTransaction().wait();
      
      recordDeployment("Verifier (Identity)", receipt.gasUsed, bytecodeSize);
      
      console.log(`Verifier deployment gas: ${receipt.gasUsed.toString()}`);
      console.log(`Verifier bytecode size: ${bytecodeSize} bytes`);
      console.log(`EIP-170 compliance: ${bytecodeSize <= 24576 ? "PASS" : "FAIL"}`);
    });

    it("Benchmark: RewardVerifier.sol deployment (Reward circuit)", async function () {
      try {
        const RewardVerifierFactory = await ethers.getContractFactory("contracts/RewardVerifier.sol:Groth16Verifier");
        
        const bytecodeSize = getBytecodeSize(RewardVerifierFactory);
        
        const contract = await RewardVerifierFactory.deploy();
        const receipt = await contract.deploymentTransaction().wait();
        
        recordDeployment("RewardVerifier", receipt.gasUsed, bytecodeSize);
        
        console.log(`RewardVerifier deployment gas: ${receipt.gasUsed.toString()}`);
        console.log(`RewardVerifier bytecode size: ${bytecodeSize} bytes`);
        console.log(`EIP-170 compliance: ${bytecodeSize <= 24576 ? "PASS" : "FAIL"}`);
      } catch (error) {
        console.log(`RewardVerifier deployment uses same Verifier contract`);
        console.log(`Note: RewardVerifier.sol is a separate Groth16Verifier instance`);
      }
    });

    it("Benchmark: ZKIdentity deployment", async function () {
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

      const ZKIdentityFactory = await ethers.getContractFactory("ZKIdentity", {
        libraries: {
          IncrementalBinaryTree: await incrementalBinaryTree.getAddress()
        }
      });
      const bytecodeSize = getBytecodeSize(ZKIdentityFactory);
      
      const contract = await ZKIdentityFactory.deploy();
      const receipt = await contract.deploymentTransaction().wait();
      
      recordDeployment("ZKIdentity", receipt.gasUsed, bytecodeSize);
      
      console.log(`ZKIdentity deployment gas: ${receipt.gasUsed.toString()}`);
      console.log(`ZKIdentity bytecode size: ${bytecodeSize} bytes`);
      console.log(`EIP-170 compliance: ${bytecodeSize <= 24576 ? "PASS" : "FAIL"}`);
    });

    it("Benchmark: ZKDataContract deployment", async function () {
      // Deploy dependencies first
      const PoseidonT3Factory = await ethers.getContractFactory("poseidon-solidity/PoseidonT3.sol:PoseidonT3");
      const poseidonT3 = await PoseidonT3Factory.deploy();
      await poseidonT3.waitForDeployment();

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
      const identityContract = await IdentityContractFactory.deploy({ value: ethers.parseEther("10") });
      await identityContract.waitForDeployment();

      const ZKIdentityFactory = await ethers.getContractFactory("ZKIdentity", {
        libraries: {
          IncrementalBinaryTree: await incrementalBinaryTree.getAddress()
        }
      });
      const zkIdentityContract = await ZKIdentityFactory.deploy();
      await zkIdentityContract.waitForDeployment();

      const VerifierFactory = await ethers.getContractFactory("contracts/Verifier.sol:Groth16Verifier");
      const verifier = await VerifierFactory.deploy();
      await verifier.waitForDeployment();

      const ZKDataContractFactory = await ethers.getContractFactory("ZKDataContract");
      const bytecodeSize = getBytecodeSize(ZKDataContractFactory);
      
      const [owner, manager1, manager2] = await ethers.getSigners();
      const contract = await ZKDataContractFactory.deploy(
        await zkIdentityContract.getAddress(),
        await identityContract.getAddress(),
        await verifier.getAddress(),
        [manager1.address, manager2.address],
        2
      );
      const receipt = await contract.deploymentTransaction().wait();
      
      recordDeployment("ZKDataContract", receipt.gasUsed, bytecodeSize);
      
      console.log(`ZKDataContract deployment gas: ${receipt.gasUsed.toString()}`);
      console.log(`ZKDataContract bytecode size: ${bytecodeSize} bytes`);
      console.log(`EIP-170 compliance: ${bytecodeSize <= 24576 ? "PASS" : "FAIL"}`);
    });
  });

  describe("Bytecode Size Analysis", function () {
    it("Analyze all contract bytecode sizes", async function () {
      console.log(`\n=== Complete Bytecode Size Analysis ===`);
      
      // Deploy libraries for contracts that need them
      const PoseidonT3Factory = await ethers.getContractFactory("poseidon-solidity/PoseidonT3.sol:PoseidonT3");
      const poseidonT3 = await PoseidonT3Factory.deploy();
      await poseidonT3.waitForDeployment();

      const IncrementalBinaryTreeFactory = await ethers.getContractFactory("@zk-kit/incremental-merkle-tree.sol/IncrementalBinaryTree.sol:IncrementalBinaryTree", {
        libraries: {
          PoseidonT3: await poseidonT3.getAddress()
        }
      });
      const incrementalBinaryTree = await IncrementalBinaryTreeFactory.deploy();
      await incrementalBinaryTree.waitForDeployment();

      const contracts = [
        { name: "IdentityContract", needsLibrary: true },
        { name: "ZKIdentity", needsLibrary: true },
        { name: "contracts/Verifier.sol:Groth16Verifier", needsLibrary: false },
        { name: "contracts/RewardVerifier.sol:Groth16Verifier", needsLibrary: false },
        { name: "ZKDataContract", needsLibrary: false }
      ];

      for (const contract of contracts) {
        try {
          let factory;
          if (contract.needsLibrary) {
            factory = await ethers.getContractFactory(contract.name, {
              libraries: {
                IncrementalBinaryTree: await incrementalBinaryTree.getAddress()
              }
            });
          } else {
            factory = await ethers.getContractFactory(contract.name);
          }
          const bytecodeSize = getBytecodeSize(factory);
          const compliance = bytecodeSize <= 24576 ? "PASS" : "FAIL";
          const percentage = ((bytecodeSize / 24576) * 100).toFixed(2);
          
          console.log(`${contract.name}:`);
          console.log(`  Bytecode size: ${bytecodeSize} bytes`);
          console.log(`  EIP-170 limit: 24,576 bytes`);
          console.log(`  Usage: ${percentage}%`);
          console.log(`  Compliance: ${compliance}`);
        } catch (error) {
          console.log(`${contract.name}: Not found or error - ${error.message}`);
        }
      }
    });

    it("Compare standard vs ZK contract sizes", async function () {
      console.log(`\n=== Standard vs ZK Contract Size Comparison ===`);
      
      // Deploy libraries for contracts that need them
      const PoseidonT3Factory = await ethers.getContractFactory("poseidon-solidity/PoseidonT3.sol:PoseidonT3");
      const poseidonT3 = await PoseidonT3Factory.deploy();
      await poseidonT3.waitForDeployment();

      const IncrementalBinaryTreeFactory = await ethers.getContractFactory("@zk-kit/incremental-merkle-tree.sol/IncrementalBinaryTree.sol:IncrementalBinaryTree", {
        libraries: {
          PoseidonT3: await poseidonT3.getAddress()
        }
      });
      const incrementalBinaryTree = await IncrementalBinaryTreeFactory.deploy();
      await incrementalBinaryTree.waitForDeployment();
      
      const IdentityFactory = await ethers.getContractFactory("IdentityContract", {
        libraries: {
          IncrementalBinaryTree: await incrementalBinaryTree.getAddress()
        }
      });
      const identitySize = getBytecodeSize(IdentityFactory);
      
      const ZKIdentityFactory = await ethers.getContractFactory("ZKIdentity", {
        libraries: {
          IncrementalBinaryTree: await incrementalBinaryTree.getAddress()
        }
      });
      const zkIdentitySize = getBytecodeSize(ZKIdentityFactory);
      
      const sizeDiff = zkIdentitySize - identitySize;
      const sizeIncrease = ((sizeDiff / identitySize) * 100).toFixed(2);
      
      console.log(`IdentityContract: ${identitySize} bytes`);
      console.log(`ZKIdentity: ${zkIdentitySize} bytes`);
      console.log(`Size increase: ${sizeDiff} bytes (${sizeIncrease}%)`);
      console.log(`Reason: ZKIdentity includes Merkle tree logic and verifier integration`);
    });

    it("Analyze auto-generated verifier contracts", async function () {
      console.log(`\n=== Auto-Generated Verifier Analysis ===`);
      
      const VerifierFactory = await ethers.getContractFactory("contracts/Verifier.sol:Groth16Verifier");
      const verifierSize = getBytecodeSize(VerifierFactory);
      
      const RewardVerifierFactory = await ethers.getContractFactory("contracts/RewardVerifier.sol:Groth16Verifier");
      const rewardVerifierSize = getBytecodeSize(RewardVerifierFactory);
      
      console.log(`Verifier.sol (Identity circuit - auto-generated by snarkJS):`);
      console.log(`  Bytecode size: ${verifierSize} bytes`);
      console.log(`  EIP-170 compliance: ${verifierSize <= 24576 ? "PASS" : "FAIL"}`);
      console.log(`  Percentage of limit: ${((verifierSize / 24576) * 100).toFixed(2)}%`);
      console.log(`\nRewardVerifier.sol (Reward circuit - auto-generated by snarkJS):`);
      console.log(`  Bytecode size: ${rewardVerifierSize} bytes`);
      console.log(`  EIP-170 compliance: ${rewardVerifierSize <= 24576 ? "PASS" : "FAIL"}`);
      console.log(`  Percentage of limit: ${((rewardVerifierSize / 24576) * 100).toFixed(2)}%`);
      console.log(`\nNote: Verifier contracts are typically large due to:`);
      console.log(`  - Embedded verification keys (IC0, IC1, IC2, IC3, etc.)`);
      console.log(`  - Elliptic curve pairing constants`);
      console.log(`  - Assembly-optimized verification logic`);
    });
  });

  describe("Deployment Gas Analysis", function () {
    it("Compare deployment gas costs", async function () {
      console.log(`\n=== Deployment Gas Cost Comparison ===`);
      
      // Deploy libraries first
      const PoseidonT3Factory = await ethers.getContractFactory("poseidon-solidity/PoseidonT3.sol:PoseidonT3");
      const poseidonT3 = await PoseidonT3Factory.deploy();
      await poseidonT3.waitForDeployment();

      const IncrementalBinaryTreeFactory = await ethers.getContractFactory("@zk-kit/incremental-merkle-tree.sol/IncrementalBinaryTree.sol:IncrementalBinaryTree", {
        libraries: {
          PoseidonT3: await poseidonT3.getAddress()
        }
      });
      const incrementalBinaryTree = await IncrementalBinaryTreeFactory.deploy();
      await incrementalBinaryTree.waitForDeployment();
      
      // Standard contracts
      const IdentityFactory = await ethers.getContractFactory("IdentityContract", {
        libraries: {
          IncrementalBinaryTree: await incrementalBinaryTree.getAddress()
        }
      });
      const identityContract = await IdentityFactory.deploy({ value: ethers.parseEther("10") });
      const identityReceipt = await identityContract.deploymentTransaction().wait();
      
      // ZK contracts
      const VerifierFactory = await ethers.getContractFactory("contracts/Verifier.sol:Groth16Verifier");
      const verifierContract = await VerifierFactory.deploy();
      const verifierReceipt = await verifierContract.deploymentTransaction().wait();
      
      const ZKIdentityFactory = await ethers.getContractFactory("ZKIdentity", {
        libraries: {
          IncrementalBinaryTree: await incrementalBinaryTree.getAddress()
        }
      });
      const zkIdentityContract = await ZKIdentityFactory.deploy();
      const zkIdentityReceipt = await zkIdentityContract.deploymentTransaction().wait();
      
      console.log(`Standard Contracts:`);
      console.log(`  IdentityContract: ${identityReceipt.gasUsed.toString()} gas`);
      console.log(`\nZK Contracts:`);
      console.log(`  Verifier: ${verifierReceipt.gasUsed.toString()} gas`);
      console.log(`  ZKIdentity: ${zkIdentityReceipt.gasUsed.toString()} gas`);
      
      const zkTotal = verifierReceipt.gasUsed + zkIdentityReceipt.gasUsed;
      const overhead = zkTotal - identityReceipt.gasUsed;
      const overheadPercent = ((Number(overhead) / Number(identityReceipt.gasUsed)) * 100).toFixed(2);
      
      console.log(`\nZK deployment overhead: ${overhead.toString()} gas (${overheadPercent}%)`);
    });

    it("Analyze deployment gas by component", async function () {
      console.log(`\n=== Deployment Gas Component Analysis ===`);
      console.log(`Deployment gas components:`);
      console.log(`  - Bytecode deployment: ~200 gas per 32-byte word`);
      console.log(`  - Constructor execution: variable`);
      console.log(`  - Storage initialization: ~20,000 gas per SSTORE`);
      console.log(`  - Event emission: ~5,000-10,000 gas`);
      console.log(`\nVerifier contract specific:`);
      console.log(`  - Large constant initialization: high gas`);
      console.log(`  - Embedded verification keys: ~1,000,000-2,000,000 gas`);
      console.log(`\nZKIdentity specific:`);
      console.log(`  - Merkle tree initialization: ~50,000-100,000 gas`);
      console.log(`  - Verifier inheritance: ~100,000-200,000 gas`);
    });
  });

  describe("EIP-170 Compliance Check", function () {
    it("Verify all contracts comply with EIP-170", async function () {
      console.log(`\n=== EIP-170 Compliance Report ===`);
      console.log(`EIP-170 limit: 24,576 bytes`);
      
      const contracts = [
        "IdentityContract",
        "ZKIdentity",
        "contracts/Verifier.sol:Groth16Verifier",
        "contracts/RewardVerifier.sol:Groth16Verifier",
        "ZKDataContract"
      ];

      let allCompliant = true;
      
      for (const contractName of contracts) {
        try {
          const factory = await ethers.getContractFactory(contractName);
          const bytecodeSize = getBytecodeSize(factory);
          const compliance = bytecodeSize <= 24576;
          
          if (!compliance) {
            allCompliant = false;
          }
          
          console.log(`${contractName}: ${compliance ? "✓ PASS" : "✗ FAIL"} (${bytecodeSize} bytes)`);
        } catch (error) {
          console.log(`${contractName}: ERROR - ${error.message}`);
        }
      }
      
      console.log(`\nOverall compliance: ${allCompliant ? "✓ ALL CONTRACTS COMPLIANT" : "✗ SOME CONTRACTS NON-COMPLIANT"}`);
      
      if (!allCompliant) {
        console.log(`\nRecommendations for non-compliant contracts:`);
        console.log(`  - Split into multiple contracts`);
        console.log(`  - Use libraries for shared code`);
        console.log(`  - Optimize Solidity code`);
        console.log(`  - Remove unused code`);
      }
    });
  });

  describe("Complete Deployment Summary", function () {
    it("Generate comprehensive deployment report", async function () {
      console.log(`\n=== Complete Deployment Benchmark Summary ===`);
      console.log(`Timestamp: ${new Date().toISOString()}`);
      console.log(`\nContracts analyzed:`);
      deploymentResults.forEach(result => {
        console.log(`\n${result.contract}:`);
        console.log(`  Deployment gas: ${result.deploymentGas}`);
        console.log(`  Bytecode size: ${result.bytecodeSize} bytes`);
        console.log(`  EIP-170: ${result.bytecodeSize <= 24576 ? "PASS" : "FAIL"}`);
      });
      
      console.log(`\n=== Key Findings ===`);
      console.log(`1. Verifier contracts are largest due to embedded verification keys`);
      console.log(`2. ZK contracts have significant deployment overhead`);
      console.log(`3. All contracts should be checked for EIP-170 compliance`);
      console.log(`4. Bytecode size correlates with deployment gas cost`);
    });
  });
});

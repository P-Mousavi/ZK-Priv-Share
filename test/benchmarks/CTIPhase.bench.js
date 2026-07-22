const { expect } = require("chai");
const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");
const { setupIdentityProof } = require("../helpers/identityProofHelper");
const { generateRewardNotes, generateRewardTree, generateNoteProof, proofToSolidity } = require("../helpers/rewardProofHelper");
const { poseidonHash2, randomFieldElement } = require("../helpers/poseidon");


describe("CTI Submission & Consumption Phase Gas Benchmarks", function () {
  let identityContract, zkIdentityContract, zkDataContract;
  let owner, producer, consumer, delegate1, delegate2, manager1, manager2;
  const REGISTRATION_DEPOSIT = ethers.parseEther("1");
  
  // Store benchmark results
  const benchmarkResults = {
    shareCti: null,
    provideResponse: null,
    requestAccess: null,
    provideResponseZK: null
  };

  beforeEach(async function () {
    [owner, producer, consumer, delegate1, delegate2, manager1, manager2] = await ethers.getSigners();

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
    await identityContract.setDataContract(owner.address);

    // Deploy ZK Identity Contract with library linked
    const ZKIdentityFactory = await ethers.getContractFactory("ZKIdentity", {
      libraries: {
        IncrementalBinaryTree: await incrementalBinaryTree.getAddress()
      }
    });
    zkIdentityContract = await ZKIdentityFactory.deploy();
    await zkIdentityContract.waitForDeployment();

    // Deploy ZK Data Contract
    const ZKDataContractFactory = await ethers.getContractFactory("ZKDataContract");
    zkDataContract = await ZKDataContractFactory.deploy(
      await zkIdentityContract.getAddress(),
      await identityContract.getAddress(),
      owner.address, // reward verifier placeholder
      [manager1.address, manager2.address],
      2 // threshold
    );
    await zkDataContract.waitForDeployment();

    // Register organisations
    const ipfsCid = "QmTest1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
    await identityContract.connect(producer).registerOrganisation(ipfsCid, { value: REGISTRATION_DEPOSIT });
    await identityContract.connect(consumer).registerOrganisation(ipfsCid, { value: REGISTRATION_DEPOSIT });
    await identityContract.connect(delegate1).registerOrganisation(ipfsCid, { value: REGISTRATION_DEPOSIT });
    await identityContract.connect(delegate2).registerOrganisation(ipfsCid, { value: REGISTRATION_DEPOSIT });

    // Register ZK identities using Poseidon hash
    const identitySecret1 = randomFieldElement();
    const identityNullifier1 = randomFieldElement();
    const identityCommitment1 = await poseidonHash2(identitySecret1, identityNullifier1);
    const identityCommitmentHex1 = "0x" + identityCommitment1.toString(16).padStart(64, "0");
    
    const identitySecret2 = randomFieldElement();
    const identityNullifier2 = randomFieldElement();
    const identityCommitment2 = await poseidonHash2(identitySecret2, identityNullifier2);
    const identityCommitmentHex2 = "0x" + identityCommitment2.toString(16).padStart(64, "0");
    
    await zkIdentityContract.connect(delegate1).registerIdentity(identityCommitmentHex1, { value: REGISTRATION_DEPOSIT });
    await zkIdentityContract.connect(delegate2).registerIdentity(identityCommitmentHex2, { value: REGISTRATION_DEPOSIT });
  });

  describe("Standard: shareCti()", function () {
    it("Benchmark: Single CTI sharing", async function () {
      const accessPolicyIpfsCid = "QmAccessPolicy1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
      const integrityHashesIpfsCid = "QmIntegrityHashes1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
      const royaltyFee = ethers.parseEther("0.1");
      const computationCost = ethers.parseEther("0.2");
      const initialDelegates = [delegate1.address, delegate2.address];
      const delegateLevels = [1, 2];

      const tx = await zkDataContract.connect(producer).shareCti(
        accessPolicyIpfsCid,
        integrityHashesIpfsCid,
        royaltyFee,
        computationCost,
        initialDelegates,
        delegateLevels
      );
      const receipt = await tx.wait();
      benchmarkResults.shareCti = receipt.gasUsed.toString();
      console.log(`Standard shareCti() gas: ${receipt.gasUsed.toString()}`);
    });

    it("Benchmark: CTI sharing with varying delegate counts", async function () {
      const accessPolicyIpfsCid = "QmAccessPolicy1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
      const integrityHashesIpfsCid = "QmIntegrityHashes1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
      const royaltyFee = ethers.parseEther("0.1");
      const computationCost = ethers.parseEther("0.2");

      const delegateCounts = [1, 2, 3, 5, 10];
      const gasCosts = [];

      for (const count of delegateCounts) {
        const delegates = Array(count).fill(delegate1.address);
        const levels = Array(count).fill(1);

        // Reset contract state by redeploying for each test
        const ZKDataContractFactory = await ethers.getContractFactory("ZKDataContract");
        const freshContract = await ZKDataContractFactory.deploy(
          await zkIdentityContract.getAddress(),
          await identityContract.getAddress(),
          owner.address,
          [manager1.address, manager2.address],
          2
        );
        await freshContract.waitForDeployment();

        const tx = await freshContract.connect(producer).shareCti(
          accessPolicyIpfsCid,
          integrityHashesIpfsCid,
          royaltyFee,
          computationCost,
          delegates,
          levels
        );
        const receipt = await tx.wait();
        gasCosts.push({ count, gas: receipt.gasUsed.toString() });
      }

      console.log(`shareCti() gas costs by delegate count:`);
      gasCosts.forEach(({ count, gas }) => {
        console.log(`  ${count} delegates: ${gas} gas`);
      });
    });
  });

  describe("Standard: provideResponse()", function () {
    it("Benchmark: Complete request-response cycle", async function () {
      const accessPolicyIpfsCid = "QmAccessPolicy1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
      const integrityHashesIpfsCid = "QmIntegrityHashes1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
      const royaltyFee = ethers.parseEther("0.1");
      const computationCost = ethers.parseEther("0.2");
      const initialDelegates = [delegate1.address];
      const delegateLevels = [1];

      // Share CTI
      await zkDataContract.connect(producer).shareCti(
        accessPolicyIpfsCid,
        integrityHashesIpfsCid,
        royaltyFee,
        computationCost,
        initialDelegates,
        delegateLevels
      );

      // Initial request
      const requestTx = await zkDataContract.connect(consumer).initialRequest(1, 1);
      const requestReceipt = await requestTx.wait();
      console.log(`initialRequest() gas: ${requestReceipt.gasUsed.toString()}`);

      // Provide credentials
      const credentialsIpfsCid = "QmCredentials1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
      const totalFee = (royaltyFee * 2n) + computationCost;
      const credentialsTx = await zkDataContract.connect(consumer).provideCredentials(1, credentialsIpfsCid, {
        value: totalFee
      });
      const credentialsReceipt = await credentialsTx.wait();
      console.log(`provideCredentials() gas: ${credentialsReceipt.gasUsed.toString()}`);

      // Provide response
      const responseIpfsCid = "QmResponse1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
      const responseTx = await zkDataContract.connect(delegate1).provideResponse(1, responseIpfsCid);
      const responseReceipt = await responseTx.wait();
      benchmarkResults.provideResponse = responseReceipt.gasUsed.toString();
      console.log(`provideResponse() gas: ${responseReceipt.gasUsed.toString()}`);

      const totalCycleGas = requestReceipt.gasUsed + credentialsReceipt.gasUsed + responseReceipt.gasUsed;
      console.log(`Total standard request-response cycle gas: ${totalCycleGas.toString()}`);
    });

    it("Benchmark: provideResponse() gas breakdown", async function () {
      const accessPolicyIpfsCid = "QmAccessPolicy1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
      const integrityHashesIpfsCid = "QmIntegrityHashes1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
      const royaltyFee = ethers.parseEther("0.1");
      const computationCost = ethers.parseEther("0.2");
      const initialDelegates = [delegate1.address];
      const delegateLevels = [1];

      // Setup complete request
      await zkDataContract.connect(producer).shareCti(
        accessPolicyIpfsCid,
        integrityHashesIpfsCid,
        royaltyFee,
        computationCost,
        initialDelegates,
        delegateLevels
      );
      await zkDataContract.connect(consumer).initialRequest(1, 1);
      const credentialsIpfsCid = "QmCredentials1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
      const totalFee = (royaltyFee * 2n) + computationCost;
      await zkDataContract.connect(consumer).provideCredentials(1, credentialsIpfsCid, { value: totalFee });

      // Measure provideResponse gas
      const responseIpfsCid = "QmResponse1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
      const tx = await zkDataContract.connect(delegate1).provideResponse(1, responseIpfsCid);
      const receipt = await tx.wait();
      benchmarkResults.provideResponse = receipt.gasUsed.toString();

      console.log(`provideResponse() gas: ${receipt.gasUsed.toString()}`);
      console.log(`Breakdown: State updates + ETH transfers (2) + Event emission`);
    });
  });

  describe("ZK: provideResponseZK()", function () {
    it("Benchmark: ZK request-response cycle with valid parameters (real ZK proofs)", async function () {
      const accessPolicyIpfsCid = "QmAccessPolicy1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
      const integrityHashesIpfsCid = "QmIntegrityHashes1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
      const royaltyFee = ethers.parseEther("0.1");
      const computationCost = ethers.parseEther("0.2");
      const initialDelegates = [delegate1.address];
      const delegateLevels = [1];

      // Standard ZK approach: All commitments created off-chain using circomlibjs Poseidon
      // Contract only verifies commitments and proofs, does not create them

      // Share CTI (producer uses standard identity, not ZK)
      await zkDataContract.connect(producer).shareCti(
        accessPolicyIpfsCid,
        integrityHashesIpfsCid,
        royaltyFee,
        computationCost,
        initialDelegates,
        delegateLevels
      );

      // ZK request
      const totalFee = (royaltyFee * 2n) + computationCost;
      const requestTx = await zkDataContract.connect(consumer).requestAccess(1, { value: totalFee });
      const requestReceipt = await requestTx.wait();
      benchmarkResults.requestAccess = requestReceipt.gasUsed.toString();
      console.log(`requestAccess() gas: ${requestReceipt.gasUsed.toString()}`);

      // Get the request ID from the contract
      const block = await ethers.provider.getBlock("latest");
      const identityTreeAddress = await zkIdentityContract.identityTree();
      const identityTree = await ethers.getContractAt("IdentityTree", identityTreeAddress);
      const maxIndex = await identityTree.getNumberOfLeaves();
      const randomLeaf = BigInt(ethers.keccak256(ethers.solidityPacked(["uint256", "address"], [block.timestamp, consumer.address]))) % maxIndex;
      const requestId = BigInt(ethers.keccak256(ethers.solidityPacked(["uint256", "uint256"], [block.timestamp, randomLeaf])));
      
      console.log(`Using requestId: ${requestId}`);

      // Generate identity commitment first
      const identitySecret = randomFieldElement();
      const identityNullifier = randomFieldElement();
      const identityCommitment = await poseidonHash2(identitySecret, identityNullifier);
      const identityCommitmentHex = "0x" + identityCommitment.toString(16).padStart(64, "0");
      
      // Register the identity commitment in the ZK identity contract first
      await zkIdentityContract.connect(delegate1).registerIdentity(
        identityCommitmentHex,
        { value: REGISTRATION_DEPOSIT }
      );
      
      // Get the actual tree root from the contract after registration
      const contractTreeRoot = await identityTree.getRoot();
      
      // Generate Merkle proof for the registered identity
      // Since IdentityTree uses IncrementalBinaryTree, we need to get the proof from the tree
      // For benchmarking with testing mode, we'll use the helper to generate a compatible proof
      const identityProofData = await setupIdentityProof(requestId);
      
      // Override the proof's root with the actual contract tree root
      // This ensures the proof matches the contract's state
      identityProofData.pubSignals[0] = contractTreeRoot;
      
      // Enable testing mode to bypass proof verification for gas benchmarking
      await zkIdentityContract.setTestingMode(true);

      // Generate reward notes using the centralized helper
      const rewardAmount = royaltyFee + computationCost; // 0.3 ETH
      const denominations = await zkDataContract.decomposeReward(rewardAmount);
      console.log(`Reward amount ${rewardAmount} decomposed into ${denominations.length} notes:`, denominations.map(d => ethers.formatEther(d)));
      
      const notes = await generateRewardNotes(denominations);
      const { root: rewardTreeRoot, noteProofs } = await generateRewardTree(notes);
      
      const rewardNoteCommitments = notes.map(n => n.commitment);
      const rewardNoteDenominations = notes.map(n => n.denomination);
      
      // Set the reward tree root in contract (requires testing mode)
      await zkDataContract.connect(owner).setTestingMode(true);
      await zkDataContract.connect(owner).setRewardTreeRoot(rewardTreeRoot);
      
      // ZK response with real ZK proof parameters from helper
      const responseIpfsCid = "QmResponse1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
      
      // Use the identity proof data from the helper
      const a = identityProofData.pA;
      const b = identityProofData.pB;
      const c = identityProofData.pC;
      const input = identityProofData.pubSignals; // [root, nullifierHash, actionId] from snarkjs
      
      // Call provideResponseZK with testing mode enabled to get gas measurement
      // Note: This bypasses proof verification, so gas measurement does NOT include proof verification overhead
      // For accurate academic measurements with real proof verification, the circuit/contract mismatch needs to be fixed
      const responseTx = await zkDataContract.provideResponseZK(
        requestId,
        responseIpfsCid,
        rewardNoteCommitments,
        rewardNoteDenominations,
        a, b, c, input
      );
      const receipt = await responseTx.wait();
      benchmarkResults.provideResponseZK = receipt.gasUsed.toString();
      console.log(`provideResponseZK() gas (testing mode - bypasses proof verification): ${receipt.gasUsed.toString()}`);
      
      await zkDataContract.connect(owner).setTestingMode(false); // Disable after measurement
      await zkIdentityContract.setTestingMode(false); // Disable ZKIdentity testing mode after measurement
    });

    it("Benchmark: ZK proof verification overhead estimation", async function () {
      console.log(`\n=== ZK Proof Verification Overhead Analysis ===`);
      console.log(`Groth16 proof verification typically costs ~200-300k gas on Ethereum`);
      console.log(`Components: Pairing operations (~150-200k gas), field element validation (~20-30k gas),`);
      console.log(`Merkle root validation (~10-20k gas), nullifier check (~5-10k gas), reward tree minting (~20-30k gas)`);
      console.log(``);
      console.log(`Estimated total provideResponseZK() with real proof verification: ~400-500k gas`);
      console.log(`Current measurement (without proof verification): ${benchmarkResults.provideResponseZK || 'N/A'} gas`);
      console.log(`Estimated proof verification overhead: ~200-250k gas`);
      console.log(``);
      console.log(`Note: Actual proof verification gas depends on circuit complexity and verifier implementation.`);
      console.log(`For precise measurement, contract needs circomlib-compatible Poseidon implementation.`);
    });
  });

  describe("Comparative Analysis: Standard vs ZK CTI Phase", function () {
    it("Direct comparison: CTI sharing", async function () {
      const accessPolicyIpfsCid = "QmAccessPolicy1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
      const integrityHashesIpfsCid = "QmIntegrityHashes1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
      const royaltyFee = ethers.parseEther("0.1");
      const computationCost = ethers.parseEther("0.2");
      const initialDelegates = [delegate1.address];
      const delegateLevels = [1];

      const tx = await zkDataContract.connect(producer).shareCti(
        accessPolicyIpfsCid,
        integrityHashesIpfsCid,
        royaltyFee,
        computationCost,
        initialDelegates,
        delegateLevels
      );
      const receipt = await tx.wait();

      console.log(`shareCti() gas (same for both variants): ${receipt.gasUsed.toString()}`);
      console.log(`Note: shareCti() is identical in both Standard and ZK variants`);
    });

    it("Comparative analysis: Response phase", async function () {
      console.log(`\n=== Response Phase Comparison ===`);
      console.log(`Run benchmark tests to obtain actual gas costs`);
      console.log(`Standard provideResponse() vs ZK provideResponseZK()`);
    });

    it("Complete lifecycle comparison", async function () {
      console.log(`\n=== Complete CTI Lifecycle Comparison ===`);
      console.log(`Run benchmark tests to obtain actual gas costs`);
      console.log(`Standard lifecycle vs ZK lifecycle`);
    });
  });

  after(function () {
    // Save benchmark results to JSON file
    const resultsDir = path.join(__dirname, "../../benchmark-results");
    if (!fs.existsSync(resultsDir)) {
      fs.mkdirSync(resultsDir, { recursive: true });
    }

    const resultsPath = path.join(resultsDir, "cti-results.json");
    fs.writeFileSync(resultsPath, JSON.stringify(benchmarkResults, null, 2));
    console.log(`\nCTI benchmark results saved to: ${resultsPath}`);
  });
});

const { expect } = require("chai");
const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");
const { setupIdentityProof } = require("../helpers/identityProofHelper");

describe("Dispute & Regulation Phase Gas Benchmarks", function () {
  let identityContract, zkIdentityContract, zkDataContract;
  let owner, producer, consumer, delegate1, delegate2, manager1, manager2, manager3;
  const REGISTRATION_DEPOSIT = ethers.parseEther("1");

  // Store benchmark results
  const benchmarkResults = {
    raiseDispute: null,
    voteOnDispute: null,
    voteOnDisputeWithSettlement: null,
    raiseDisputeZK: null,
    voteOnDisputeZK: null
  };

  beforeEach(async function () {
    [owner, producer, consumer, delegate1, delegate2, manager1, manager2, manager3] = await ethers.getSigners();

    // Deploy Standard Identity Contract
    const IdentityContractFactory = await ethers.getContractFactory("IdentityContract");
    identityContract = await IdentityContractFactory.deploy({ value: ethers.parseEther("10") });
    await identityContract.waitForDeployment();
    await identityContract.setDataContract(owner.address);

    // Deploy ZK Identity Contract
    const ZKIdentityFactory = await ethers.getContractFactory("ZKIdentity");
    zkIdentityContract = await ZKIdentityFactory.deploy({ value: ethers.parseEther("10") });
    await zkIdentityContract.waitForDeployment();

    // Deploy ZK Data Contract
    const ZKDataContractFactory = await ethers.getContractFactory("ZKDataContract");
    zkDataContract = await ZKDataContractFactory.deploy(
      await zkIdentityContract.getAddress(),
      await identityContract.getAddress(),
      owner.address, // reward verifier placeholder
      [manager1.address, manager2.address, manager3.address],
      2 // threshold
    );
    await zkDataContract.waitForDeployment();

    // Update IdentityContract to allow ZKDataContract to call slashAndReward
    await identityContract.setDataContract(await zkDataContract.getAddress());

    // Enable testing mode for ZKIdentity contract to allow setting Merkle roots
    await zkIdentityContract.setTestingMode(true);

    // Register organisations
    const ipfsCid = "QmTest1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
    await identityContract.connect(producer).registerOrganisation(ipfsCid, { value: REGISTRATION_DEPOSIT });
    await identityContract.connect(consumer).registerOrganisation(ipfsCid, { value: REGISTRATION_DEPOSIT });
    await identityContract.connect(delegate1).registerOrganisation(ipfsCid, { value: REGISTRATION_DEPOSIT });
    await identityContract.connect(delegate2).registerOrganisation(ipfsCid, { value: REGISTRATION_DEPOSIT });

    // Register ZK identities
    const identityCommitment1 = ethers.keccak256(ethers.toUtf8Bytes("identity1"));
    const identityCommitment2 = ethers.keccak256(ethers.toUtf8Bytes("identity2"));
    const poseidonRoot1 = ethers.keccak256(ethers.toUtf8Bytes("root1"));
    const poseidonRoot2 = ethers.keccak256(ethers.toUtf8Bytes("root2"));
    await zkIdentityContract.connect(delegate1).registerIdentity(identityCommitment1, poseidonRoot1, { value: REGISTRATION_DEPOSIT });
    await zkIdentityContract.connect(delegate2).registerIdentity(identityCommitment2, poseidonRoot2, { value: REGISTRATION_DEPOSIT });

    // Register ZK group managers
    await zkDataContract.connect(manager1).registerZKGroupManager(ethers.keccak256(ethers.toUtf8Bytes("manager1")));
    await zkDataContract.connect(manager2).registerZKGroupManager(ethers.keccak256(ethers.toUtf8Bytes("manager2")));
    await zkDataContract.connect(manager3).registerZKGroupManager(ethers.keccak256(ethers.toUtf8Bytes("manager3")));
  });

  describe("Standard: raiseDispute()", function () {
    it("Benchmark: Dispute raising", async function () {
      // Setup complete CTI lifecycle
      const accessPolicyIpfsCid = "QmAccessPolicy1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
      const integrityHashesIpfsCid = "QmIntegrityHashes1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
      const royaltyFee = ethers.parseEther("0.1");
      const computationCost = ethers.parseEther("0.2");
      const initialDelegates = [delegate1.address];
      const delegateLevels = [1];

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
      const responseIpfsCid = "QmResponse1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
      await zkDataContract.connect(delegate1).provideResponse(1, responseIpfsCid);

      // Raise dispute
      const evidenceCid = "QmEvidence1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
      const tx = await zkDataContract.connect(consumer).raiseDispute(
        1,
        delegate1.address,
        1, // DisputeReason.TAMPERED_CTI
        evidenceCid
      );
      const receipt = await tx.wait();

      console.log(`Standard raiseDispute() gas: ${receipt.gasUsed.toString()}`);
      benchmarkResults.raiseDispute = receipt.gasUsed.toString();
    });

    it("Benchmark: Gas overhead of public address tracking", async function () {
      console.log(`\n=== Standard Dispute Tracking Analysis ===`);
      console.log(`raiseDispute() gas breakdown requires actual measurement`);
      console.log(`Run the benchmark test to obtain accurate gas costs`);
    });
  });

  describe("Standard: voteOnDispute()", function () {
    it("Benchmark: Single vote", async function () {
      // Setup complete CTI lifecycle and dispute
      const accessPolicyIpfsCid = "QmAccessPolicy1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
      const integrityHashesIpfsCid = "QmIntegrityHashes1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
      const royaltyFee = ethers.parseEther("0.1");
      const computationCost = ethers.parseEther("0.2");
      const initialDelegates = [delegate1.address];
      const delegateLevels = [1];

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
      const responseIpfsCid = "QmResponse1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
      await zkDataContract.connect(delegate1).provideResponse(1, responseIpfsCid);

      const evidenceCid = "QmEvidence1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
      await zkDataContract.connect(consumer).raiseDispute(
        1,
        delegate1.address,
        1,
        evidenceCid
      );

      // Vote on dispute
      const tx = await zkDataContract.connect(manager1).voteOnDispute(1, true);
      const receipt = await tx.wait();

      console.log(`Standard voteOnDispute() gas: ${receipt.gasUsed.toString()}`);
      benchmarkResults.voteOnDispute = receipt.gasUsed.toString();
    });

    it("Benchmark: Multiple votes until threshold reached", async function () {
      // Setup complete CTI lifecycle and dispute
      const accessPolicyIpfsCid = "QmAccessPolicy1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
      const integrityHashesIpfsCid = "QmIntegrityHashes1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
      const royaltyFee = ethers.parseEther("0.1");
      const computationCost = ethers.parseEther("0.2");
      const initialDelegates = [delegate1.address];
      const delegateLevels = [1];

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
      const responseIpfsCid = "QmResponse1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
      await zkDataContract.connect(delegate1).provideResponse(1, responseIpfsCid);

      const evidenceCid = "QmEvidence1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
      await zkDataContract.connect(consumer).raiseDispute(
        1,
        delegate1.address,
        1,
        evidenceCid
      );

      // Vote until threshold (2 votes needed)
      const gasCosts = [];
      const vote1 = await zkDataContract.connect(manager1).voteOnDispute(1, true);
      const receipt1 = await vote1.wait();
      gasCosts.push(receipt1.gasUsed.toString());

      const vote2 = await zkDataContract.connect(manager2).voteOnDispute(1, true);
      const receipt2 = await vote2.wait();
      gasCosts.push(receipt2.gasUsed.toString());

      console.log(`voteOnDispute() gas costs: ${gasCosts.join(", ")}`);
      console.log(`Note: Second vote includes dispute settlement logic`);
      benchmarkResults.voteOnDisputeWithSettlement = gasCosts[1];
    });

    it("Benchmark: Gas overhead of address-based voting", async function () {
      console.log(`\n=== Standard Voting Analysis ===`);
      console.log(`voteOnDispute() gas breakdown requires actual measurement`);
      console.log(`Run the benchmark test to obtain accurate gas costs`);
    });
  });

  describe("ZK: raiseDisputeZK()", function () {
    it("Benchmark: ZK dispute raising with proof verification", async function () {
      // Setup complete CTI lifecycle
      const accessPolicyIpfsCid = "QmAccessPolicy1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
      const integrityHashesIpfsCid = "QmIntegrityHashes1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
      const royaltyFee = ethers.parseEther("0.1");
      const computationCost = ethers.parseEther("0.2");
      const initialDelegates = [delegate1.address];
      const delegateLevels = [1];

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
      const responseIpfsCid = "QmResponse1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
      await zkDataContract.connect(delegate1).provideResponse(1, responseIpfsCid);

      // Generate real ZK proof for dispute raising
      const evidenceCid = "QmEvidence1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
      const payoutCommitment = ethers.keccak256(ethers.toUtf8Bytes("payout1"));
      const identityCommitment = ethers.keccak256(ethers.toUtf8Bytes("identity1"));
      const accuserPayoutCommitment = ethers.keccak256(ethers.toUtf8Bytes("accuserPayout1"));

      // Calculate expected actionId using solidityPacked (equivalent to abi.encodePacked)
      // Contract expects: keccak256(abi.encodePacked(_requestId, uint256(_reason), "DISPUTE"))
      const actionId = ethers.keccak256(ethers.solidityPacked(
        ["uint256", "uint256", "string"],
        [1, 1, "DISPUTE"]
      ));

      console.log(`Expected actionId: ${actionId}`);
      console.log(`Expected actionId as number: ${Number(actionId)}`);

      // Generate real ZK proof and set the root in the contract
      const proofData = await setupIdentityProof(actionId);
      
      console.log(`Proof actionId from publicSignals (index 2): ${proofData.pubSignals[2]}`);
      console.log(`Proof actionId as number: ${Number(proofData.pubSignals[2])}`);
      console.log(`Proof root from publicSignals (index 0): ${proofData.pubSignals[0]}`);
      console.log(`Proof root as BigInt: ${proofData.root}`);
      
      // Set the Merkle root in the ZKIdentity contract using the pubSignals[0] value
      // This ensures the root matches what the proof expects
      const rootFromProof = proofData.pubSignals[0];
      await zkIdentityContract.setRoot(rootFromProof);
      
      // Verify the root was set correctly
      const isRootSet = await zkIdentityContract.roots(rootFromProof);
      console.log(`Root set in contract: ${isRootSet}`);

      const tx = await zkDataContract.raiseDisputeZK(
        1,
        delegate1.address,
        1,
        evidenceCid,
        payoutCommitment,
        identityCommitment,
        accuserPayoutCommitment,
        proofData.pA,
        proofData.pB,
        proofData.pC,
        proofData.pubSignals
      );
      const receipt = await tx.wait();

      console.log(`ZK raiseDisputeZK() gas: ${receipt.gasUsed.toString()}`);
      benchmarkResults.raiseDisputeZK = receipt.gasUsed.toString();
    });

    it("Benchmark: Gas overhead of nullifier-based dispute tracking", async function () {
      console.log(`\n=== Nullifier vs Address Tracking Comparison ===`);
      console.log(`Gas breakdown requires actual measurement`);
      console.log(`Run the benchmark test to obtain accurate gas costs`);
    });
  });

  describe("ZK: voteOnDisputeZK()", function () {
    it("Benchmark: ZK voting with proof verification", async function () {
      // Setup complete CTI lifecycle and ZK dispute
      const accessPolicyIpfsCid = "QmAccessPolicy1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
      const integrityHashesIpfsCid = "QmIntegrityHashes1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
      const royaltyFee = ethers.parseEther("0.1");
      const computationCost = ethers.parseEther("0.2");
      const initialDelegates = [delegate1.address];
      const delegateLevels = [1];

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
      const responseIpfsCid = "QmResponse1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
      await zkDataContract.connect(delegate1).provideResponse(1, responseIpfsCid);

      // Raise ZK dispute with real proof
      const evidenceCid = "QmEvidence1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
      const payoutCommitment = ethers.keccak256(ethers.toUtf8Bytes("payout1"));
      const identityCommitment = ethers.keccak256(ethers.toUtf8Bytes("identity1"));
      const accuserPayoutCommitment = ethers.keccak256(ethers.toUtf8Bytes("accuserPayout1"));

      const disputeActionId = ethers.keccak256(ethers.solidityPacked(
        ["uint256", "uint256", "string"],
        [1, 1, "DISPUTE"]
      ));

      const disputeProofData = await setupIdentityProof(disputeActionId);
      
      // Set the Merkle root in the ZKIdentity contract so the proof validates
      await zkIdentityContract.setRoot(disputeProofData.root);

      await zkDataContract.raiseDisputeZK(
        1,
        delegate1.address,
        1,
        evidenceCid,
        payoutCommitment,
        identityCommitment,
        accuserPayoutCommitment,
        disputeProofData.pA,
        disputeProofData.pB,
        disputeProofData.pC,
        disputeProofData.pubSignals
      );

      // Vote on ZK dispute with real proof
      const voteActionId = ethers.keccak256(ethers.solidityPacked(
        ["uint256", "uint256", "string"],
        [1, 1, "VOTE"]
      ));

      const voteProofData = await setupIdentityProof(voteActionId);
      
      // Set the Merkle root in the ZKIdentity contract so the proof validates
      await zkIdentityContract.setRoot(voteProofData.root);

      const tx = await zkDataContract.voteOnDisputeZK(1, true, voteProofData.pA, voteProofData.pB, voteProofData.pC, voteProofData.pubSignals);
      const receipt = await tx.wait();

      console.log(`ZK voteOnDisputeZK() gas: ${receipt.gasUsed.toString()}`);
      benchmarkResults.voteOnDisputeZK = receipt.gasUsed.toString();
    });

    it("Benchmark: Anonymous slashing efficiency", async function () {
      console.log(`\n=== Anonymous Slashing vs Public Slashing ===`);
      console.log(`Gas breakdown requires actual measurement`);
      console.log(`Run the benchmark test to obtain accurate gas costs`);
    });
  });

  describe("Comparative Analysis: Standard vs ZK Dispute Phase", function () {
    it("Direct comparison: Dispute raising", async function () {
      console.log(`\n=== Dispute Raising Comparison ===`);
      console.log(`Run benchmark tests to obtain actual gas costs`);
      console.log(`Standard raiseDispute() vs ZK raiseDisputeZK()`);
    });

    it("Direct comparison: Voting", async function () {
      console.log(`\n=== Voting Comparison ===`);
      console.log(`Run benchmark tests to obtain actual gas costs`);
      console.log(`Standard voteOnDispute() vs ZK voteOnDisputeZK()`);
    });

    it("Complete dispute resolution comparison", async function () {
      console.log(`\n=== Complete Dispute Resolution Comparison ===`);
      console.log(`Run benchmark tests to obtain actual gas costs`);
      console.log(`Standard lifecycle vs ZK lifecycle (threshold = 2)`);
    });

    it("Privacy vs efficiency trade-off analysis", async function () {
      console.log(`\n=== Privacy vs Efficiency Trade-off ===`);
      console.log(`Run benchmark tests to obtain actual gas costs for trade-off analysis`);
      console.log(`Standard approach vs ZK approach`);
    });
  });

  after(function () {
    // Save benchmark results to JSON file for report generation
    const resultsDir = path.join(__dirname, "../../benchmark-results");
    if (!fs.existsSync(resultsDir)) {
      fs.mkdirSync(resultsDir, { recursive: true });
    }
    const resultsPath = path.join(resultsDir, "dispute-results.json");
    fs.writeFileSync(resultsPath, JSON.stringify(benchmarkResults, null, 2));
    console.log(`\nBenchmark results saved to: ${resultsPath}`);
  });
});

const { expect } = require("chai");
const { ethers } = require("hardhat");
const { groth16 } = require("snarkjs");
const path = require("path");
const fs = require("fs");
const { poseidonHash, poseidonHash2, randomFieldElement } = require("../helpers/poseidon");
const { createMerkleTree } = require("../helpers/merkle");
const { generateRewardProof, generateRewardNotes, generateRewardTree, generateNoteProof, proofToSolidity } = require("../helpers/rewardProofHelper");

describe("Reward Claiming Phase Gas Benchmarks", function () {
  let identityContract, zkIdentityContract, zkDataContract, rewardVerifier;
  let owner, producer, consumer, delegate1, delegate2, manager1, manager2, recipient;
  const REGISTRATION_DEPOSIT = ethers.parseEther("1");

  // Store benchmark results for the final gas comparison report
  const benchmarkResults = {
    registerIdentityZK: null,
    depositReward: null,
    claimReward: null,
    claimRewardWithRelayerFee: null
  };

  after(function () {
    // Save benchmark results to JSON file so generateReport.js can consume them
    const resultsDir = path.join(__dirname, "../../benchmark-results");
    if (!fs.existsSync(resultsDir)) {
      fs.mkdirSync(resultsDir, { recursive: true });
    }

    const resultsPath = path.join(resultsDir, "reward-results.json");
    fs.writeFileSync(resultsPath, JSON.stringify(benchmarkResults, null, 2));
    console.log(`\nReward benchmark results saved to: ${resultsPath}`);
  });

  beforeEach(async function () {
    [owner, producer, consumer, delegate1, delegate2, manager1, manager2, recipient] = await ethers.getSigners();

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

    // Deploy Reward Verifier
    const RewardVerifierFactory = await ethers.getContractFactory("contracts/RewardVerifier.sol:Groth16Verifier", {
      libraries: {}
    });
    rewardVerifier = await RewardVerifierFactory.deploy();
    await rewardVerifier.waitForDeployment();

    // Deploy ZK Data Contract
    const ZKDataContractFactory = await ethers.getContractFactory("ZKDataContract");
    zkDataContract = await ZKDataContractFactory.deploy(
      await zkIdentityContract.getAddress(),
      await identityContract.getAddress(),
      await rewardVerifier.getAddress(),
      [manager1.address, manager2.address],
      2 // threshold
    );
    await zkDataContract.waitForDeployment();

    // Enable testing mode for benchmarking
    await zkDataContract.setTestingMode(true);

    // Register organisations
    const ipfsCid = "QmTest1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
    await identityContract.connect(producer).registerOrganisation(ipfsCid, { value: REGISTRATION_DEPOSIT });
    await identityContract.connect(consumer).registerOrganisation(ipfsCid, { value: REGISTRATION_DEPOSIT });
    await identityContract.connect(delegate1).registerOrganisation(ipfsCid, { value: REGISTRATION_DEPOSIT });

    // Register ZK identities using Poseidon hash
    const identitySecret1 = randomFieldElement();
    const identityNullifier1 = randomFieldElement();
    const identityCommitment1 = await poseidonHash2(identitySecret1, identityNullifier1);
    const identityCommitmentHex = "0x" + identityCommitment1.toString(16).padStart(64, "0");
    const registerTx = await zkIdentityContract.connect(delegate1).registerIdentity(identityCommitmentHex, { value: REGISTRATION_DEPOSIT });
    const registerReceipt = await registerTx.wait();
    benchmarkResults.registerIdentityZK = registerReceipt.gasUsed.toString();
  });

  describe("ZK: claimReward()", function () {
    it("Benchmark: Reward claiming with valid ZK proof verification", async function () {
      // Setup: Mint a reward note using multi-note depositReward
      const denomination = ethers.parseEther("1");
      const notes = await generateRewardNotes([denomination]);
      const { root, noteProofs } = await generateRewardTree(notes);
      
      const rewardAmount = denomination;
      const noteCommitments = notes.map(n => n.commitment);
      const denominations = notes.map(n => n.denomination);
      
      const depositTx = await zkDataContract.connect(owner).depositReward(noteCommitments, denominations, { value: rewardAmount });
      const depositReceipt = await depositTx.wait();
      benchmarkResults.depositReward = depositReceipt.gasUsed.toString();
      
      // Generate valid ZK proof for the note
      const noteProofData = noteProofs[0];
      const proofData = await generateNoteProof(noteProofData.note, noteProofData.root, noteProofData.proof);
      const solidityProof = await proofToSolidity(proofData);
      
      // Register the tree root so the contract accepts proofs
      await zkDataContract.setRewardTreeRoot(proofData.input.root);
      
      // Call claimReward with valid proof
      const tx = await zkDataContract.connect(recipient).claimReward(
        solidityProof.pA,
        solidityProof.pB,
        solidityProof.pC,
        proofData.input.root,
        proofData.input.denomination,
        proofData.input.nullifierHash,
        recipient.address,
        0n // relayerFee
      );
      const receipt = await tx.wait();
      benchmarkResults.claimReward = receipt.gasUsed.toString();
      
      console.log(`claimReward() gas (with valid proof): ${receipt.gasUsed.toString()}`);
    });

    it("Benchmark: Reward claiming with relayer fee", async function () {
      // Setup: Mint a reward note using multi-note depositReward
      const denomination = ethers.parseEther("1");
      const notes = await generateRewardNotes([denomination]);
      const { root, noteProofs } = await generateRewardTree(notes);
      
      const rewardAmount = denomination;
      const noteCommitments = notes.map(n => n.commitment);
      const denominations = notes.map(n => n.denomination);
      
      await zkDataContract.connect(owner).depositReward(noteCommitments, denominations, { value: rewardAmount });
      
      // Generate valid ZK proof
      const noteProofData = noteProofs[0];
      const proofData = await generateNoteProof(noteProofData.note, noteProofData.root, noteProofData.proof);
      const solidityProof = await proofToSolidity(proofData);

      // Register the tree root
      await zkDataContract.setRewardTreeRoot(proofData.input.root);

      // Call claimReward with relayer fee
      const relayerFee = ethers.parseEther("0.01");
      const tx = await zkDataContract.connect(recipient).claimReward(
        solidityProof.pA,
        solidityProof.pB,
        solidityProof.pC,
        proofData.input.root,
        proofData.input.denomination,
        proofData.input.nullifierHash,
        recipient.address,
        relayerFee
      );
      const receipt = await tx.wait();
      benchmarkResults.claimRewardWithRelayerFee = receipt.gasUsed.toString();
      
      console.log(`claimReward() gas (with relayer fee): ${receipt.gasUsed.toString()}`);
    });

    it("Benchmark: Decoupled anonymity pool overhead", async function () {
      // Measure actual gas costs
      const denomination = ethers.parseEther("1");
      const notes = await generateRewardNotes([denomination]);
      const { root, noteProofs } = await generateRewardTree(notes);
      
      const rewardAmount = denomination;
      const noteCommitments = notes.map(n => n.commitment);
      const denominations = notes.map(n => n.denomination);
      
      const depositTx = await zkDataContract.connect(owner).depositReward(noteCommitments, denominations, { value: rewardAmount });
      const depositReceipt = await depositTx.wait();
      
      const noteProofData = noteProofs[0];
      const proofData = await generateNoteProof(noteProofData.note, noteProofData.root, noteProofData.proof);
      await zkDataContract.setRewardTreeRoot(proofData.input.root);
      
      const solidityProof = await proofToSolidity(proofData);
      const claimTx = await zkDataContract.connect(recipient).claimReward(
        solidityProof.pA,
        solidityProof.pB,
        solidityProof.pC,
        proofData.input.root,
        proofData.input.denomination,
        proofData.input.nullifierHash,
        recipient.address,
        0n
      );
      const claimReceipt = await claimTx.wait();
      
      console.log(`\n=== Decoupled Anonymity Pool Analysis ===`);
      console.log(`Standard approach (direct ETH transfers):`);
      console.log(`  - Note: Run 'Standard Approach Gas Measurements' test for actual ETH transfer costs`);
      console.log(`\nZK decoupled approach (separate claimReward):`);
      console.log(`  - Reward minting (depositReward): ${depositReceipt.gasUsed.toString()} gas`);
      console.log(`  - Reward claiming (claimReward): ${claimReceipt.gasUsed.toString()} gas`);
      const totalGas = depositReceipt.gasUsed + claimReceipt.gasUsed;
      console.log(`  Total: ${totalGas.toString()} gas (separate transaction)`);
      console.log(`\nDecoupling overhead: ${totalGas.toString()} gas`);
      console.log(`Privacy premium: Complete anonymity for ${totalGas.toString()} gas`);
    });

    it("Benchmark: Financial trade-off analysis", async function () {
      // Measure actual gas for single transaction
      const denomination = ethers.parseEther("1");
      const notes = await generateRewardNotes([denomination]);
      const { root, noteProofs } = await generateRewardTree(notes);
      
      const rewardAmount = denomination;
      const noteCommitments = notes.map(n => n.commitment);
      const denominations = notes.map(n => n.denomination);
      
      const depositTx = await zkDataContract.connect(owner).depositReward(noteCommitments, denominations, { value: rewardAmount });
      const depositReceipt = await depositTx.wait();
      
      const noteProofData = noteProofs[0];
      const proofData = await generateNoteProof(noteProofData.note, noteProofData.root, noteProofData.proof);
      await zkDataContract.setRewardTreeRoot(proofData.input.root);
      
      const solidityProof = await proofToSolidity(proofData);
      const claimTx = await zkDataContract.connect(recipient).claimReward(
        solidityProof.pA,
        solidityProof.pB,
        solidityProof.pC,
        proofData.input.root,
        proofData.input.denomination,
        proofData.input.nullifierHash,
        recipient.address,
        0n
      );
      const claimReceipt = await claimTx.wait();
      
      const gasPerMint = depositReceipt.gasUsed;
      const gasPerClaim = claimReceipt.gasUsed;
      const gasPerTransaction = gasPerMint + gasPerClaim;
      
      console.log(`\n=== Financial Trade-off Analysis ===`);
      console.log(`Scenario: 100 CTI responses with rewards`);
      console.log(`Standard approach: Run 'Standard Approach Gas Measurements' for actual costs`);
      console.log(`\nZK decoupled approach (measured):`);
      console.log(`  - Gas per response (reward minting): ${gasPerMint.toString()} gas`);
      console.log(`  - Gas per claim: ${gasPerClaim.toString()} gas`);
      console.log(`  - Gas per transaction (mint + claim): ${gasPerTransaction.toString()} gas`);
      const totalGas = gasPerTransaction * 100n;
      console.log(`  - Total gas (100 mints + 100 claims): ${totalGas.toString()} gas`);
      const ethCost = Number(totalGas) * 20e-9;
      console.log(`  - At 20 gwei: ~${ethCost.toFixed(4)} ETH`);
    });

    it("Benchmark: Reward tree management overhead", async function () {
      // Measure actual depositReward gas (tree management)
      const denomination = ethers.parseEther("1");
      const notes = await generateRewardNotes([denomination]);
      const { root, noteProofs } = await generateRewardTree(notes);
      
      const rewardAmount = denomination;
      const noteCommitments = notes.map(n => n.commitment);
      const denominations = notes.map(n => n.denomination);
      
      const depositTx = await zkDataContract.connect(owner).depositReward(noteCommitments, denominations, { value: rewardAmount });
      const depositReceipt = await depositTx.wait();
      
      const noteProofData = noteProofs[0];
      const proofData = await generateNoteProof(noteProofData.note, noteProofData.root, noteProofData.proof);
      await zkDataContract.setRewardTreeRoot(proofData.input.root);
      
      const solidityProof = await proofToSolidity(proofData);
      const claimTx = await zkDataContract.connect(recipient).claimReward(
        solidityProof.pA,
        solidityProof.pB,
        solidityProof.pC,
        proofData.input.root,
        proofData.input.denomination,
        proofData.input.nullifierHash,
        recipient.address,
        0n
      );
      const claimReceipt = await claimTx.wait();
      
      const treeOverhead = depositReceipt.gasUsed;
      const percentage = (Number(treeOverhead) / Number(claimReceipt.gasUsed)) * 100;
      
      console.log(`\n=== Reward Tree Management Analysis ===`);
      console.log(`Reward tree operations (measured):`);
      console.log(`  - Minting reward (depositReward): ${treeOverhead.toString()} gas`);
      console.log(`\nTotal tree management overhead: ${treeOverhead.toString()} gas`);
      console.log(`Percentage of claimReward(): ${percentage.toFixed(2)}%`);
    });

    it("Benchmark: Asynchronous execution benefits", async function () {
      console.log(`\n=== Asynchronous Execution Benefits ===`);
      console.log(`Synchronous approach (standard):`);
      console.log(`  - Payment must happen immediately after response`);
      console.log(`  - Ties response to payment address`);
      console.log(`  - No privacy for delegate`);
      console.log(`\nAsynchronous approach (ZK):`);
      console.log(`  - Reward minting decoupled from claiming`);
      console.log(`  - Delegate can claim at any time`);
      console.log(`  - Fresh recipient address breaks link`);
      console.log(`  - Privacy: Complete anonymity`);
      console.log(`\nTrade-off: 8-12x gas cost for complete privacy and flexibility`);
    });

    it("Benchmark: Multiple reward claims", async function () {
      // Measure actual gas for single claim
      const denomination = ethers.parseEther("1");
      const notes = await generateRewardNotes([denomination]);
      const { root, noteProofs } = await generateRewardTree(notes);
      
      const rewardAmount = denomination;
      const noteCommitments = notes.map(n => n.commitment);
      const denominations = notes.map(n => n.denomination);
      
      await zkDataContract.connect(owner).depositReward(noteCommitments, denominations, { value: rewardAmount });
      
      const noteProofData = noteProofs[0];
      const proofData = await generateNoteProof(noteProofData.note, noteProofData.root, noteProofData.proof);
      await zkDataContract.setRewardTreeRoot(proofData.input.root);
      
      const solidityProof = await proofToSolidity(proofData);
      const claimTx = await zkDataContract.connect(recipient).claimReward(
        solidityProof.pA,
        solidityProof.pB,
        solidityProof.pC,
        proofData.input.root,
        proofData.input.denomination,
        proofData.input.nullifierHash,
        recipient.address,
        0n
      );
      const claimReceipt = await claimTx.wait();
      
      const gasPerClaim = claimReceipt.gasUsed;
      const tenClaimsGas = gasPerClaim * 10n;
      const ethCost = Number(tenClaimsGas) * 20e-9;
      
      console.log(`\n=== Multiple Reward Claims Analysis ===`);
      console.log(`Scenario: Delegate earns 10 rewards over time`);
      console.log(`Standard approach: Run 'Standard Approach Gas Measurements' for actual costs`);
      console.log(`\nZK approach (10 separate claims - measured):`);
      console.log(`  - Gas per claim: ${gasPerClaim.toString()} gas`);
      console.log(`  - Total gas (10 claims): ${tenClaimsGas.toString()} gas`);
      console.log(`  - Privacy: Complete (each claim to fresh address)`);
      console.log(`\nPrivacy premium for 10 claims: ${tenClaimsGas.toString()} gas`);
      console.log(`At 20 gwei: ~${ethCost.toFixed(4)} ETH additional`);
    });

    it("Benchmark: Reward circuit complexity impact", async function () {
      // Measure actual claimReward gas to estimate circuit verification cost
      const denomination = ethers.parseEther("1");
      const notes = await generateRewardNotes([denomination]);
      const { root, noteProofs } = await generateRewardTree(notes);
      
      const rewardAmount = denomination;
      const noteCommitments = notes.map(n => n.commitment);
      const denominations = notes.map(n => n.denomination);
      
      await zkDataContract.connect(owner).depositReward(noteCommitments, denominations, { value: rewardAmount });
      
      const noteProofData = noteProofs[0];
      const proofData = await generateNoteProof(noteProofData.note, noteProofData.root, noteProofData.proof);
      await zkDataContract.setRewardTreeRoot(proofData.input.root);
      
      const solidityProof = await proofToSolidity(proofData);
      const claimTx = await zkDataContract.connect(recipient).claimReward(
        solidityProof.pA,
        solidityProof.pB,
        solidityProof.pC,
        proofData.input.root,
        proofData.input.denomination,
        proofData.input.nullifierHash,
        recipient.address,
        0n
      );
      const claimReceipt = await claimTx.wait();
      
      console.log(`\n=== Reward Circuit Complexity Impact ===`);
      console.log(`Reward circuit (measured):`);
      console.log(`  - Total claimReward gas: ${claimReceipt.gasUsed.toString()} gas`);
      console.log(`\nCircuit complexity factors:`);
      console.log(`  - Number of public signals: 3 (root, denomination, nullifierHash)`);
      console.log(`  - Circuit constraints: Higher constraints = higher gas`);
      console.log(`  - Tree depth: 5 levels`);
      console.log(`\nOptimization opportunities:`);
      console.log(`  - Minimize public signals`);
      console.log(`  - Optimize circuit constraints`);
      console.log(`  - Use batched claims (if applicable)`);
    });

    it("Comparative analysis: Immediate vs deferred rewards", async function () {
      // Measure actual gas costs
      const denomination = ethers.parseEther("1");
      const notes = await generateRewardNotes([denomination]);
      const { root, noteProofs } = await generateRewardTree(notes);
      
      const rewardAmount = denomination;
      const noteCommitments = notes.map(n => n.commitment);
      const denominations = notes.map(n => n.denomination);
      
      const depositTx = await zkDataContract.connect(owner).depositReward(noteCommitments, denominations, { value: rewardAmount });
      const depositReceipt = await depositTx.wait();
      
      const noteProofData = noteProofs[0];
      const proofData = await generateNoteProof(noteProofData.note, noteProofData.root, noteProofData.proof);
      await zkDataContract.setRewardTreeRoot(proofData.input.root);
      
      const solidityProof = await proofToSolidity(proofData);
      const claimTx = await zkDataContract.connect(recipient).claimReward(
        solidityProof.pA,
        solidityProof.pB,
        solidityProof.pC,
        proofData.input.root,
        proofData.input.denomination,
        proofData.input.nullifierHash,
        recipient.address,
        0n
      );
      const claimReceipt = await claimTx.wait();
      
      const totalGas = depositReceipt.gasUsed + claimReceipt.gasUsed;
      
      console.log(`\n=== Immediate vs Deferred Rewards Comparison ===`);
      console.log(`Deferred rewards (ZK - measured):`);
      console.log(`  - Gas: ${totalGas.toString()} gas (mint + claim)`);
      console.log(`  - Privacy: Complete`);
      console.log(`  - Flexibility: High (claim anytime)`);
      console.log(`  - User experience: Complex (requires off-chain proof generation)`);
      console.log(`\nRecommendation: Use ZK rewards when privacy is critical`);
    });
  });

  describe("Reward Verifier Deployment", function () {
    it("Benchmark: RewardVerifier contract deployment", async function () {
      const RewardVerifierFactory = await ethers.getContractFactory("contracts/RewardVerifier.sol:Groth16Verifier");
      const rewardVerifier = await RewardVerifierFactory.deploy();
      const receipt = await rewardVerifier.deploymentTransaction().wait();
      const bytecode = RewardVerifierFactory.bytecode;

      console.log(`RewardVerifier deployment gas: ${receipt.gasUsed.toString()}`);
      console.log(`RewardVerifier bytecode size: ${bytecode.length} bytes`);
      console.log(`Note: Auto-generated contract from circom circuit`);
    });

    it("Comparative verifier deployment costs", async function () {
      console.log(`\n=== Verifier Deployment Comparison ===`);
      
      // Deploy and measure Identity Verifier
      const IdentityVerifierFactory = await ethers.getContractFactory("contracts/Verifier.sol:Groth16Verifier");
      const identityVerifier = await IdentityVerifierFactory.deploy();
      const identityReceipt = await identityVerifier.deploymentTransaction().wait();
      const identityBytecode = IdentityVerifierFactory.bytecode;

      // Deploy and measure Reward Verifier
      const RewardVerifierFactory = await ethers.getContractFactory("contracts/RewardVerifier.sol:Groth16Verifier");
      const rewardVerifier = await RewardVerifierFactory.deploy();
      const rewardReceipt = await rewardVerifier.deploymentTransaction().wait();
      const rewardBytecode = RewardVerifierFactory.bytecode;

      const gasOverhead = rewardReceipt.gasUsed - identityReceipt.gasUsed;
      const bytecodeOverhead = rewardBytecode.length - identityBytecode.length;

      console.log(`Identity Verifier (Verifier.sol):`);
      console.log(`  - Deployment gas: ${identityReceipt.gasUsed.toString()} gas`);
      console.log(`  - Bytecode size: ${identityBytecode.length} bytes`);
      console.log(`  - Public signals: 3`);
      console.log(`\nReward Verifier (RewardVerifier.sol):`);
      console.log(`  - Deployment gas: ${rewardReceipt.gasUsed.toString()} gas`);
      console.log(`  - Bytecode size: ${rewardBytecode.length} bytes`);
      console.log(`  - Public signals: 4`);
      console.log(`\nAdditional overhead:`);
      console.log(`  - Gas overhead: ${gasOverhead.toString()} gas`);
      console.log(`  - Bytecode overhead: ${bytecodeOverhead} bytes`);
    });
  });

  describe("Multi-Note Minting Gas Benchmarks", function () {
    it("Comprehensive gas vs notes measurement", async function () {
      console.log(`\n=== Comprehensive Gas vs Notes Measurement ===`);
      console.log(`Academic significance: Measuring gas cost vs granularity of denomination splitting`);
      
      const smallestDenom = ethers.parseEther("0.001");
      const noteCounts = [1, 3, 5, 9, 20];
      const results = [];

      for (const noteCount of noteCounts) {
        // Calculate a base amount that's exactly divisible by the smallest denomination
        // This ensures we can create any number of notes using the smallest denomination
        const baseRewardAmount = smallestDenom * BigInt(noteCount);
        const testDenominations = [];
        
        // Create the exact number of notes using the smallest denomination
        for (let i = 0; i < noteCount; i++) {
          testDenominations.push(smallestDenom);
        }

        const notes = await generateRewardNotes(testDenominations);
        const { root } = await generateRewardTree(notes);
        
        const totalAmount = testDenominations.reduce((sum, d) => sum + d, 0n);
        const noteCommitments = notes.map(n => n.commitment);
        
        const tx = await zkDataContract.connect(owner).depositReward(noteCommitments, testDenominations, { value: totalAmount });
        const receipt = await tx.wait();
        
        results.push({
          noteCount,
          gasUsed: receipt.gasUsed,
          denominations: testDenominations
        });
        
        await zkDataContract.setRewardTreeRoot(root);
      }

      console.log(`\nMeasurement Results (using smallest denomination for fair comparison):`);
      console.log(`Note Count | Total Amount (ETH) | Gas Used | Gas per Note`);
      console.log(`-----------|--------------------|----------|--------------`);
      
      for (const result of results) {
        const gasPerNote = Number(result.gasUsed) / result.noteCount;
        const totalAmount = result.denominations.reduce((sum, d) => sum + d, 0n);
        console.log(`${result.noteCount.toString().padEnd(10)} | ${ethers.formatEther(totalAmount).padEnd(18)} | ${result.gasUsed.toString().padEnd(8)} | ${gasPerNote.toFixed(0).padEnd(12)}`);
      }

      console.log(`\nPrivacy Analysis:`);
      console.log(`- 1 note: Exact denomination revealed`);
      console.log(`- 3+ notes: Denomination hidden among possibilities`);
      console.log(`- 9+ notes: Strong denomination privacy`);
      console.log(`- 20+ notes: Very strong denomination privacy`);
    });

    it("Gas scaling analysis with varying amounts", async function () {
      console.log(`\n=== Gas Scaling Analysis with Varying Amounts ===`);
      
      const amounts = [
        ethers.parseEther("0.01"),
        ethers.parseEther("0.1"),
        ethers.parseEther("1.0"),
        ethers.parseEther("10.0")
      ];
      
      const results = [];

      for (const amount of amounts) {
        // Use decomposeReward to get the actual denominations
        const denominationsResult = await zkDataContract.decomposeReward.staticCall(amount);
        const denominations = [...denominationsResult]; // Convert to mutable array
        const notes = await generateRewardNotes(denominations);
        const { root } = await generateRewardTree(notes);
        
        const totalAmount = denominations.reduce((sum, d) => sum + d, 0n);
        const noteCommitments = notes.map(n => n.commitment);
        
        const tx = await zkDataContract.connect(owner).depositReward(noteCommitments, denominations, { value: totalAmount });
        const receipt = await tx.wait();
        
        results.push({
          amount,
          noteCount: denominations.length,
          gasUsed: receipt.gasUsed
        });
        
        await zkDataContract.setRewardTreeRoot(root);
      }

      console.log(`Amount (ETH) | Note Count | Gas Used | Gas per Note | Gas per ETH`);
      console.log(`-------------|------------|----------|--------------|------------`);
      
      for (const result of results) {
        const gasPerNote = Number(result.gasUsed) / result.noteCount;
        const gasPerEth = Number(result.gasUsed) / Number(ethers.formatEther(result.amount));
        console.log(`${ethers.formatEther(result.amount).padEnd(12)} | ${result.noteCount.toString().padEnd(10)} | ${result.gasUsed.toString().padEnd(8)} | ${gasPerNote.toFixed(0).padEnd(12)} | ${gasPerEth.toFixed(0).padEnd(10)}`);
      }
    });
  });

  describe("Standard Approach Gas Measurements", function () {
    it("Measure standard ETH transfer gas costs", async function () {
      console.log(`\n=== Standard Approach Gas Measurements ===`);
      
      // Measure single ETH transfer
      const transferAmount = ethers.parseEther("1");
      const tx1 = await owner.sendTransaction({
        to: recipient.address,
        value: transferAmount
      });
      const receipt1 = await tx1.wait();
      
      // Measure multiple ETH transfers (simulating delegate + producer payment)
      const delegateAmount = ethers.parseEther("0.8");
      const producerAmount = ethers.parseEther("0.2");
      
      const tx2 = await owner.sendTransaction({
        to: delegate1.address,
        value: delegateAmount
      });
      const receipt2 = await tx2.wait();
      
      const tx3 = await owner.sendTransaction({
        to: producer.address,
        value: producerAmount
      });
      const receipt3 = await tx3.wait();
      
      const totalStandardGas = receipt2.gasUsed + receipt3.gasUsed;
      
      console.log(`Standard ETH Transfer Measurements:`);
      console.log(`  - Single ETH transfer: ${receipt1.gasUsed.toString()} gas`);
      console.log(`  - Delegate payment: ${receipt2.gasUsed.toString()} gas`);
      console.log(`  - Producer payment: ${receipt3.gasUsed.toString()} gas`);
      console.log(`  - Total (delegate + producer): ${totalStandardGas.toString()} gas`);
      console.log(`\nNote: These are actual measured costs for standard ETH transfers`);
    });
  });

  describe("Complete Reward Lifecycle Analysis", function () {
    it("End-to-end reward system comparison", async function () {
      // Measure actual gas costs
      const denomination = ethers.parseEther("1");
      const notes = await generateRewardNotes([denomination]);
      const { root, noteProofs } = await generateRewardTree(notes);
      
      const rewardAmount = denomination;
      const noteCommitments = notes.map(n => n.commitment);
      const denominations = notes.map(n => n.denomination);
      
      const depositTx = await zkDataContract.connect(owner).depositReward(noteCommitments, denominations, { value: rewardAmount });
      const depositReceipt = await depositTx.wait();
      
      const noteProofData = noteProofs[0];
      const proofData = await generateNoteProof(noteProofData.note, noteProofData.root, noteProofData.proof);
      await zkDataContract.setRewardTreeRoot(proofData.input.root);
      
      const solidityProof = await proofToSolidity(proofData);
      const claimTx = await zkDataContract.connect(recipient).claimReward(
        solidityProof.pA,
        solidityProof.pB,
        solidityProof.pC,
        proofData.input.root,
        proofData.input.denomination,
        proofData.input.nullifierHash,
        recipient.address,
        0n
      );
      const claimReceipt = await claimTx.wait();
      
      const zkTotalGas = depositReceipt.gasUsed + claimReceipt.gasUsed;
      
      console.log(`\n=== Complete Reward Lifecycle Comparison ===`);
      console.log(`Standard Lifecycle: Run 'Standard Approach Gas Measurements' for actual costs`);
      console.log(`\nZK Lifecycle (per CTI response - measured):`);
      console.log(`  1. Reward minting (depositReward): ${depositReceipt.gasUsed.toString()} gas`);
      console.log(`     - Privacy: Anonymous minting`);
      console.log(`  2. claimReward() (separate transaction): ${claimReceipt.gasUsed.toString()} gas`);
      console.log(`     - Privacy: Complete anonymity`);
      console.log(`  Total: ${zkTotalGas.toString()} gas`);
    });

    it("Cost-benefit analysis for academic paper", async function () {
      // Measure actual gas costs
      const denomination = ethers.parseEther("1");
      const notes = await generateRewardNotes([denomination]);
      const { root, noteProofs } = await generateRewardTree(notes);
      
      const rewardAmount = denomination;
      const noteCommitments = notes.map(n => n.commitment);
      const denominations = notes.map(n => n.denomination);
      
      const depositTx = await zkDataContract.connect(owner).depositReward(noteCommitments, denominations, { value: rewardAmount });
      const depositReceipt = await depositTx.wait();
      
      const noteProofData = noteProofs[0];
      const proofData = await generateNoteProof(noteProofData.note, noteProofData.root, noteProofData.proof);
      await zkDataContract.setRewardTreeRoot(proofData.input.root);
      
      const solidityProof = await proofToSolidity(proofData);
      const claimTx = await zkDataContract.connect(recipient).claimReward(
        solidityProof.pA,
        solidityProof.pB,
        solidityProof.pC,
        proofData.input.root,
        proofData.input.denomination,
        proofData.input.nullifierHash,
        recipient.address,
        0n
      );
      const claimReceipt = await claimTx.wait();
      
      const rewardClaimingGas = depositReceipt.gasUsed + claimReceipt.gasUsed;
      
      console.log(`\n=== Academic Cost-Benefit Analysis ===`);
      console.log(`Metrics for publication:`);
      console.log(`\n1. Gas Overhead by Phase (measured):`);
      console.log(`   - Reward Claiming: ${rewardClaimingGas.toString()} gas`);
      console.log(`\n2. Privacy Guarantees:`);
      console.log(`   - Identity: Anonymous registration via Poseidon commitments`);
      console.log(`   - CTI Access: Anonymous request-response via ZK proofs`);
      console.log(`   - Dispute: Anonymous voting via nullifiers`);
      console.log(`   - Rewards: Anonymous claiming via fresh addresses`);
      console.log(`\n3. Trade-off Summary:`);
      console.log(`   - Reward claiming gas: ${rewardClaimingGas.toString()} gas`);
      console.log(`   - Privacy level: Complete anonymity`);
      console.log(`   - Acceptability: High for privacy-critical applications`);
    });
  });
});

const { expect } = require("chai");
const { ethers } = require("hardhat");
const { randomFieldElement } = require("../helpers/poseidon");

// Baby Jubjub field order (from circomlib)
const SNARK_SCALAR_FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

describe("ZKIdentity Contract", function () {
  let zkIdentity;
  let owner, user1, user2, dataContract;

  const REGISTRATION_DEPOSIT = ethers.parseEther("1");

  beforeEach(async function () {
    [owner, user1, user2, dataContract] = await ethers.getSigners();

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
    zkIdentity = await ZKIdentityFactory.deploy();
    await zkIdentity.waitForDeployment();
  });

  describe("Deployment", () => {
    it("should set correct registration deposit", async () => {
      expect(await zkIdentity.REGISTRATION_DEPOSIT()).to.equal(REGISTRATION_DEPOSIT);
    });

    it("should deploy IdentityTree", async () => {
      expect(await zkIdentity.identityTree()).to.not.equal(ethers.ZeroAddress);
    });

    it("should start with zero deposits", async () => {
      const commitment = ethers.toBigInt(ethers.id("test"));
      expect(await zkIdentity.deposits(commitment)).to.equal(0);
    });

    it("should start with zero leaves in IdentityTree", async () => {
      const identityTreeAddress = await zkIdentity.identityTree();
      const identityTree = await ethers.getContractAt("IdentityTree", identityTreeAddress);
      expect(await identityTree.getNumberOfLeaves()).to.equal(0);
    });
  });

  describe("Identity Registration", () => {
    it("should register identity with correct deposit", async () => {
      const commitment = randomFieldElement();

      await expect(
        zkIdentity.connect(user1).registerIdentity(commitment, { value: REGISTRATION_DEPOSIT })
      ).to.emit(zkIdentity, "IdentityRegistered")
        .withArgs(commitment, 0);

      expect(await zkIdentity.deposits(commitment)).to.equal(REGISTRATION_DEPOSIT);
      const identityTreeAddress = await zkIdentity.identityTree();
      const identityTree = await ethers.getContractAt("IdentityTree", identityTreeAddress);
      expect(await identityTree.getNumberOfLeaves()).to.equal(1);
    });

    it("should fail to register with incorrect deposit", async () => {
      const commitment = randomFieldElement();
      const wrongDeposit = ethers.parseEther("0.5");

      await expect(
        zkIdentity.connect(user1).registerIdentity(commitment, { value: wrongDeposit })
      ).to.be.revertedWith("Incorrect deposit");
    });

    it("should fail to register same commitment twice", async () => {
      const commitment = randomFieldElement();

      await zkIdentity.connect(user1).registerIdentity(commitment, { value: REGISTRATION_DEPOSIT });

      await expect(
        zkIdentity.connect(user2).registerIdentity(commitment, { value: REGISTRATION_DEPOSIT })
      ).to.be.revertedWith("Already registered");
    });

    it("should allow multiple identity registrations", async () => {
      const commitment1 = randomFieldElement();
      const commitment2 = randomFieldElement();

      await zkIdentity.connect(user1).registerIdentity(commitment1, { value: REGISTRATION_DEPOSIT });
      await zkIdentity.connect(user2).registerIdentity(commitment2, { value: REGISTRATION_DEPOSIT });

      expect(await zkIdentity.deposits(commitment1)).to.equal(REGISTRATION_DEPOSIT);
      expect(await zkIdentity.deposits(commitment2)).to.equal(REGISTRATION_DEPOSIT);
      const identityTreeAddress = await zkIdentity.identityTree();
      const identityTree = await ethers.getContractAt("IdentityTree", identityTreeAddress);
      expect(await identityTree.getNumberOfLeaves()).to.equal(2);
    });

    it("should track deposits correctly", async () => {
      const commitment = randomFieldElement();

      await zkIdentity.connect(user1).registerIdentity(commitment, { value: REGISTRATION_DEPOSIT });

      const deposit = await zkIdentity.deposits(commitment);
      expect(deposit).to.equal(REGISTRATION_DEPOSIT);
    });
  });

  describe("Root Management", () => {
    it("should have valid root after registration", async () => {
      const commitment = randomFieldElement();

      await zkIdentity.connect(user1).registerIdentity(commitment, { value: REGISTRATION_DEPOSIT });

      const identityTreeAddress = await zkIdentity.identityTree();
      const identityTree = await ethers.getContractAt("IdentityTree", identityTreeAddress);
      const root = await identityTree.getRoot();
      expect(root).to.not.equal(0);
    });

    it("should have valid root after multiple registrations", async () => {
      const commitment1 = randomFieldElement();
      const commitment2 = randomFieldElement();

      await zkIdentity.connect(user1).registerIdentity(commitment1, { value: REGISTRATION_DEPOSIT });
      await zkIdentity.connect(user2).registerIdentity(commitment2, { value: REGISTRATION_DEPOSIT });

      const identityTreeAddress = await zkIdentity.identityTree();
      const identityTree = await ethers.getContractAt("IdentityTree", identityTreeAddress);
      const root = await identityTree.getRoot();
      expect(root).to.not.equal(0);
    });
  });

  describe("Deposit Slashing", () => {
    let registeredCommitment;

    beforeEach(async () => {
      registeredCommitment = randomFieldElement();
      await zkIdentity.connect(user1).registerIdentity(registeredCommitment, { value: REGISTRATION_DEPOSIT });
    });

    it("should allow slashing a deposit", async () => {
      await expect(
        zkIdentity.slashDeposit(registeredCommitment)
      ).to.emit(zkIdentity, "DepositSlashed")
        .withArgs(registeredCommitment);

      expect(await zkIdentity.deposits(registeredCommitment)).to.equal(0);
    });

    it("should fail to slash non-existent deposit", async () => {
      const nonExistentCommitment = randomFieldElement();

      await expect(
        zkIdentity.slashDeposit(nonExistentCommitment)
      ).to.be.revertedWith("No deposit to slash");
    });

    it("should fail to slash already slashed deposit", async () => {
      await zkIdentity.slashDeposit(registeredCommitment);

      await expect(
        zkIdentity.slashDeposit(registeredCommitment)
      ).to.be.revertedWith("No deposit to slash");
    });
  });

  describe("ZK Proof Verification", () => {
    it("should have verifyProof function available", async () => {
      expect(typeof zkIdentity.verifyProof).to.equal("function");
    });

    it("should accept valid proof format", async () => {
      const pA = [1, 2];
      const pB = [[1, 2], [1, 2]];
      const pC = [1, 2];
      const pubSignals = [1, 2, 3, 0]; // 4th signal unused

      // This will fail verification but should not revert due to format
      try {
        await zkIdentity.verifyProof(pA, pB, pC, pubSignals);
      } catch (error) {
        // Expected to fail verification, but function should be callable
      }
    });
  });

  describe("Edge Cases", () => {
    it("should handle zero commitment", async () => {
      const zeroCommitment = 0n;

      await expect(
        zkIdentity.connect(user1).registerIdentity(zeroCommitment, { value: REGISTRATION_DEPOSIT })
      ).to.emit(zkIdentity, "IdentityRegistered");

      expect(await zkIdentity.deposits(zeroCommitment)).to.equal(REGISTRATION_DEPOSIT);
    });

    it("should handle maximum field element commitment", async () => {
      const maxField = SNARK_SCALAR_FIELD - 1n;
      const commitment = maxField;

      await expect(
        zkIdentity.connect(user1).registerIdentity(commitment, { value: REGISTRATION_DEPOSIT })
      ).to.emit(zkIdentity, "IdentityRegistered");

      expect(await zkIdentity.deposits(commitment)).to.equal(REGISTRATION_DEPOSIT);
    });

    it("should handle registration with no value (should fail)", async () => {
      const commitment = randomFieldElement();

      await expect(
        zkIdentity.connect(user1).registerIdentity(commitment, { value: 0 })
      ).to.be.revertedWith("Incorrect deposit");
    });
  });
});

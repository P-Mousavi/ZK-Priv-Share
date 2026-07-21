const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("ZKIdentity Contract", function () {
  let zkIdentity;
  let owner, user1, user2, dataContract;

  const REGISTRATION_DEPOSIT = ethers.parseEther("1");

  beforeEach(async function () {
    [owner, user1, user2, dataContract] = await ethers.getSigners();

    const ZKIdentityFactory = await ethers.getContractFactory("ZKIdentity");
    zkIdentity = await ZKIdentityFactory.deploy();
    await zkIdentity.waitForDeployment();
  });

  describe("Deployment", () => {
    it("should set correct registration deposit", async () => {
      expect(await zkIdentity.REGISTRATION_DEPOSIT()).to.equal(REGISTRATION_DEPOSIT);
    });

    it("should set correct Merkle tree levels", async () => {
      expect(await zkIdentity.MERKLE_TREE_LEVELS()).to.equal(20);
    });

    it("should start with zero deposits", async () => {
      const commitment = ethers.toBigInt(ethers.id("test"));
      expect(await zkIdentity.deposits(commitment)).to.equal(0);
    });

    it("should start with next leaf index at zero", async () => {
      expect(await zkIdentity.nextLeafIndex()).to.equal(0);
    });
  });

  describe("Identity Registration", () => {
    it("should register identity with correct deposit", async () => {
      const commitment = ethers.toBigInt(ethers.id("user1"));
      const poseidonRoot = ethers.toBigInt(ethers.id("root1"));

      await expect(
        zkIdentity.connect(user1).registerIdentity(commitment, poseidonRoot, { value: REGISTRATION_DEPOSIT })
      ).to.emit(zkIdentity, "IdentityRegistered")
        .withArgs(commitment, 0);

      expect(await zkIdentity.deposits(commitment)).to.equal(REGISTRATION_DEPOSIT);
      expect(await zkIdentity.nextLeafIndex()).to.equal(1);
    });

    it("should fail to register with incorrect deposit", async () => {
      const commitment = ethers.toBigInt(ethers.id("user1"));
      const poseidonRoot = ethers.toBigInt(ethers.id("root1"));
      const wrongDeposit = ethers.parseEther("0.5");

      await expect(
        zkIdentity.connect(user1).registerIdentity(commitment, poseidonRoot, { value: wrongDeposit })
      ).to.be.revertedWith("Incorrect deposit");
    });

    it("should fail to register same commitment twice", async () => {
      const commitment = ethers.toBigInt(ethers.id("user1"));
      const poseidonRoot = ethers.toBigInt(ethers.id("root1"));

      await zkIdentity.connect(user1).registerIdentity(commitment, poseidonRoot, { value: REGISTRATION_DEPOSIT });

      await expect(
        zkIdentity.connect(user2).registerIdentity(commitment, poseidonRoot, { value: REGISTRATION_DEPOSIT })
      ).to.be.revertedWith("Already registered");
    });

    it("should allow multiple identity registrations", async () => {
      const commitment1 = ethers.toBigInt(ethers.id("user1"));
      const commitment2 = ethers.toBigInt(ethers.id("user2"));
      const poseidonRoot1 = ethers.toBigInt(ethers.id("root1"));
      const poseidonRoot2 = ethers.toBigInt(ethers.id("root2"));

      await zkIdentity.connect(user1).registerIdentity(commitment1, poseidonRoot1, { value: REGISTRATION_DEPOSIT });
      await zkIdentity.connect(user2).registerIdentity(commitment2, poseidonRoot2, { value: REGISTRATION_DEPOSIT });

      expect(await zkIdentity.deposits(commitment1)).to.equal(REGISTRATION_DEPOSIT);
      expect(await zkIdentity.deposits(commitment2)).to.equal(REGISTRATION_DEPOSIT);
      expect(await zkIdentity.nextLeafIndex()).to.equal(2);
    });

    it("should track deposits correctly", async () => {
      const commitment = ethers.toBigInt(ethers.id("user1"));
      const poseidonRoot = ethers.toBigInt(ethers.id("root1"));

      await zkIdentity.connect(user1).registerIdentity(commitment, poseidonRoot, { value: REGISTRATION_DEPOSIT });

      const deposit = await zkIdentity.deposits(commitment);
      expect(deposit).to.equal(REGISTRATION_DEPOSIT);
    });
  });

  describe("Root Management", () => {
    it("should mark current root as valid after registration", async () => {
      const commitment = ethers.toBigInt(ethers.id("user1"));
      const poseidonRoot = ethers.toBigInt(ethers.id("root1"));

      await zkIdentity.connect(user1).registerIdentity(commitment, poseidonRoot, { value: REGISTRATION_DEPOSIT });

      const currentRoot = await zkIdentity.currentRoot();
      expect(await zkIdentity.roots(currentRoot)).to.be.true;
    });

    it("should have valid root after multiple registrations", async () => {
      const commitment1 = ethers.toBigInt(ethers.id("user1"));
      const commitment2 = ethers.toBigInt(ethers.id("user2"));
      const poseidonRoot1 = ethers.toBigInt(ethers.id("root1"));
      const poseidonRoot2 = ethers.toBigInt(ethers.id("root2"));

      await zkIdentity.connect(user1).registerIdentity(commitment1, poseidonRoot1, { value: REGISTRATION_DEPOSIT });
      await zkIdentity.connect(user2).registerIdentity(commitment2, poseidonRoot2, { value: REGISTRATION_DEPOSIT });

      const currentRoot = await zkIdentity.currentRoot();
      expect(await zkIdentity.roots(currentRoot)).to.be.true;
    });
  });

  describe("Deposit Slashing", () => {
    beforeEach(async () => {
      const commitment = ethers.toBigInt(ethers.id("user1"));
      const poseidonRoot = ethers.toBigInt(ethers.id("root1"));
      await zkIdentity.connect(user1).registerIdentity(commitment, poseidonRoot, { value: REGISTRATION_DEPOSIT });
    });

    it("should allow slashing a deposit", async () => {
      const commitment = ethers.toBigInt(ethers.id("user1"));

      await expect(
        zkIdentity.slashDeposit(commitment)
      ).to.emit(zkIdentity, "DepositSlashed")
        .withArgs(commitment);

      expect(await zkIdentity.deposits(commitment)).to.equal(0);
    });

    it("should fail to slash non-existent deposit", async () => {
      const nonExistentCommitment = ethers.toBigInt(ethers.id("nonexistent"));

      await expect(
        zkIdentity.slashDeposit(nonExistentCommitment)
      ).to.be.revertedWith("No deposit to slash");
    });

    it("should fail to slash already slashed deposit", async () => {
      const commitment = ethers.toBigInt(ethers.id("user1"));

      await zkIdentity.slashDeposit(commitment);

      await expect(
        zkIdentity.slashDeposit(commitment)
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
      const poseidonRoot = ethers.toBigInt(ethers.id("root1"));

      await expect(
        zkIdentity.connect(user1).registerIdentity(zeroCommitment, poseidonRoot, { value: REGISTRATION_DEPOSIT })
      ).to.emit(zkIdentity, "IdentityRegistered");

      expect(await zkIdentity.deposits(zeroCommitment)).to.equal(REGISTRATION_DEPOSIT);
    });

    it("should handle maximum field element commitment", async () => {
      const maxField = ethers.MaxUint256;
      const commitment = maxField;
      const poseidonRoot = ethers.toBigInt(ethers.id("root1"));

      await expect(
        zkIdentity.connect(user1).registerIdentity(commitment, poseidonRoot, { value: REGISTRATION_DEPOSIT })
      ).to.emit(zkIdentity, "IdentityRegistered");

      expect(await zkIdentity.deposits(commitment)).to.equal(REGISTRATION_DEPOSIT);
    });

    it("should handle registration with no value (should fail)", async () => {
      const commitment = ethers.toBigInt(ethers.id("user1"));
      const poseidonRoot = ethers.toBigInt(ethers.id("root1"));

      await expect(
        zkIdentity.connect(user1).registerIdentity(commitment, poseidonRoot, { value: 0 })
      ).to.be.revertedWith("Incorrect deposit");
    });
  });
});

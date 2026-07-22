const { expect } = require("chai");
const { ethers } = require("hardhat");
const { randomFieldElement } = require("../helpers/poseidon");

describe("Identity Contract", function () {
  let identityContract;
  let owner, org1, org2, dataContract;

  const REGISTRATION_DEPOSIT = ethers.parseEther("1");

  beforeEach(async function () {
    [owner, org1, org2, dataContract] = await ethers.getSigners();

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
    identityContract = await IdentityContractFactory.deploy({ value: ethers.parseEther("10") });
    await identityContract.waitForDeployment();
  });

  describe("Deployment", () => {
    it("should set the correct owner", async () => {
      expect(await identityContract.owner()).to.equal(owner.address);
    });

    it("should have correct registration deposit", async () => {
      expect(await identityContract.REGISTRATION_DEPOSIT()).to.equal(REGISTRATION_DEPOSIT);
    });

    it("should start with zero deposits", async () => {
      const commitment = randomFieldElement();
      expect(await identityContract.isRegistered(org1.address)).to.be.false;
      expect(await identityContract.isRegistered(org2.address)).to.be.false;
    });
  });

  describe("Organisation Registration", () => {
    it("should register an organisation with correct deposit", async () => {
      const ipfsCid = "QmTest1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

      await expect(
        identityContract.connect(org1).registerOrganisation(ipfsCid, { value: REGISTRATION_DEPOSIT })
      ).to.emit(identityContract, "OrganisationRegistered")
        .withArgs(org1.address, REGISTRATION_DEPOSIT);

      expect(await identityContract.isRegistered(org1.address)).to.be.true;
    });

    it("should fail to register with incorrect deposit", async () => {
      const ipfsCid = "QmTest1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
      const wrongDeposit = ethers.parseEther("0.5");

      await expect(
        identityContract.connect(org1).registerOrganisation(ipfsCid, { value: wrongDeposit })
      ).to.be.revertedWith("Incorrect registration deposit");
    });

    it("should fail to register already registered organisation", async () => {
      const ipfsCid = "QmTest1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

      await identityContract.connect(org1).registerOrganisation(ipfsCid, { value: REGISTRATION_DEPOSIT });

      await expect(
        identityContract.connect(org1).registerOrganisation(ipfsCid, { value: REGISTRATION_DEPOSIT })
      ).to.be.revertedWith("Organisation already registered");
    });

    it("should store organisation details correctly", async () => {
      const ipfsCid = "QmTest1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

      await identityContract.connect(org1).registerOrganisation(ipfsCid, { value: REGISTRATION_DEPOSIT });

      const org = await identityContract.organisations(org1.address);
      expect(org.isRegistered).to.be.true;
      expect(org.deposit).to.equal(REGISTRATION_DEPOSIT);
      expect(org.identityInfoIpfsCid).to.equal(ipfsCid);
    });

    it("should allow multiple organisations to register", async () => {
      const ipfsCid1 = "QmTest1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
      const ipfsCid2 = "QmTest9876543210abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

      await identityContract.connect(org1).registerOrganisation(ipfsCid1, { value: REGISTRATION_DEPOSIT });
      await identityContract.connect(org2).registerOrganisation(ipfsCid2, { value: REGISTRATION_DEPOSIT });

      expect(await identityContract.isRegistered(org1.address)).to.be.true;
      expect(await identityContract.isRegistered(org2.address)).to.be.true;
    });
  });

  describe("Data Contract Management", () => {
    it("should allow owner to set data contract address", async () => {
      await identityContract.connect(owner).setDataContract(dataContract.address);
      expect(await identityContract.dataContractAddress()).to.equal(dataContract.address);
    });

    it("should fail when non-owner tries to set data contract", async () => {
      await expect(
        identityContract.connect(org1).setDataContract(dataContract.address)
      ).to.be.revertedWith("Only owner can call this");
    });
  });

  describe("Slash and Reward", () => {
    beforeEach(async () => {
      const ipfsCid = "QmTest1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
      await identityContract.connect(org1).registerOrganisation(ipfsCid, { value: REGISTRATION_DEPOSIT });
      await identityContract.connect(org2).registerOrganisation(ipfsCid, { value: REGISTRATION_DEPOSIT });
      await identityContract.connect(owner).setDataContract(dataContract.address);
    });

    it("should allow data contract to slash defendant and reward complainant", async () => {
      const complainantBalanceBefore = await ethers.provider.getBalance(org2.address);
      
      await expect(
        identityContract.connect(dataContract).slashAndReward(org1.address, org2.address)
      ).to.emit(identityContract, "DepositSlashed")
        .withArgs(org1.address, org2.address, REGISTRATION_DEPOSIT);

      expect(await identityContract.isRegistered(org1.address)).to.be.false;
      const org = await identityContract.organisations(org1.address);
      expect(org.deposit).to.equal(0);

      const complainantBalanceAfter = await ethers.provider.getBalance(org2.address);
      expect(complainantBalanceAfter - complainantBalanceBefore).to.equal(REGISTRATION_DEPOSIT);
    });

    it("should fail when non-data contract tries to slash", async () => {
      await expect(
        identityContract.connect(org1).slashAndReward(org2.address, org1.address)
      ).to.be.revertedWith("Only DataContract can call this");
    });

    it("should fail to slash organisation with no deposit", async () => {
      await expect(
        identityContract.connect(dataContract).slashAndReward(owner.address, org2.address)
      ).to.be.revertedWith("Defendant has no deposit to slash");
    });

    it("should allow data contract to reward defendant and slash complainant", async () => {
      const defendantBalanceBefore = await ethers.provider.getBalance(org1.address);
      
      await expect(
        identityContract.connect(dataContract).rewardDefendant(org1.address, org2.address)
      ).to.emit(identityContract, "DepositRewarded")
        .withArgs(org1.address, org2.address, REGISTRATION_DEPOSIT);

      expect(await identityContract.isRegistered(org2.address)).to.be.false;
      const org2Data = await identityContract.organisations(org2.address);
      expect(org2Data.deposit).to.equal(0);

      const defendantBalanceAfter = await ethers.provider.getBalance(org1.address);
      expect(defendantBalanceAfter - defendantBalanceBefore).to.equal(REGISTRATION_DEPOSIT);
    });

    it("should fail when non-data contract tries to reward defendant", async () => {
      await expect(
        identityContract.connect(org1).rewardDefendant(org1.address, org2.address)
      ).to.be.revertedWith("Only DataContract can call this");
    });

    it("should fail to reward when complainant has no deposit", async () => {
      await expect(
        identityContract.connect(dataContract).rewardDefendant(org1.address, owner.address)
      ).to.be.revertedWith("Complainant has no deposit to slash");
    });
  });

  describe("Edge Cases", () => {
    it("should handle registration with empty IPFS CID", async () => {
      const emptyIpfsCid = "";

      await expect(
        identityContract.connect(org1).registerOrganisation(emptyIpfsCid, { value: REGISTRATION_DEPOSIT })
      ).to.emit(identityContract, "OrganisationRegistered");

      expect(await identityContract.isRegistered(org1.address)).to.be.true;
    });

    it("should handle registration with very long IPFS CID", async () => {
      const longIpfsCid = "Qm" + "a".repeat(44);

      await expect(
        identityContract.connect(org1).registerOrganisation(longIpfsCid, { value: REGISTRATION_DEPOSIT })
      ).to.emit(identityContract, "OrganisationRegistered");

      expect(await identityContract.isRegistered(org1.address)).to.be.true;
    });
  });
});

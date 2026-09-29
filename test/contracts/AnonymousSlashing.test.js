const { expect } = require("chai");
const { ethers } = require("hardhat");
const { groth16 } = require("snarkjs");

describe("AnonymousSlashing with dispute-triggered real Groth16 proofs", function () {
  const proofPlaceholder = [[1n, 2n], [[1n, 2n], [3n, 4n]], [5n, 6n]];
  const evidenceCid = "QmEvidence1234567890ABCDEFGHJKLMNPQRSTUVWXYZab";
  const registrationCid = "QmTest1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

  async function deployFixture({ recordAccountability = true } = {}) {
    const [owner, producer, consumer, delegate, manager1, manager2] = await ethers.getSigners();
    const publicSignals = require("../../circuits/build/artifacts/slashing/public.json").map(BigInt);
    const slashProof = require("../../circuits/build/artifacts/slashing/proof.json");
    const calldata = JSON.parse(`[${await groth16.exportSolidityCallData(slashProof, publicSignals.map(String))}]`);

    const PoseidonT3 = await ethers.getContractFactory("poseidon-solidity/PoseidonT3.sol:PoseidonT3");
    const poseidonT3 = await PoseidonT3.deploy();
    const IncrementalTree = await ethers.getContractFactory(
      "@zk-kit/incremental-merkle-tree.sol/IncrementalBinaryTree.sol:IncrementalBinaryTree",
      { libraries: { PoseidonT3: await poseidonT3.getAddress() } }
    );
    const treeLibrary = await IncrementalTree.deploy();

    const Identity = await ethers.getContractFactory("IdentityContract", {
      libraries: { IncrementalBinaryTree: await treeLibrary.getAddress() }
    });
    const identity = await Identity.deploy({ value: ethers.parseEther("10") });
    const ZKIdentity = await ethers.getContractFactory("ZKIdentity", {
      libraries: { IncrementalBinaryTree: await treeLibrary.getAddress() }
    });
    const zkIdentity = await ZKIdentity.deploy();
    const RewardVerifier = await ethers.getContractFactory("contracts/RewardVerifier.sol:Groth16Verifier");
    const rewardVerifier = await RewardVerifier.deploy();
    const Data = await ethers.getContractFactory("ZKDataContract");
    const data = await Data.deploy(
      await zkIdentity.getAddress(), await identity.getAddress(), await rewardVerifier.getAddress(),
      [manager1.address, manager2.address], 2
    );
    await identity.setDataContract(await data.getAddress());

    for (const signer of [producer, consumer, delegate]) {
      await identity.connect(signer).registerOrganisation(registrationCid, { value: ethers.parseEther("1") });
    }

    const Registry = await ethers.getContractFactory("AnonymousStakeRegistry", {
      libraries: { IncrementalBinaryTree: await treeLibrary.getAddress() }
    });
    const stakes = await Registry.deploy(1, owner.address);
    await stakes.lockStake(publicSignals[4], { value: 1 });
    expect(await stakes.stakeRoot()).to.equal(publicSignals[1]);

    const StateMock = await ethers.getContractFactory("StateTransitionVerifierMock");
    const stateVerifier = await StateMock.deploy();
    const State = await ethers.getContractFactory("PrivateStateTree");
    const state = await State.deploy(11, await stateVerifier.getAddress());
    await state.setStakeRegistry(await stakes.getAddress());
    if (recordAccountability) {
      await state.submitPrivateCtiWithStateProof(
        ...proofPlaceholder,
        1, publicSignals[1], 11, 22, 999, publicSignals[0], publicSignals[2]
      );
    }

    const Verifier = await ethers.getContractFactory("contracts/SlashingVerifier.sol:Groth16Verifier");
    const verifier = await Verifier.deploy();
    const Slashing = await ethers.getContractFactory("AnonymousSlashing");
    const slashing = await Slashing.deploy(await verifier.getAddress(), await stakes.getAddress());
    await stakes.setSlasher(await slashing.getAddress());
    await slashing.setStateTree(await state.getAddress());
    await slashing.setDisputeResolver(await data.getAddress());
    await data.setAnonymousSlashing(await slashing.getAddress());

    return { owner, producer, consumer, delegate, manager1, manager2, data, stakes, state, slashing, publicSignals, calldata };
  }

  async function resolveGuiltyDispute(fixture) {
    const { data, producer, consumer, delegate, manager1, manager2, publicSignals } = fixture;
    await data.connect(producer).shareCti("QmPolicy1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ", "QmHashes1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ", 1, 1, [delegate.address], [1]);
    await data.connect(producer).commitCti(1, publicSignals[0], 1);
    await data.connect(consumer).initialRequest(1, 1);
    await data.connect(consumer).provideCredentials(1, "QmCredentials1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ", { value: 3 });
    await data.connect(delegate).provideResponse(1, "QmResponse1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ");
    await data.connect(consumer).raiseDispute(1, delegate.address, 1, evidenceCid);
    await data.connect(manager1).voteOnDispute(1, true);
    await data.connect(manager2).voteOnDispute(1, true);
  }

  it("resolves a real dispute, then accepts a real anonymous slashing proof", async function () {
    const fixture = await deployFixture();
    await resolveGuiltyDispute(fixture);
    const { slashing, stakes, publicSignals, calldata } = fixture;
    expect(await slashing.maliciousCti(publicSignals[0])).to.equal(true);

    await expect(slashing.slash(calldata[0], calldata[1], calldata[2], ...publicSignals))
      .to.emit(slashing, "AnonymousStakeSlashed");
    expect(await stakes.deposits(publicSignals[4])).to.equal(0);
    expect(await slashing.usedStakeNullifiers(publicSignals[3])).to.equal(true);
    await expect(slashing.slash(calldata[0], calldata[1], calldata[2], ...publicSignals))
      .to.be.revertedWith("stake nullifier already used");
  });

  it("rejects direct owner marking, an unrecorded accountability commitment, and wrong dispute CTI", async function () {
    const fixture = await deployFixture({ recordAccountability: false });
    const { owner, slashing, publicSignals, calldata } = fixture;
    await expect(slashing.connect(owner).confirmMaliciousFromDispute(publicSignals[0]))
      .to.be.revertedWith("only dispute resolver");

    await resolveGuiltyDispute(fixture);
    await expect(slashing.slash(calldata[0], calldata[1], calldata[2], ...publicSignals))
      .to.be.revertedWith("accountability not recorded");
    await expect(slashing.slash(calldata[0], calldata[1], calldata[2], publicSignals[0] + 1n, publicSignals[1], publicSignals[2], publicSignals[3], publicSignals[4]))
      .to.be.revertedWith("CTI not malicious");
  });

  it("rejects malformed real-proof input and a slash against a registry without the proved stake", async function () {
    const fixture = await deployFixture();
    await resolveGuiltyDispute(fixture);
    const { owner, slashing, state, publicSignals, calldata } = fixture;
    const malformedA = [...calldata[0]];
    malformedA[0] = 1n;
    await expect(slashing.slash(malformedA, calldata[1], calldata[2], ...publicSignals))
      .to.be.revertedWith("invalid slashing proof");

    const PoseidonT3 = await ethers.getContractFactory("poseidon-solidity/PoseidonT3.sol:PoseidonT3");
    const poseidonT3 = await PoseidonT3.deploy();
    const IncrementalTree = await ethers.getContractFactory(
      "@zk-kit/incremental-merkle-tree.sol/IncrementalBinaryTree.sol:IncrementalBinaryTree",
      { libraries: { PoseidonT3: await poseidonT3.getAddress() } }
    );
    const library = await IncrementalTree.deploy();
    const Registry = await ethers.getContractFactory("AnonymousStakeRegistry", { libraries: { IncrementalBinaryTree: await library.getAddress() } });
    const emptyStakes = await Registry.deploy(1, await slashing.getAddress());
    const Verifier = await ethers.getContractFactory("contracts/SlashingVerifier.sol:Groth16Verifier");
    const verifier = await Verifier.deploy();
    const Slashing = await ethers.getContractFactory("AnonymousSlashing");
    const noStakeSlash = await Slashing.deploy(await verifier.getAddress(), await emptyStakes.getAddress());
    await noStakeSlash.setStateTree(await state.getAddress());
    await noStakeSlash.setDisputeResolver(owner.address);
    await noStakeSlash.confirmMaliciousFromDispute(publicSignals[0]);
    await expect(noStakeSlash.slash(calldata[0], calldata[1], calldata[2], ...publicSignals))
      .to.be.revertedWith("stake root is not current");
  });
});

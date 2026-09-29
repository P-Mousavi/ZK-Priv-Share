const { expect } = require("chai");
const { ethers } = require("hardhat");
const { groth16 } = require("snarkjs");
const { computeIdentityCommitment, computeStakeCommitment } = require("../../scripts/helpers/ctiCommitment");
const { computeAcknowledgement } = require("../../scripts/helpers/ctiCommitment");

describe("AnonymousCtiAccess canonical commitment-only flow", function () {
  let access, slashing, state, stateCall, stateSignals, identityCall, identitySignals;

  beforeEach(async function () {
    stateSignals = require("../../circuits/build/artifacts/state/public.json").map(BigInt);
    const stateProof = require("../../circuits/build/artifacts/state/proof.json");
    stateCall = JSON.parse(`[${await groth16.exportSolidityCallData(stateProof, stateSignals.map(String))}]`);
    identitySignals = require("../../circuits/build/artifacts/identity/public.json").map(BigInt);
    const identityProof = require("../../circuits/build/artifacts/identity/proof.json");
    identityCall = JSON.parse(`[${await groth16.exportSolidityCallData(identityProof, identitySignals.map(String))}]`);

    const PoseidonT3 = await ethers.getContractFactory("poseidon-solidity/PoseidonT3.sol:PoseidonT3");
    const poseidonT3 = await PoseidonT3.deploy();
    const IncrementalTree = await ethers.getContractFactory(
      "@zk-kit/incremental-merkle-tree.sol/IncrementalBinaryTree.sol:IncrementalBinaryTree",
      { libraries: { PoseidonT3: await poseidonT3.getAddress() } }
    );
    const treeLibrary = await IncrementalTree.deploy();

    const Registry = await ethers.getContractFactory("AnonymousStakeRegistry", {
      libraries: { IncrementalBinaryTree: await treeLibrary.getAddress() }
    });
    const stakes = await Registry.deploy(1, (await ethers.getSigners())[0].address);
    const input = require("../../circuits/state_input.json");
    const identityCommitment = await computeIdentityCommitment(BigInt(input.identitySecret));
    const stakeCommitment = await computeStakeCommitment(identityCommitment, BigInt(input.stakeAmount), BigInt(input.stakeRandomness));
    await stakes.lockStake(stakeCommitment, { value: 1 });
    expect(await stakes.stakeRoot()).to.equal(stateSignals[1]);

    const StateVerifier = await ethers.getContractFactory("contracts/StateVerifier.sol:Groth16Verifier");
    const stateVerifier = await StateVerifier.deploy();
    const State = await ethers.getContractFactory("PrivateStateTree");
    state = await State.deploy(stateSignals[2], await stateVerifier.getAddress());
    await state.setStakeRegistry(await stakes.getAddress());

    const SlashingVerifier = await ethers.getContractFactory("contracts/SlashingVerifier.sol:Groth16Verifier");
    const slashingVerifier = await SlashingVerifier.deploy();
    const Slashing = await ethers.getContractFactory("AnonymousSlashing");
    slashing = await Slashing.deploy(await slashingVerifier.getAddress(), await stakes.getAddress());
    await stakes.setSlasher(await slashing.getAddress());
    await slashing.setStateTree(await state.getAddress());

    const IdentityVerifier = await ethers.getContractFactory("contracts/Verifier.sol:Groth16Verifier");
    const identityVerifier = await IdentityVerifier.deploy();
    const PoseidonT4 = await ethers.getContractFactory("poseidon-solidity/PoseidonT4.sol:PoseidonT4");
    const poseidonT4 = await PoseidonT4.deploy();
    const Access = await ethers.getContractFactory("AnonymousCtiAccess", {
      libraries: { PoseidonT4: await poseidonT4.getAddress() }
    });
    access = await Access.deploy(await state.getAddress(), await identityVerifier.getAddress(), await slashing.getAddress());
    await slashing.setDisputeResolver(await access.getAddress());
  });

  async function publish() {
    await access.publishCti(stateCall[0], stateCall[1], stateCall[2], ...stateSignals);
    expect(await access.publishedCti(stateSignals[5])).to.equal(true);
  }

  it("publishes, requests access, records delivery, and resolves a commitment-only dispute", async function () {
    const [owner] = await ethers.getSigners();
    await publish();
    // Generated identity proof public order: [access nullifier, root, request commitment].
    await expect(access.requestAccess(identityCall[0], identityCall[1], identityCall[2], identitySignals[1], identitySignals[0], identitySignals[2], stateSignals[5]))
      .to.emit(access, "AnonymousAccessRequested");
    const request = await access.accessRequests(identitySignals[2]);
    expect(request.ctiCommitment).to.equal(stateSignals[5]);

    await access.recordDelivery(identitySignals[2], 9001);
    const acknowledgement = await access.computeAcknowledgement(stateSignals[5], stateSignals[3], stateSignals[4]);
    expect(acknowledgement).to.equal(await computeAcknowledgement(stateSignals[5], stateSignals[3], stateSignals[4]));
    await expect(access.recordReceptionAcknowledgement(identitySignals[2], stateSignals[3], stateSignals[4], acknowledgement))
      .to.emit(access, "AnonymousReceptionAcknowledged");
    expect((await access.accessRequests(identitySignals[2])).acknowledgement).to.equal(acknowledgement);
    await access.raiseDispute(identitySignals[2], 8001, 7001);
    await access.setDisputeResolver(owner.address);
    await expect(access.resolveDispute(identitySignals[2], 8001, true))
      .to.emit(access, "AnonymousDisputeResolved");
    expect(await slashing.maliciousCti(stateSignals[5])).to.equal(true);
    await expect(access.resolveDispute(identitySignals[2], 8001, true)).to.be.revertedWith("dispute already resolved");
  });

  it("rejects unpublished CTIs, replayed access proofs, malformed proofs, and duplicate disputes", async function () {
    await expect(access.requestAccess(identityCall[0], identityCall[1], identityCall[2], identitySignals[1], identitySignals[0], identitySignals[2], stateSignals[5]))
      .to.be.revertedWith("CTI not published");
    await publish();
    await access.requestAccess(identityCall[0], identityCall[1], identityCall[2], identitySignals[1], identitySignals[0], identitySignals[2], stateSignals[5]);
    await expect(access.requestAccess(identityCall[0], identityCall[1], identityCall[2], identitySignals[1], identitySignals[0], identitySignals[2] - 1n, stateSignals[5]))
      .to.be.revertedWith("access nullifier already used");

    const badA = [...identityCall[0]];
    badA[0] = 1n;
    await expect(access.requestAccess(badA, identityCall[1], identityCall[2], identitySignals[1], identitySignals[0] + 1n, identitySignals[2] - 2n, stateSignals[5]))
      .to.be.revertedWith("invalid access proof");
    await access.recordDelivery(identitySignals[2], 9001);
    const acknowledgement = await access.computeAcknowledgement(stateSignals[5], stateSignals[3], stateSignals[4]);
    await expect(access.recordReceptionAcknowledgement(identitySignals[2], stateSignals[3] - 1n, stateSignals[4], acknowledgement))
      .to.be.revertedWith("state root is not current");
    await expect(access.recordReceptionAcknowledgement(identitySignals[2], stateSignals[3], stateSignals[4] + 1n, acknowledgement))
      .to.be.revertedWith("state nullifier not consumed");
    await expect(access.recordReceptionAcknowledgement(identitySignals[2], stateSignals[3], stateSignals[4], acknowledgement + 1n))
      .to.be.revertedWith("invalid acknowledgement");
    await access.recordReceptionAcknowledgement(identitySignals[2], stateSignals[3], stateSignals[4], acknowledgement);
    await expect(access.recordReceptionAcknowledgement(identitySignals[2], stateSignals[3], stateSignals[4], acknowledgement))
      .to.be.revertedWith("already acknowledged");
    await access.raiseDispute(identitySignals[2], 8001, 7001);
    await expect(access.raiseDispute(identitySignals[2], 8001, 7001)).to.be.revertedWith("request already disputed");
  });

  it("does not expose participant addresses in canonical publication/access/dispute events", async function () {
    for (const eventName of ["AnonymousCtiPublished", "AnonymousAccessRequested", "AnonymousAccessDelivered", "AnonymousReceptionAcknowledged", "AnonymousDisputeRaised", "AnonymousDisputeResolved"]) {
      expect(access.interface.getEvent(eventName).inputs.map((input) => input.type)).to.not.include("address");
    }
  });
});

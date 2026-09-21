const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("PrivateStateTree", function () {
  it("accepts the generated Groth16 transition proof", async function () {
    const Verifier = await ethers.getContractFactory("StateTransitionGroth16Verifier");
    const verifier = await Verifier.deploy();
    const Tree = await ethers.getContractFactory("PrivateStateTree");
    const publicSignals = require("../../circuits/build/public.json").map(BigInt);
    const proof = require("../../circuits/build/proof.json");
    const { groth16 } = require("snarkjs");
    const calldata = JSON.parse(`[${await groth16.exportSolidityCallData(proof, publicSignals.map(String))}]`);
    const tree = await Tree.deploy(publicSignals[0], await verifier.getAddress());
    await expect(tree.submitPrivateCti(calldata[0], calldata[1], calldata[2], ...publicSignals)).to.emit(tree, "PrivateCtiSubmitted");
    expect(await tree.stateRoot()).to.equal(publicSignals[1]);
    expect(await tree.usedNullifiers(publicSignals[2])).to.equal(true);
  });

  it("atomically updates the root and consumes a transition nullifier", async function () {
    const Mock = await ethers.getContractFactory("StateTransitionVerifierMock");
    const mock = await Mock.deploy();
    const Tree = await ethers.getContractFactory("PrivateStateTree");
    const tree = await Tree.deploy(11, await mock.getAddress());
    const proof = [[1, 2], [[1, 2], [3, 4]], [5, 6]];
    await expect(tree.applyTransition(...proof, 11, 22, 33)).to.emit(tree, "StateTransitionApplied");
    expect(await tree.stateRoot()).to.equal(22);
    expect(await tree.usedNullifiers(33)).to.equal(true);
    await expect(tree.applyTransition(...proof, 22, 44, 33)).to.be.revertedWith("transition nullifier already used");
  });

  it("rejects stale roots, invalid proofs, and malformed transitions", async function () {
    const Mock = await ethers.getContractFactory("StateTransitionVerifierMock");
    const mock = await Mock.deploy();
    const Tree = await ethers.getContractFactory("PrivateStateTree");
    const tree = await Tree.deploy(11, await mock.getAddress());
    const proof = [[1, 2], [[1, 2], [3, 4]], [5, 6]];
    await expect(tree.applyTransition(...proof, 10, 22, 33)).to.be.revertedWith("old root is not current");
    await mock.setResult(false);
    await expect(tree.applyTransition(...proof, 11, 22, 33)).to.be.revertedWith("invalid transition proof");
  });
});

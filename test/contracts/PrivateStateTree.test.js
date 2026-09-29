const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("PrivateStateTree", function () {
  it("accepts the generated Groth16 state-submission proof", async function () {
    const Verifier = await ethers.getContractFactory("contracts/StateVerifier.sol:Groth16Verifier");
    const verifier = await Verifier.deploy();
    const Tree = await ethers.getContractFactory("PrivateStateTree");
    const publicSignals = require("../../circuits/build/artifacts/state/public.json").map(BigInt);
    const proof = require("../../circuits/build/artifacts/state/proof.json");
    const { groth16 } = require("snarkjs");
    const calldata = JSON.parse(`[${await groth16.exportSolidityCallData(proof, publicSignals.map(String))}]`);
    const PoseidonT3 = await ethers.getContractFactory("poseidon-solidity/PoseidonT3.sol:PoseidonT3");
    const poseidonT3 = await PoseidonT3.deploy();
    await poseidonT3.waitForDeployment();
    const TreeLibrary = await ethers.getContractFactory(
      "@zk-kit/incremental-merkle-tree.sol/IncrementalBinaryTree.sol:IncrementalBinaryTree",
      { libraries: { PoseidonT3: await poseidonT3.getAddress() } }
    );
    const treeLibrary = await TreeLibrary.deploy();
    await treeLibrary.waitForDeployment();
    const Registry = await ethers.getContractFactory("AnonymousStakeRegistry", {
      libraries: { IncrementalBinaryTree: await treeLibrary.getAddress() }
    });
    const registry = await Registry.deploy(1, (await ethers.getSigners())[0].address);
    await registry.waitForDeployment();
    const input = require("../../circuits/state_input.json");
    const { computeIdentityCommitment, computeStakeCommitment } = require("../../scripts/helpers/ctiCommitment");
    const identityCommitment = await computeIdentityCommitment(BigInt(input.identitySecret));
    const stakeCommitment = await computeStakeCommitment(identityCommitment, BigInt(input.stakeAmount), BigInt(input.stakeRandomness));
    await (await registry.lockStake(stakeCommitment, { value: 1 })).wait();
    expect(await registry.stakeRoot()).to.equal(publicSignals[1]);

    // state.circom public order is identityRoot, stakeRoot, oldRoot, newRoot,
    // NF_state, ctiCommitment, accountabilityCommitment.
    const tree = await Tree.deploy(publicSignals[2], await verifier.getAddress());
    await tree.setStakeRegistry(await registry.getAddress());
    await expect(tree.submitPrivateCtiWithStateProof(calldata[0], calldata[1], calldata[2], ...publicSignals))
      .to.emit(tree, "PrivateCtiSubmitted");
    expect(await tree.stateRoot()).to.equal(publicSignals[3]);
    expect(await tree.usedNullifiers(publicSignals[4])).to.equal(true);
    expect(await tree.isAccountabilityRecorded(publicSignals[5], publicSignals[6])).to.equal(true);
  });

  it("atomically updates the root and consumes a transition nullifier", async function () {
    const Mock = await ethers.getContractFactory("StateTransitionVerifierMock");
    const mock = await Mock.deploy();
    const Tree = await ethers.getContractFactory("PrivateStateTree");
    const tree = await Tree.deploy(11, await mock.getAddress());
    const proof = [[1, 2], [[1, 2], [3, 4]], [5, 6]];
    await expect(tree.applyTransition(...proof, 11, 22, 33, 44)).to.emit(tree, "StateTransitionApplied");
    expect(await tree.stateRoot()).to.equal(22);
    expect(await tree.usedNullifiers(33)).to.equal(true);
    await expect(tree.applyTransition(...proof, 22, 44, 33, 44)).to.be.revertedWith("transition nullifier already used");
  });

  it("rejects a state proof statement with a stake root other than the funded registry root", async function () {
    const Mock = await ethers.getContractFactory("StateTransitionVerifierMock");
    const mock = await Mock.deploy();
    const PoseidonT3 = await ethers.getContractFactory("poseidon-solidity/PoseidonT3.sol:PoseidonT3");
    const poseidonT3 = await PoseidonT3.deploy();
    const TreeLibrary = await ethers.getContractFactory(
      "@zk-kit/incremental-merkle-tree.sol/IncrementalBinaryTree.sol:IncrementalBinaryTree",
      { libraries: { PoseidonT3: await poseidonT3.getAddress() } }
    );
    const treeLibrary = await TreeLibrary.deploy();
    const Registry = await ethers.getContractFactory("AnonymousStakeRegistry", {
      libraries: { IncrementalBinaryTree: await treeLibrary.getAddress() }
    });
    const registry = await Registry.deploy(1, (await ethers.getSigners())[0].address);
    const Tree = await ethers.getContractFactory("PrivateStateTree");
    const tree = await Tree.deploy(11, await mock.getAddress());
    await tree.setStakeRegistry(await registry.getAddress());
    const proof = [[1, 2], [[1, 2], [3, 4]], [5, 6]];
    await expect(tree.submitPrivateCtiWithStateProof(...proof, 1, 123, 11, 22, 33, 44, 55))
      .to.be.revertedWith("stake root is not current");
  });

  it("rejects stale roots, invalid proofs, and malformed transitions", async function () {
    const Mock = await ethers.getContractFactory("StateTransitionVerifierMock");
    const mock = await Mock.deploy();
    const Tree = await ethers.getContractFactory("PrivateStateTree");
    const tree = await Tree.deploy(11, await mock.getAddress());
    const proof = [[1, 2], [[1, 2], [3, 4]], [5, 6]];
    await expect(tree.applyTransition(...proof, 10, 22, 33, 44)).to.be.revertedWith("old root is not current");
    await mock.setResult(false);
    await expect(tree.applyTransition(...proof, 11, 22, 33, 44)).to.be.revertedWith("invalid transition proof");
  });

  it("accepts a receipt bound to the tree, request, commitment, and version", async function () {
    const recipient = ethers.Wallet.createRandom();
    const other = ethers.Wallet.createRandom();
    const Mock = await ethers.getContractFactory("StateTransitionVerifierMock");
    const mock = await Mock.deploy();
    const Tree = await ethers.getContractFactory("PrivateStateTree");
    const tree = await Tree.deploy(11, await mock.getAddress());
    const requestId = 7n, commitment = 99n, version = 2n;
    const digest = ethers.keccak256(ethers.solidityPacked(
      ["string", "address", "uint256", "uint256", "uint256", "uint256"],
      ["PRIV_SHARE_RECEIPT_V1", await tree.getAddress(), 31337n, requestId, commitment, version]
    ));
    const signature = recipient.signingKey.sign(digest);
    const encoded = ethers.Signature.from(signature).serialized;
    await expect(tree.acceptReceipt(requestId, commitment, version, recipient.address, encoded))
      .to.emit(tree, "ReceiptAccepted").withArgs(digest, requestId, commitment, version, recipient.address);
    await expect(tree.acceptReceipt(requestId, commitment, version, recipient.address, encoded)).to.be.revertedWith("receipt already used");
    await expect(tree.acceptReceipt(requestId, commitment + 1n, version, recipient.address, encoded)).to.be.revertedWith("invalid receipt signature");
  });
});

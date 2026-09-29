const { expect } = require("chai");
const { ethers } = require("hardhat");
const { buildPoseidon } = require("circomlibjs");
const { IncrementalMerkleTree } = require("@zk-kit/incremental-merkle-tree");
const { randomFieldElement, poseidonHashArray } = require("../helpers/poseidon");
const { generateNoteProof, proofToSolidity } = require("../helpers/rewardProofHelper");

describe("ShieldedRewardTree", function () {
  const denomination = ethers.parseEther("1");
  let owner, claimant, tree, jsTree;

  beforeEach(async function () {
    [owner, claimant] = await ethers.getSigners();
    const Verifier = await ethers.getContractFactory("contracts/RewardVerifier.sol:Groth16Verifier");
    const verifier = await Verifier.deploy();

    const PoseidonT3 = await ethers.getContractFactory("poseidon-solidity/PoseidonT3.sol:PoseidonT3");
    const poseidonT3 = await PoseidonT3.deploy();
    const IncrementalTree = await ethers.getContractFactory(
      "@zk-kit/incremental-merkle-tree.sol/IncrementalBinaryTree.sol:IncrementalBinaryTree",
      { libraries: { PoseidonT3: await poseidonT3.getAddress() } }
    );
    const incrementalTree = await IncrementalTree.deploy();
    const Tree = await ethers.getContractFactory("ShieldedRewardTree", {
      libraries: { IncrementalBinaryTree: await incrementalTree.getAddress() }
    });
    tree = await Tree.deploy(await verifier.getAddress());
    await tree.waitForDeployment();

    const poseidon = await buildPoseidon();
    const hash = (inputs) => BigInt(poseidon.F.toString(poseidon(inputs.map(BigInt))));
    jsTree = new IncrementalMerkleTree(hash, 5, 0n, 2);
  });

  async function issueAndProve() {
    const secret = randomFieldElement();
    const noteNullifier = randomFieldElement();
    const noteCommitment = await poseidonHashArray([denomination, secret, noteNullifier]);
    await (await tree.issueRewardNote(noteCommitment, denomination, { value: denomination })).wait();
    jsTree.insert(noteCommitment);
    expect(await tree.rewardRoot()).to.equal(jsTree.root);

    const proof = jsTree.createProof(0);
    const proofData = await generateNoteProof(
      { secret, nullifier: noteNullifier, denomination, commitment: noteCommitment },
      jsTree.root,
      proof
    );
    const solidity = await proofToSolidity(proofData);
    return { proofData, solidity };
  }

  it("maintains a canonical reward root and claims an issued note with a real Groth16 proof", async function () {
    const { proofData, solidity } = await issueAndProve();
    const [root, proofDenomination, rewardNullifier] = solidity.pubSignals.map(BigInt);
    const before = await ethers.provider.getBalance(claimant.address);
    const tx = await tree.connect(claimant).claimReward(solidity.pA, solidity.pB, solidity.pC, root, proofDenomination, rewardNullifier);
    const receipt = await tx.wait();
    const after = await ethers.provider.getBalance(claimant.address);

    expect(after + receipt.fee).to.equal(before + denomination);
    expect(await tree.usedRewardNullifiers(rewardNullifier)).to.equal(true);
    await expect(tree.connect(claimant).claimReward(solidity.pA, solidity.pB, solidity.pC, root, proofDenomination, rewardNullifier))
      .to.be.revertedWith("reward nullifier already used");
    expect(proofData.input.root).to.equal(root);
  });

  it("rejects a non-canonical root and malformed proof", async function () {
    const { solidity } = await issueAndProve();
    const [root, proofDenomination, rewardNullifier] = solidity.pubSignals.map(BigInt);
    await expect(tree.claimReward(solidity.pA, solidity.pB, solidity.pC, root + 1n, proofDenomination, rewardNullifier))
      .to.be.revertedWith("reward root is not current");

    const malformedA = [...solidity.pA];
    malformedA[0] = 1n;
    await expect(tree.claimReward(malformedA, solidity.pB, solidity.pC, root, proofDenomination, rewardNullifier))
      .to.be.revertedWith("invalid reward proof");
  });

  it("does not let an issuer mint an unsupported or unfunded note", async function () {
    await expect(tree.issueRewardNote(123n, 123n, { value: 123n })).to.be.revertedWith("unsupported denomination");
    await expect(tree.issueRewardNote(123n, denomination, { value: denomination - 1n })).to.be.revertedWith("incorrect reward funding");
  });

  it("keeps producer and recipient addresses out of canonical reward events", async function () {
    const issue = tree.interface.getEvent("RewardNoteIssued");
    const claim = tree.interface.getEvent("RewardClaimed");
    expect(issue.inputs.map((input) => input.type)).to.not.include("address");
    expect(claim.inputs.map((input) => input.type)).to.not.include("address");
  });
});

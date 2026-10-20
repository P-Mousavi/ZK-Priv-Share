const { expect } = require("chai");
const { ethers } = require("hardhat");
const { buildPoseidon } = require("circomlibjs");
const { IncrementalMerkleTree } = require("@zk-kit/incremental-merkle-tree");
const { randomFieldElement, poseidonHashArray } = require("../helpers/poseidon");
const { generateNoteProof, proofToSolidity } = require("../helpers/rewardProofHelper");

describe("ShieldedRewardTree", function () {
  this.timeout(300000);
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
    jsTree = new IncrementalMerkleTree(hash, 7, 0n, 2);
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

  it("appends 128 notes, proves early and deep membership, and keeps spent positions occupied", async function () {
    expect(await tree.TREE_DEPTH()).to.equal(7n);
    const notes = [];
    for (let i = 0; i < 128; i++) {
      const secret = BigInt(200000 + i), nullifier = BigInt(300000 + i);
      const commitment = await poseidonHashArray([denomination, secret, nullifier]);
      const receipt = await (await tree.issueRewardNote(commitment, denomination, { value: denomination })).wait();
      expect(receipt.status).to.equal(1);
      jsTree.insert(commitment);
      expect(await tree.rewardRoot()).to.equal(jsTree.root);
      expect(await tree.rewardLeafCount()).to.equal(BigInt(i + 1));
      notes.push({ secret, nullifier, denomination, commitment });
    }
    const root = jsTree.root;
    await expect(tree.issueRewardNote(123n, denomination, { value: denomination }))
      .to.be.revertedWith("IncrementalBinaryTree: tree is full");
    // All issuance finishes before any claim; the claimant never receives an
    // identity or issuer authorization. Upper path bits are exercised at 127.
    for (const index of [0, 32, 49, 99, 127]) {
      const path = jsTree.createProof(index);
      expect(jsTree.verifyProof(path)).to.equal(true);
      const generated = await generateNoteProof(notes[index], root, path);
      const p = await proofToSolidity(generated);
      const [proofRoot, amount, nf] = p.pubSignals.map(BigInt);
      expect(proofRoot).to.equal(root);
      await expect(tree.connect(claimant).claimReward(p.pA, p.pB, p.pC, root + 1n, amount, nf))
        .to.be.revertedWith("reward root is not current");
      await expect(tree.connect(claimant).claimReward(p.pA, p.pB, p.pC, root, amount, nf + 1n))
        .to.be.revertedWith("invalid reward proof");
      const malformed = [...p.pA]; malformed[0] = 1n;
      await expect(tree.connect(claimant).claimReward(malformed, p.pB, p.pC, root, amount, nf))
        .to.be.revertedWith("invalid reward proof");
      const balance = await ethers.provider.getBalance(claimant.address);
      const receipt = await (await tree.connect(claimant).claimReward(p.pA, p.pB, p.pC, root, amount, nf)).wait();
      expect(receipt.status).to.equal(1);
      expect(await ethers.provider.getBalance(claimant.address) + receipt.fee).to.equal(balance + denomination);
      expect(await tree.usedRewardNullifiers(nf)).to.equal(true);
      await expect(tree.connect(claimant).claimReward(p.pA, p.pB, p.pC, root, amount, nf))
        .to.be.revertedWith("reward nullifier already used");
    }
    const badPath = jsTree.createProof(99);
    badPath.siblings[6][0] += 1n;
    let rejected = false;
    try { await generateNoteProof(notes[99], root, badPath); } catch (e) { rejected = /Assert Failed/.test(e.message); }
    expect(rejected, "invalid upper-level membership witness must fail").to.equal(true);
    expect(await tree.rewardRoot()).to.equal(root);
    expect(await tree.rewardLeafCount()).to.equal(128n);
    expect(await ethers.provider.getBalance(await tree.getAddress())).to.equal(123n * denomination);
    await expect(tree.issueRewardNote(456n, denomination, { value: denomination }))
      .to.be.revertedWith("IncrementalBinaryTree: tree is full");
  });
});

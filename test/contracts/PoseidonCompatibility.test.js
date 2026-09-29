const { expect } = require("chai");
const { ethers } = require("hardhat");
const { wasm } = require("circom_tester");
const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { buildPoseidon } = require("circomlibjs");
const { IncrementalMerkleTree } = require("@zk-kit/incremental-merkle-tree");
const {
  NULLIFIER_DOMAINS,
  hashCtiData,
  poseidonHash,
  computeAcknowledgement,
  computeAccountabilityCommitment,
  computeCtiCommitment,
  computeIdentityCommitment,
  computeRatingNullifier,
  computeRewardNullifier,
  computeStakeCommitment,
  computeStakeNullifier,
  computeStateLeaf,
  computeStateNullifier
} = require("../../scripts/helpers/ctiCommitment");

describe("Phase 12 canonical Poseidon compatibility matrix", function () {
  this.timeout(300000);

  let wrapper, rawCircuit, merkleCircuit, jsHash, poseidonT3Library;

  before(async function () {
    const output = fs.mkdtempSync(path.join(os.tmpdir(), "poseidon-compatibility-"));
    const compiler = "/home/spm/.cargo/bin/circom";
    const rawSource = path.join(__dirname, "../../circuits/poseidon_compatibility_test.circom");
    const merkleSource = path.join(__dirname, "../../circuits/canonical_merkle_roots_test.circom");
    execFileSync(compiler, ["--wasm", "--r1cs", "--sym", "--output", output, rawSource], { stdio: "inherit" });
    execFileSync(compiler, ["--wasm", "--r1cs", "--sym", "--output", output, merkleSource], { stdio: "inherit" });
    rawCircuit = await wasm(rawSource, { output, recompile: false });
    merkleCircuit = await wasm(merkleSource, { output, recompile: false });

    const PoseidonT2 = await ethers.getContractFactory("poseidon-solidity/PoseidonT2.sol:PoseidonT2");
    const PoseidonT3 = await ethers.getContractFactory("poseidon-solidity/PoseidonT3.sol:PoseidonT3");
    const PoseidonT4 = await ethers.getContractFactory("poseidon-solidity/PoseidonT4.sol:PoseidonT4");
    const poseidonT2 = await PoseidonT2.deploy();
    poseidonT3Library = await PoseidonT3.deploy();
    const poseidonT4 = await PoseidonT4.deploy();
    const Wrapper = await ethers.getContractFactory("CanonicalPoseidonWrapper", {
      libraries: {
        PoseidonT2: await poseidonT2.getAddress(),
        PoseidonT3: await poseidonT3Library.getAddress(),
        PoseidonT4: await poseidonT4.getAddress()
      }
    });
    wrapper = await Wrapper.deploy();
    const poseidon = await buildPoseidon();
    jsHash = (inputs) => BigInt(poseidon.F.toString(poseidon(inputs.map(BigInt))));
  });

  async function circomHash(inputs) {
    const oneInput = inputs.length === 1 ? inputs[0] : 11n;
    const twoInputs = inputs.length === 2 ? inputs : [12n, 13n];
    const threeInputs = inputs.length === 3 ? inputs : [14n, 15n, 16n];
    const witness = await rawCircuit.calculateWitness({ oneInput, twoInputs, threeInputs });
    return BigInt(witness[inputs.length]);
  }

  async function solidityHash(inputs) {
    if (inputs.length === 1) return wrapper.hash1(inputs[0]);
    if (inputs.length === 2) return wrapper.hash2(inputs[0], inputs[1]);
    return wrapper.hash3(inputs[0], inputs[1], inputs[2]);
  }

  async function assertCompatible(label, inputs, canonicalValue) {
    const circomValue = await circomHash(inputs);
    const circomlibValue = await jsHash(inputs);
    const solidityValue = await solidityHash(inputs);
    expect(circomValue, `${label}: Circom`).to.equal(circomlibValue);
    expect(solidityValue, `${label}: Solidity`).to.equal(circomlibValue);
    if (canonicalValue !== undefined) {
      expect(await canonicalValue, `${label}: canonical helper`).to.equal(circomlibValue);
    }
  }

  it("matches every canonical one- and three-input commitment/nullifier construction", async function () {
    const identitySecret = 101n;
    const stakeAmount = 1000000000000000n;
    const stakeRandomness = 202n;
    const ctiId = 303n;
    const version = 1n;
    const ctiData = "phase-12-compatibility";
    const ctiHash = hashCtiData(ctiData);
    const ctiCommitment = await computeCtiCommitment(ctiId, version, ctiData);
    const identityCommitment = await computeIdentityCommitment(identitySecret);
    const stakeCommitment = await computeStakeCommitment(identityCommitment, stakeAmount, stakeRandomness);
    const noteSecret = 404n;
    const noteNullifier = 505n;
    const denomination = 1000000000000000n;
    const noteCommitment = await poseidonHash([denomination, noteSecret, noteNullifier]);

    // Identity leaf is in scope. Identity Merkle-root compatibility is
    // deliberately not exercised; see the separate documented PoC limitation.
    await assertCompatible("identity leaf", [identitySecret], identityCommitment);
    await assertCompatible("stake commitment", [identityCommitment, stakeAmount, stakeRandomness], stakeCommitment);
    await assertCompatible("state leaf", [77n, 1n, ctiCommitment], computeStateLeaf(77n, 1n, ctiCommitment));
    await assertCompatible("CTI commitment", [ctiId, version, ctiHash], ctiCommitment);
    await assertCompatible("accountability commitment", [stakeCommitment, ctiCommitment, 606n], computeAccountabilityCommitment(stakeCommitment, ctiCommitment, 606n));
    await assertCompatible("NF_state", [identitySecret, ctiCommitment, NULLIFIER_DOMAINS.STATE], computeStateNullifier(identitySecret, ctiCommitment));
    await assertCompatible("NF_stake", [identitySecret, stakeCommitment, NULLIFIER_DOMAINS.STAKE], computeStakeNullifier(identitySecret, stakeCommitment));
    await assertCompatible("NF_rating", [identitySecret, ctiCommitment, NULLIFIER_DOMAINS.RATING], computeRatingNullifier(identitySecret, ctiCommitment));
    await assertCompatible("NF_reward", [noteSecret, noteCommitment, NULLIFIER_DOMAINS.REWARD], computeRewardNullifier(noteSecret, noteCommitment));
    await assertCompatible("reward note commitment", [denomination, noteSecret, noteNullifier], noteCommitment);
    await assertCompatible("reception acknowledgement", [ctiCommitment, 707n, 808n], computeAcknowledgement(ctiCommitment, 707n, 808n));
  });

  it("matches canonical reward and stake Merkle roots without testing the excluded identity root", async function () {
    const IncrementalTree = await ethers.getContractFactory(
      "@zk-kit/incremental-merkle-tree.sol/IncrementalBinaryTree.sol:IncrementalBinaryTree",
      { libraries: { PoseidonT3: await poseidonT3Library.getAddress() } }
    );
    const incrementalTree = await IncrementalTree.deploy();

    const RewardVerifier = await ethers.getContractFactory("contracts/RewardVerifier.sol:Groth16Verifier");
    const rewardVerifier = await RewardVerifier.deploy();
    const RewardTree = await ethers.getContractFactory("ShieldedRewardTree", {
      libraries: { IncrementalBinaryTree: await incrementalTree.getAddress() }
    });
    const rewardTree = await RewardTree.deploy(await rewardVerifier.getAddress());

    const Registry = await ethers.getContractFactory("AnonymousStakeRegistry", {
      libraries: { IncrementalBinaryTree: await incrementalTree.getAddress() }
    });
    const [owner] = await ethers.getSigners();
    const stakeRegistry = await Registry.deploy(1n, owner.address);

    const rewardLeaves = [901n, 902n];
    const stakeLeaves = [1001n, 1002n];
    const rewardJsTree = new IncrementalMerkleTree(jsHash, 5, 0n, 2);
    const stakeJsTree = new IncrementalMerkleTree(jsHash, 7, 0n, 2);
    for (const leaf of rewardLeaves) {
      await rewardTree.issueRewardNote(leaf, 1000000000000000n, { value: 1000000000000000n });
      rewardJsTree.insert(leaf);
    }
    for (const leaf of stakeLeaves) {
      await stakeRegistry.lockStake(leaf, { value: 1n });
      stakeJsTree.insert(leaf);
    }

    const rewardProof = rewardJsTree.createProof(0);
    const stakeProof = stakeJsTree.createProof(0);
    const witness = await merkleCircuit.calculateWitness({
      rewardLeaf: rewardLeaves[0],
      rewardPathElements: rewardProof.siblings.map((level) => level[0]),
      rewardPathIndices: rewardProof.pathIndices,
      stakeLeaf: stakeLeaves[0],
      stakePathElements: stakeProof.siblings.map((level) => level[0]),
      stakePathIndices: stakeProof.pathIndices
    });

    const circomRewardRoot = BigInt(witness[1]);
    const circomStakeRoot = BigInt(witness[2]);
    expect(circomRewardRoot).to.equal(rewardJsTree.root);
    expect(circomRewardRoot).to.equal(await rewardTree.rewardRoot());
    expect(circomStakeRoot).to.equal(stakeJsTree.root);
    expect(circomStakeRoot).to.equal(await stakeRegistry.stakeRoot());
  });
});

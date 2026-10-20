const { expect } = require("chai");
const { ethers } = require("hardhat");
const { groth16 } = require("snarkjs");
const fs = require("fs");
const path = require("path");

describe("History-hiding state benchmark", function () {
  it("records proving time, proof size, verification gas, and storage gas", async function () {
    const root = path.join(__dirname, "../../circuits/build/artifacts/state");
    const input = require("../../circuits/state_input.json");
    const started = process.hrtime.bigint();
    const generated = await groth16.fullProve(input, path.join(root, "state.wasm"), path.join(root, "state.zkey"));
    const provingMs = Number(process.hrtime.bigint() - started) / 1e6;
    const calldata = JSON.parse(`[${await groth16.exportSolidityCallData(generated.proof, generated.publicSignals)}]`);
    const Verifier = await ethers.getContractFactory("contracts/StateVerifier.sol:Groth16Verifier");
    const verifier = await Verifier.deploy();
    const verificationGas = await verifier.verifyProof.estimateGas(calldata[0], calldata[1], calldata[2], generated.publicSignals.map(BigInt));
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
    const stakes = await Registry.deploy(1n, (await ethers.getSigners())[0].address);
    const H = require("../../scripts/helpers/ctiCommitment");
    const identityCommitment = await H.computeIdentityCommitment(BigInt(input.identitySecret));
    const stakeCommitment = await H.computeStakeCommitment(identityCommitment, BigInt(input.stakeAmount), BigInt(input.stakeRandomness));
    await stakes.lockStake(stakeCommitment, { value: 1n });
    expect(await stakes.stakeRoot()).to.equal(BigInt(generated.publicSignals[1]));
    const Tree = await ethers.getContractFactory("PrivateStateTree");
    const tree = await Tree.deploy(generated.publicSignals[2], await verifier.getAddress());
    await tree.setStakeRegistry(await stakes.getAddress());
    const tx = await tree.submitPrivateCtiWithStateProof(calldata[0], calldata[1], calldata[2], ...generated.publicSignals.map(BigInt));
    const receipt = await tx.wait();
    const result = { provingTimeMs: provingMs, proofSizeBytes: Buffer.byteLength(JSON.stringify(generated.proof)), verificationGas: verificationGas.toString(), transitionGas: receipt.gasUsed.toString(), storageSlotsWritten: 2 };
    const output = path.join(process.env.HH_BENCHMARK_OUT || path.join(__dirname, "../../benchmark-results/history-hiding"), "state-results.json");
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, JSON.stringify(result, null, 2), process.env.HH_BENCHMARK_OUT ? { flag: "wx" } : undefined);
    expect(await tree.stateRoot()).to.equal(BigInt(generated.publicSignals[3]));
  });
});

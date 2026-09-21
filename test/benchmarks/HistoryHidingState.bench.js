const { expect } = require("chai");
const { ethers } = require("hardhat");
const { groth16 } = require("snarkjs");
const fs = require("fs");
const path = require("path");

describe("History-hiding state benchmark", function () {
  it("records proving time, proof size, verification gas, and storage gas", async function () {
    const root = path.join(__dirname, "../../circuits/build");
    const input = require("../../circuits/state_transition_input.json");
    const started = process.hrtime.bigint();
    const generated = await groth16.fullProve(input, path.join(root, "state_transition_js/state_transition.wasm"), path.join(root, "state_transition_final.zkey"));
    const provingMs = Number(process.hrtime.bigint() - started) / 1e6;
    const calldata = JSON.parse(`[${await groth16.exportSolidityCallData(generated.proof, generated.publicSignals)}]`);
    const Verifier = await ethers.getContractFactory("StateTransitionGroth16Verifier");
    const verifier = await Verifier.deploy();
    const verificationGas = await verifier.verifyProof.estimateGas(calldata[0], calldata[1], calldata[2], generated.publicSignals.map(BigInt));
    const Tree = await ethers.getContractFactory("PrivateStateTree");
    const tree = await Tree.deploy(generated.publicSignals[0], await verifier.getAddress());
    const tx = await tree.submitPrivateCti(calldata[0], calldata[1], calldata[2], ...generated.publicSignals.map(BigInt));
    const receipt = await tx.wait();
    const result = { provingTimeMs: provingMs, proofSizeBytes: Buffer.byteLength(JSON.stringify(generated.proof)), verificationGas: verificationGas.toString(), transitionGas: receipt.gasUsed.toString(), storageSlotsWritten: 2 };
    fs.writeFileSync(path.join(__dirname, "../../benchmark-results/history-hiding-state-results.json"), JSON.stringify(result, null, 2));
    expect(await tree.stateRoot()).to.equal(BigInt(generated.publicSignals[1]));
  });
});

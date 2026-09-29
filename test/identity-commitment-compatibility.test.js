const { expect } = require("chai");
const { buildPoseidon } = require("circomlibjs");
const { wasm } = require("circom_tester");
const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { ethers } = require("hardhat");

describe("Canonical identity commitment compatibility", function () {
  let circuit;
  let poseidon;
  let solidityHasher;

  before(async function () {
    const source = path.join(__dirname, "../circuits/identity_commitment_test.circom");
    const output = fs.mkdtempSync(path.join(os.tmpdir(), "identity-commitment-test-"));
    execFileSync("/home/spm/.cargo/bin/circom", ["--wasm", "--r1cs", "--sym", "--output", output, source], { stdio: "inherit" });
    circuit = await wasm(source, { output, recompile: false });
    poseidon = await buildPoseidon();
    const PoseidonT2 = await ethers.getContractFactory("poseidon-solidity/PoseidonT2.sol:PoseidonT2");
    const poseidonT2 = await PoseidonT2.deploy();
    await poseidonT2.waitForDeployment();
    const Wrapper = await ethers.getContractFactory("IdentityCommitmentWrapper", {
      libraries: { PoseidonT2: await poseidonT2.getAddress() }
    });
    solidityHasher = await Wrapper.deploy();
    await solidityHasher.waitForDeployment();
  });

  it("uses Poseidon(identitySecret) identically in Circom, JavaScript, and Solidity", async function () {
    for (const identitySecret of [0n, 1n, 123456789n]) {
      const js = BigInt(poseidon.F.toString(poseidon([identitySecret])));
      const solidity = await solidityHasher.hash(identitySecret);
      const witness = await circuit.calculateWitness({ identitySecret });

      expect(BigInt(solidity)).to.equal(js);
      expect(BigInt(witness[1])).to.equal(js);
    }
  });
});

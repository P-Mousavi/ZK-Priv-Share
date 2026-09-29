const { expect } = require("chai");
const { wasm } = require("circom_tester");
const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { computeAcknowledgement } = require("../../scripts/helpers/ctiCommitment");

describe("Anonymous reception acknowledgement circuit", () => {
  let circuit: any;

  before(async () => {
    const source = path.join(__dirname, "../../circuits/acknowledgement_test.circom");
    const output = fs.mkdtempSync(path.join(os.tmpdir(), "acknowledgement-test-"));
    execFileSync("/home/spm/.cargo/bin/circom", ["--wasm", "--r1cs", "--sym", "--output", output, source], { stdio: "inherit" });
    circuit = await wasm(source, { output, recompile: false });
  });

  it("matches the JavaScript Poseidon acknowledgement construction", async () => {
    const ctiCommitment = 101n;
    const newStateRoot = 202n;
    const stateNullifier = 303n;
    const witness = await circuit.calculateWitness({ ctiCommitment, newStateRoot, stateNullifier });
    expect(BigInt(witness[1])).to.equal(await computeAcknowledgement(ctiCommitment, newStateRoot, stateNullifier));
  });
});

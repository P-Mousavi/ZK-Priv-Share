const { expect } = require("chai");
const { wasm } = require("circom_tester");
const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

describe("History-hiding state stake binding", () => {
  let circuit: any;
  let validInput: any;

  before(async () => {
    const source = path.join(__dirname, "../../circuits/state.circom");
    const output = fs.mkdtempSync(path.join(os.tmpdir(), "state-stake-test-"));
    execFileSync("/home/spm/.cargo/bin/circom", ["--wasm", "--r1cs", "--sym", "--output", output, source], { stdio: "inherit" });
    circuit = await wasm(source, { output, recompile: false });
    validInput = require("../../circuits/state_input.json");
  });

  it("accepts a state submission only with a funded stake-tree membership witness", async () => {
    const witness = await circuit.calculateWitness(validInput);
    expect(witness).to.not.be.undefined;
  });

  it("rejects a malformed stake-tree path", async () => {
    const input = { ...validInput, stakePathElements: [...validInput.stakePathElements] };
    input.stakePathElements[0] = "1";
    let rejected = false;
    try {
      await circuit.calculateWitness(input);
    } catch (_) {
      rejected = true;
    }
    expect(rejected).to.equal(true);
  });

  it("rejects a state witness calculated for a different Merkle index", async () => {
    const input = { ...validInput, statePathIndices: [...validInput.statePathIndices] };
    input.statePathIndices[0] = 1;
    let rejected = false;
    try {
      await circuit.calculateWitness(input);
    } catch (_) {
      rejected = true;
    }
    expect(rejected).to.equal(true);
  });
});

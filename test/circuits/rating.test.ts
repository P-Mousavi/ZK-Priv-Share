const { expect } = require("chai");
const { wasm } = require("circom_tester");
const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

describe("Anonymous rating circuit", () => {
  let circuit: any;
  let validInput: any;

  before(async () => {
    const source = path.join(__dirname, "../../circuits/rating.circom");
    const output = fs.mkdtempSync(path.join(os.tmpdir(), "rating-test-"));
    execFileSync("/home/spm/.cargo/bin/circom", ["--wasm", "--r1cs", "--sym", "--output", output, source], { stdio: "inherit" });
    circuit = await wasm(source, { output, recompile: false });
    validInput = require("../../circuits/rating_input.json");
  });

  it("accepts a binary anonymous rating with an identity membership witness", async () => {
    expect(await circuit.calculateWitness(validInput)).to.not.be.undefined;
  });

  it("rejects a non-binary rating and an invalid identity path", async () => {
    for (const input of [
      { ...validInput, rating: "2" },
      { ...validInput, pathElements: ["1", ...validInput.pathElements.slice(1)] }
    ]) {
      let rejected = false;
      try { await circuit.calculateWitness(input); } catch (_) { rejected = true; }
      expect(rejected).to.equal(true);
    }
  });
});

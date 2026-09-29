const { expect } = require("chai");
const { computeCtiCommitment, computeStateLeaf } = require("../scripts/helpers/ctiCommitment");

describe("CTI commitments", function () {
  it("is deterministic and binds the CTI, identifier, and version", async function () {
    const base = await computeCtiCommitment(7, 1, "payload");
    expect(await computeCtiCommitment(7, 1, "payload")).to.equal(base);
    expect(await computeCtiCommitment(7, 1, "payload changed")).to.not.equal(base);
    expect(await computeCtiCommitment(7, 2, "payload")).to.not.equal(base);
    expect(await computeCtiCommitment(8, 1, "payload")).to.not.equal(base);
  });

  it("uses the same request/status/commitment state-leaf format as the circuit", async function () {
    const cti = await computeCtiCommitment(7, 1, "payload");
    expect(await computeStateLeaf(42, 0, cti)).to.not.equal(await computeStateLeaf(42, 1, cti));
  });
});

const { expect } = require('chai');
const { receiptRecord, summaries, summarize } = require('../scripts/benchmarks/scalability/metrics');
describe('History-Hiding scalability measurement rules', function () {
  it('rejects unsuccessful or absent receipts rather than recording a gas sample', function () {
    for (const receipt of [null, {status:0, gasUsed:21000n}, {status:1,gasUsed:0n}]) {
      expect(()=>receiptRecord(receipt,'A','method',[],'operation',0)).to.throw();
    }
  });
  it('includes actual stage transactions once and excludes setup and duplicated verifier probes', function () {
    const row={proofs:[],transactions:[
      {category:'operation',method:'publishCti',gasUsed:350000},
      {category:'operation',method:'requestAccess',gasUsed:280000},
      {category:'operation',method:'recordDelivery',gasUsed:70000},
      {category:'operation',method:'recordReceptionAcknowledgement',gasUsed:170000},
      {category:'verification',method:'verifyProof',gasUsed:220000},
      {category:'initialization',method:'setStakeRegistry',gasUsed:44000},
      {category:'deployment',method:'constructor',gasUsed:1000000},
      {category:'capacityProbe',method:'issueRewardNote',gasUsed:10000}
    ]};
    const s=summaries(row);
    expect(s.workflows.publicationThroughAcknowledgement.aggregate).to.equal(870000);
    expect(s.workflows.publicationThroughAcknowledgement.successfulTransactions).to.equal(4);
    expect(s.deployment.aggregate).to.equal(1000000);
    expect(s.initialization.aggregate).to.equal(44000);
    expect(s.workflows.rewardIssuanceThroughClaim.aggregate).to.equal(null);
  });
  it('uses even-sample median and leaves absent samples unavailable', function () {
    expect(summarize([1,3,5,9]).median).to.equal(4);
    expect(summarize([]).mean).to.equal(null);
  });
});

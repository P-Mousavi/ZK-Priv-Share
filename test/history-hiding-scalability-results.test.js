const fs = require('fs');
const path = require('path');
const { expect } = require('chai');
const { summaries } = require('../scripts/benchmarks/scalability/metrics');
const raw = process.env.HH_SCALE_RESULTS;
if (!raw) throw new Error('Set HH_SCALE_RESULTS to the completed scalability results.json');
const data = JSON.parse(fs.readFileSync(path.resolve(raw)));
describe('Completed History-Hiding scalability evidence', function () {
  it('contains every requested independent workload, completed or explicitly capacity limited', function () {
    expect(data.failure).to.equal(null);
    expect(data.completedAt).to.be.a('string');
    expect(data.rows.length).to.equal((data.sizes.length + (data.rewardExtraSizes || []).length) * data.repetitions);
    for (const n of [...data.sizes, ...(data.rewardExtraSizes || [])]) for (let repetition = 1; repetition <= data.repetitions; repetition++) {
      const r = data.rows.find(row => row.n === n && row.repetition === repetition);
      expect(r).to.be.an('object');
      const count = r.rewardOnly ? 0 : n;
      const capacity = data.rewardCapacity || 32, rewardCount = Math.min(n, capacity);
      expect(r.completed).to.deep.equal({ registration:count, cti:count, rating:count, dispute:count, rewardIssued:rewardCount, rewardClaimed:rewardCount });
      expect(r.finalState.identityLeaves).to.equal(count);
      expect(r.finalState.stakeLeaves).to.equal(count);
      expect(r.finalState.rewardLeaves).to.equal(Math.min(n,capacity));
      expect(r.finalState.rewardBalance).to.equal('0');
      if (n>capacity) {
        expect(r.notAttemptedRewardNotes).to.equal(n-capacity-1);
        expect(r.uncompletedRewardNotes).to.equal(n-capacity);
      }
      expect(r.failures.length).to.equal(n>capacity ? 2 : n===capacity ? 1 : 0);
      for (const f of r.failures) {
        expect(f.expectedCapacityLimit).to.equal(true);
        expect(f.method).to.equal('issueRewardNote');
        expect(f.message).to.include('IncrementalBinaryTree: tree is full');
        expect(f.receipt?.status).not.to.equal(1);
      }
    }
  });
  it('has successful traceable receipts and complete real-proof configurations for all five paths', function () {
    const inputCounts = { identity:3, state:7, rating:4, slashing:5, reward:3 };
    for (const r of data.rows) {
      expect(new Set(r.transactions.map(t=>t.hash)).size).to.equal(r.transactions.length);
      for (const t of r.transactions) {
        expect(t.status).to.equal(1);
        expect(t.gasUsed).to.be.a('number').and.greaterThan(0);
        expect(t.hash).to.match(/^0x[0-9a-f]{64}$/);
        expect(t.logs).to.be.an('array');
        expect(t.elapsedMs).to.be.greaterThan(0);
        expect(t.contract).not.to.match(/Mock|AcceptAll/);
      }
      for (const c of Object.keys(inputCounts)) {
        const proofs = r.proofs.filter(p=>p.circuit===c);
        const verifications = r.transactions.filter(t=>t.category==='verification' && t.contract===c);
        expect(proofs.length).to.equal(c==='reward' ? Math.min(r.n,data.rewardCapacity || 32) : r.rewardOnly ? 0 : r.n);
        expect(verifications.length).to.equal(proofs.length);
        for (const p of proofs) {
          expect(p.fresh).to.equal(true);
          expect(p.publicSignals.length).to.equal(inputCounts[c]);
          expect(p.calldata[3].map(x=>BigInt(x).toString())).to.deep.equal(p.publicSignals);
          expect(p.fullProveMs).to.be.greaterThan(0);
          expect(p.proofSizeBytes).to.be.greaterThan(0);
          if (c === 'reward') {
            expect(p.input.pathElements.length).to.equal(data.rewardDepth || 5);
            expect(p.input.pathIndices.length).to.equal(data.rewardDepth || 5);
            expect(p.input.pathIndices.every(x => Number(x) === 0 || Number(x) === 1)).to.equal(true);
            expect(p.publicSignals[0]).to.equal(r.finalState.rewardRoot);
            expect(p.publicSignals[1]).to.equal('1000000000000000');
          }
        }
        if (c === 'reward') {
          expect(new Set(proofs.map(p => p.publicSignals[2])).size).to.equal(proofs.length);
          const claims = r.transactions.filter(t => t.category === 'operation' && t.method === 'claimReward');
          expect(claims.length).to.equal(proofs.length);
          proofs.forEach((p, index) => expect(claims[index].args.slice(0, 6)).to.deep.equal([...p.calldata.slice(0, 3), ...p.publicSignals]));
        }
      }
    }
  });
  it('recomputes all summaries from actual receipts and excludes diagnostic verification and setup', function () {
    for (const r of data.rows) {
      expect(r.summary).to.deep.equal(summaries(r));
      const totals=r.summary.workflows;
      expect(totals.registration.successfulTransactions).to.equal(2*(r.rewardOnly ? 0 : r.n));
      expect(totals.publicationThroughAcknowledgement.successfulTransactions).to.equal(4*(r.rewardOnly ? 0 : r.n));
      expect(totals.disputeThroughSlashing.successfulTransactions).to.equal(4*(r.rewardOnly ? 0 : r.n));
      expect(totals.rewardIssuanceThroughClaim.successfulTransactions).to.equal(2*Math.min(r.n,data.rewardCapacity || 32));
    }
  });
});

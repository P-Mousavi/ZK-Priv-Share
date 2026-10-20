const fs = require('fs');
const path = require('path');
const { summarize } = require('./metrics');
module.exports = function report(out) {
  const data = JSON.parse(fs.readFileSync(path.join(out, 'results.json')));
  const lines = [
    '# Measured History-Hiding scalability', '',
    `Command: \`${data.command}\`; sizes ${data.sizes.join(', ')}; ${data.repetitions} independent fresh-chain repetitions per size. Run: ${data.startedAt}.`, '',
    'All operation gas comes from successful receipts with hash, input, logs and status in `results.json`. Deployment and initialization are separate. Every proof is freshly generated using current WASM/zkey and production generated Solidity verifier; valid proof return is checked before a standalone verification transaction. That duplicate verifier probe is excluded from every workflow sum. No mocked proofs, root setters, testing modes, unrelated-sample sums, or monetary conversions are used.', '',
    'Each CTI workload registers N distinct Poseidon identities and N funded 1-wei stakes, precommits N pending private state leaves at deployment, then updates each leaf through publication, request, delivery, acknowledgement, rating, dispute report, two malicious votes and proof-gated slashing. The state root is shared and advances after every publication. Acknowledgement is recorded immediately while that root is current. Distinct stakes permit N slashes. Deployment includes constructor initialization and the nested IdentityTree; explicit configuration transactions are initialization. Registration is a recurring workload stage, not deployment.', '',
    `Rewards are a separately funded and authorized workload: append notes to one depth-${data.rewardDepth || 5} tree, then generate a fresh proof and claim each against the current root. Notes use 0.001 ETH. No claim-to-CTI eligibility link is asserted. Extra reward-only sizes: ${(data.rewardExtraSizes || []).join(', ') || 'none'}.`, '',
    '## Workload gas', '',
    'Aggregate medians below are medians of complete same-run receipt sums. Mean per completed item is mean aggregate divided by actual completed item count, not mean transaction gas. Every size has independent repetitions; within a run the successive operation samples occupy different tree positions and are not identical-state repetitions.', '',
    '| N | Stage / workflow | Completed items per run | Transactions per run | Aggregate gas median | Mean gas per completed item | Aggregate range | Fresh fullProve mean ms per run |',
    '|---:|---|---:|---:|---:|---:|---|---:|'
  ];
  const stages = [
    ['registration', 'registration', ['registerIdentity', 'lockStake'], ['state','identity','rating','slashing'], false],
    ['publication → acknowledgement', 'cti', ['publishCti','requestAccess','recordDelivery','recordReceptionAcknowledgement'], ['state','identity'], true],
    ['rating', 'rating', ['rate'], ['rating'], true],
    ['dispute → proof slash', 'dispute', ['raiseDispute','voteFirst','voteThreshold','slash'], ['slashing'], true],
    ['registration → CTI acknowledgement + rating + dispute/slash', 'dispute', ['registerIdentity','lockStake','publishCti','requestAccess','recordDelivery','recordReceptionAcknowledgement','rate','raiseDispute','voteFirst','voteThreshold','slash'], ['state','identity','rating','slashing'], true],
    ['reward issuance → claim', 'rewardClaimed', ['issueRewardNote','claimReward'], ['reward'], true]
  ];
  const table = [];
  for (const n of [...data.sizes, ...(data.rewardExtraSizes || [])]) {
    const rows = data.rows.filter(r => r.n === n);
    for (const [stage, completedKey, methods, circuits, withProofs] of stages) {
      if (rows.every(r => r.rewardOnly) && completedKey !== 'rewardClaimed') continue;
      const aggregates = rows.map(r => r.transactions.filter(t => t.category === 'operation' && methods.includes(t.method)).reduce((sum,t) => sum + t.gasUsed, 0));
      const s = summarize(aggregates), counts = rows.map(r => r.completed[completedKey]);
      const txCounts = rows.map(r => r.transactions.filter(t => t.category === 'operation' && methods.includes(t.method)).length);
      const prove = rows.map(r => withProofs ? r.proofs.filter(p => circuits.includes(p.circuit)).reduce((sum,p) => sum+p.fullProveMs,0) : 0);
      const meanPerItem = aggregates.reduce((a,b)=>a+b,0)/counts.reduce((a,b)=>a+b,0);
      lines.push(`| ${n} | ${stage} | ${counts.join('/')} | ${txCounts.join('/')} | ${s.median} | ${meanPerItem.toFixed(2)} | ${s.min}–${s.max} | ${withProofs ? summarize(prove).mean.toFixed(2) : 'N/A'} |`);
      table.push({ n, stage, repetitions: rows.length, completedPerRun: counts, transactionsPerRun: txCounts, aggregateGas: s, meanGasPerCompletedItem: meanPerItem, fullProveAggregateMs: withProofs ? summarize(prove) : null });
    }
  }
  lines.push('', '## Individual operation gas and proof resources', '',
    'Each cell lists sample count, mean, median and range. Samples pool both repetitions at the same N. These are actual transactions on growing shared storage. Full-prove milliseconds combine witness construction and Groth16 proving; off-chain tree maintenance, serialization and verifier calls are excluded.', '',
    '| N | Operation | Successful receipts | Mean gas | Median | Range |', '|---:|---|---:|---:|---:|---|');
  for (const n of [...data.sizes, ...(data.rewardExtraSizes || [])]) {
    const transactions = data.rows.filter(r=>r.n===n).flatMap(r=>r.transactions).filter(t=>t.category==='operation');
    for (const m of [...new Set(transactions.map(t=>t.method))]) {
      const s=summarize(transactions.filter(t=>t.method===m).map(t=>t.gasUsed));
      lines.push(`| ${n} | ${m} | ${s.count} | ${s.mean.toFixed(2)} | ${s.median} | ${s.min}–${s.max} |`);
    }
  }
  lines.push('', '| N | Circuit | Fresh proofs | FullProve ms mean / median / range | Standalone verifier gas mean / median / range |', '|---:|---|---:|---|---|');
  for (const n of [...data.sizes, ...(data.rewardExtraSizes || [])]) for (const c of ['identity','state','rating','slashing','reward']) {
    const rows=data.rows.filter(r=>r.n===n);
    if (!rows.some(r => r.proofs.some(p => p.circuit === c))) continue;
    const p=summarize(rows.flatMap(r=>r.proofs).filter(p=>p.circuit===c).map(p=>p.fullProveMs));
    const g=summarize(rows.flatMap(r=>r.transactions).filter(t=>t.category==='verification' && t.contract===c).map(t=>t.gasUsed));
    lines.push(`| ${n} | ${c} | ${p.count} | ${p.mean.toFixed(2)} / ${p.median.toFixed(2)} / ${p.min.toFixed(2)}–${p.max.toFixed(2)} | ${g.mean.toFixed(2)} / ${g.median} / ${g.min}–${g.max} |`);
  }
  lines.push('', '## One-time costs and failures', '', '| N | Deployment gas per repetition | Configuration gas per repetition | Off-chain tree maintenance ms per repetition |', '|---:|---|---|---|');
  for (const n of [...data.sizes, ...(data.rewardExtraSizes || [])]) {
    const rows=data.rows.filter(r=>r.n===n);
    lines.push(`| ${n} | ${rows.map(r=>r.summary.deployment.aggregate).join(' / ')} | ${rows.map(r=>r.summary.initialization.aggregate).join(' / ')} | ${rows.map(r=>r.offchainTreeMaintenanceMs.toFixed(2)).join(' / ')} |`);
  }
  const failures=data.rows.flatMap(r=>r.failures.map(f=>({n:r.n,repetition:r.repetition,...f})));
  lines.push('', `Recorded ${failures.length} expected capacity failures; unexpected failures: ${failures.filter(f=>!f.expectedCapacityLimit).length}. Full failure messages and attempted inputs are in JSON. Capacity probes rejected before a successful receipt are not counted in successful gas.`, '',
    '## Interpretation and limits', '',
    '- Aggregate gas rises with completed operation counts. Use the tables to assess per-item costs separately: insertion costs vary with append position, zero-to-nonzero storage writes, cached incremental subtrees and calldata bytes. Fixed-depth verifier gas is relatively stable; maps add fresh entries without an on-chain scan. This measured range does not establish an asymptotic law.',
    '- Identity, stake and state witnesses have depth 7 (128 slots); this run tests at most 100. State publication replaces a leaf in a preallocated committed population rather than appending a leaf on-chain. Post-deployment population allocation is not implemented and is not measured. Rating updates mapping counters, not a Merkle tree; this workload uses one rating per CTI, not many ratings of the same CTI.',
    '- Reward insertion supports 128 lifetime notes per deployment at depth 7. The default progression is 1/10/32/50/100 notes; actual requested and completed counts for this run appear in the tables. The extra N=32 rows execute rewards only; their shared deployment/configuration setup is excluded from recurring costs. Claims do not free slots; tests reject append 129 before and after claims. Old depth-5 proofs and roots require replacement; old results remain separate.',
    '- FullProve circuit dimensions are fixed, regardless of filled slots. Timings vary with local CPU load, JIT, randomness and warm-up; do not claim proving complexity increases with leaf population. Groth16 randomness makes proof bytes and intrinsic calldata gas vary even with deterministic witnesses. Standalone verifier receipt gas includes intrinsic transaction overhead; it must not be added to operation receipts that already verify the proof.',
    '- The new samples generate all five proofs freshly. Stored calldata is reused only for a checked eth_call and standalone verifier transaction. The separate existing state-scale experiment has two proofs per N and remains an independent reference; the comparative suite already measures witness/proving/serialization stages.',
    '- Canonical report, delivery, acknowledgement, votes and reward issuance do not invoke Groth16 verification. Proof verification occurs in publication, access, rating, slashing and claim. No synthetic zero-proof calls are counted.',
    '- Identity circuit root equality remains disabled. Measurements prove successful execution of the existing PoC, not complete identity authorization. Canonical acknowledgement has no recipient authentication. Slashing clears deposit accounting without moving/burning ETH. Reward eligibility is independent of CTI activity.',
    '- Only malicious two-manager outcomes are supported by the canonical resolver. No innocent resolution or economically matched original-architecture overhead is measured. No public-chain throughput, latency, monetary cost or anonymity guarantee follows from local Hardhat timing/gas.',
    '- Two independent deployments per size and a fixed binary tree configuration support local prototype feasibility and observed per-item gas ranges. Larger repetitions, host measurements, different depths/circuits, manager counts, same-CTI rating accumulation and deployable reward capacity management require separate experiments.', '',
    '## Thesis use', '',
    `Chapter 6 may report these actual-receipt workload sums, operation samples, production-verifier gas and separate fresh-proof timings with configuration and successful-count labels. This run completes CTI workflows up to ${Math.max(...data.rows.map(r => r.completed.cti))} and reward claims up to ${Math.max(...data.rows.map(r => r.completed.rewardClaimed))}. The reward lifetime bound is ${data.rewardCapacity || 32}. Describe these as bounded prototype measurements, not evidence of public-chain performance, general asymptotic scalability, sound identity membership, or an overhead percentage against unlike baseline operations.`
  );
  fs.writeFileSync(path.join(out,'report.md'),lines.join('\n')+'\n',{flag:'wx'});
  fs.writeFileSync(path.join(out,'workflow-summary.json'),JSON.stringify(table,null,2)+'\n',{flag:'wx'});
};

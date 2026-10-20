// Reproduce the capacity report from preserved raw receipts and validation.
const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const { summarize } = require('./metrics');
const root = path.resolve(__dirname, '../../..');
const out = path.resolve(process.argv[2] || '');
assert(process.argv[2], 'Pass the new capacity run directory');
const read = file => JSON.parse(fs.readFileSync(path.join(out, file)));
const data = read('workloads/results.json');
const before = read('before-capacity-metadata.json'), after = read('after-capacity-metadata.json');
const validation = read('validation-results.json');
const oldPath = 'benchmark-results/history-hiding/scalability/2026-10-10T18-47-17-618Z-384078/results.json';
const old = JSON.parse(fs.readFileSync(path.join(root, oldPath)));
assert.equal(data.failure, null); assert(data.completedAt);
assert.equal(data.repetitions, 2); assert.equal(data.rewardCapacity, 128);
for (const r of data.rows) {
  assert.equal(r.completed.rewardIssued, r.n); assert.equal(r.completed.rewardClaimed, r.n);
  assert.equal(r.failures.length, 0);
  if (!r.rewardOnly) for (const key of ['registration','cti','rating','dispute']) assert.equal(r.completed[key], r.n);
  for (const t of r.transactions) assert.equal(t.status, 1);
}
const fmt = n => Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });
const gas = (r, methods) => r.transactions.filter(t => t.category === 'operation' && methods.includes(t.method)).reduce((s,t) => s+t.gasUsed,0);
const proofMs = (r, circuits) => r.proofs.filter(p => circuits.includes(p.circuit)).reduce((s,p) => s+p.fullProveMs,0);
const full = ['registerIdentity','lockStake','publishCti','requestAccess','recordDelivery','recordReceptionAcknowledgement','rate','raiseDispute','voteFirst','voteThreshold','slash'];
const rowsAt = n => data.rows.filter(r => r.n === n);
const fullRowsAt = n => data.rows.filter(r => r.n === n && !r.rewardOnly);
const rewardRows = [1,10,32,50,100].map(n => {
  const rows = rowsAt(n); assert.equal(rows.length, 2);
  return { n, runs: rows.map(r => ({ repetition:r.repetition, requested:n, inserted:r.completed.rewardIssued, claimed:r.completed.rewardClaimed,
    completed:true, issuanceGas:gas(r,['issueRewardNote']), claimGas:gas(r,['claimReward']), combinedGas:gas(r,['issueRewardNote','claimReward']),
    meanGasPerNote:gas(r,['issueRewardNote','claimReward'])/n, fullProveMs:proofMs(r,['reward']),
    proofCount:r.proofs.filter(p=>p.circuit==='reward').length,
    verification:summarize(r.transactions.filter(t=>t.category==='verification' && t.contract==='reward').map(t=>t.gasUsed)) })),
    combinedGas:summarize(rows.map(r=>gas(r,['issueRewardNote','claimReward']))),
    fullProveMs:summarize(rows.map(r=>proofMs(r,['reward']))) };
});
const ctiRows = [1,10,50,100].map(n => {
  const rows=fullRowsAt(n); assert.equal(rows.length,2);
  return { n, runs:rows.map(r=>({ repetition:r.repetition, requested:n, completed:r.completed.cti,
    aggregateGas:gas(r,full), meanGasPerWorkflow:gas(r,full)/n,
    publicationThroughAcknowledgementGas:gas(r,['publishCti','requestAccess','recordDelivery','recordReceptionAcknowledgement']),
    fullProveMs:proofMs(r,['state','identity','rating','slashing']) })),
    aggregateGas:summarize(rows.map(r=>gas(r,full))),
    oldAggregateGas:summarize(old.rows.filter(r=>r.n===n).map(r=>gas(r,full))) };
});
const resource = [before,after].map(d=>({depth:d.depth,capacity:d.capacity,deployments:d.deployments,initialization:d.initialization}));
const summary = { rewardRows, ctiRows, resource, counts: {
  ctiWorkflows:data.rows.reduce((s,r)=>s+r.completed.cti,0), rewardClaims:data.rows.reduce((s,r)=>s+r.completed.rewardClaimed,0),
  freshProofs:data.rows.reduce((s,r)=>s+r.proofs.length,0), successfulReceipts:data.rows.reduce((s,r)=>s+r.transactions.length,0) } };
fs.writeFileSync(path.join(out,'capacity-summary.json'),JSON.stringify(summary,null,2)+'\n',{flag:'wx'});
const lines = [
  '# Reward capacity extension and measured History-Hiding scalability', '',
  '## Executive summary', '',
  `The canonical reward contract and circuit now use depth 7: **128 lifetime append slots**, up from depth 5 / 32 slots. Two independent runs completed every requested reward workload (1, 10, 32, 50 and 100 notes), including real production-verifier claims for every note. The original CTI progression (1, 10, 50 and 100) also completed twice. This run records ${summary.counts.ctiWorkflows} complete CTI workflows, ${summary.counts.rewardClaims} reward claims, ${summary.counts.freshProofs} fresh Groth16 proofs and ${summary.counts.successfulReceipts} successful receipts. No workload failure occurred.`, '',
  '## Root cause, implementation and compatibility', '',
  'The constructor initialized @zk-kit IncrementalBinaryTree with depth 5; its insert bound is numberOfLeaves < 2**depth. The reward circuit also required exactly five siblings. No independent fixed array or denomination policy imposed the 32-note bound. Claims consume nullifiers and transfer the fixed denomination without removing leaves. See [the pre-change dependency audit](capacity-dependency-audit.md) and [the exact changed-file list](changes.json).', '',
  'The minimal protocol change sets ShieldedRewardTree.TREE_DEPTH and ClaimReward membership depth to 7. Depth 6 would provide only 64 slots; depth 7 is the smallest binary depth meeting the target, since 2**7 = 128. Reward input generation, proof helpers, canonical JS trees and the Poseidon compatibility circuit were aligned. The canonical per-circuit build regenerated only reward R1CS/WASM/witness/zkey/verification key/proof and RewardVerifier. The other four circuit keys and contracts were retained. Issuer checks, five denominations, anonymous claim statement, nullifier construction and uniqueness checks, and asynchronous issuance/claim separation are unchanged. Identity, stake and state circuits remain separate depth-7 structures.', '',
  'Old depth-5 roots/proofs are incompatible with the new circuit/key. Deploy the regenerated verifier and new reward tree together; existing immutable deployments cannot be enlarged in place. Reconstruct seven-level paths and generate new proofs for the new tree. This change provides neither automatic migration nor unlimited capacity. The setup is the existing local prototype ceremony, not a production multiparty ceremony.', '',
  '## Environment and methodology', '',
  `Command: \`${data.command}\`, with \`HH_SCALE_OUT\` pointing to this run's new \`workloads/\` directory. Each N/repetition resets Hardhat and deploys a fresh graph. Solidity 0.8.20, optimizer 200, viaIR false, compiler target paris; runtime ${data.environment.hardfork || after.network.hardfork}, chain 31337, block gas limit ${after.network.blockGasLimit}. Node ${data.environment.node}, Hardhat ${data.environment.hardhat}, Circom ${data.environment.circom}, SnarkJS ${data.environment.snarkjs}. Host details and source/artifact hashes: [raw results](workloads/results.json).`, '',
  'The CTI scope preserves the previous methodology: 11 recurring receipts/item: registerIdentity, lockStake, publishCti, requestAccess, recordDelivery, recordReceptionAcknowledgement, rate, raiseDispute, first vote, threshold vote and slash. Four fresh proofs/item (state, identity, rating and slashing) are timed separately. State leaves are precommitted at deployment and updated in place. Slashing clears deposit accounting and does not transfer/burn ETH. Reward issuance is separately funded and has no automatic CTI eligibility link.', '',
  'Rewards use 0.001 ETH notes and the previous deterministic note inputs. Append the entire batch first; then freshly prove and claim every note against the resulting current root from a separate claimant account. Two extra N=32 rows reuse the graph fixture but skip registration and all CTI stages. Their deployment/configuration transactions are setup and excluded. Proof lookup, tree maintenance and serialization are outside fullProve timing; fullProve includes witness generation plus proving. Every proof is checked using the generated production verifier and then sent in a separate verifier transaction. This diagnostic receipt is excluded from all workflow sums because claim/publication/access/rating/slashing receipts already contain verification.', '',
  'Gas values are actual successful gasUsed receipts, with hash, inputs, logs, status and final-state assertions. Two independent sums support a mean, median and range, but not statistical significance. Timing is local wall time; no monetary fee, public-chain throughput, latency or asymptotic claim is made.', '',
  '## Reward scalability: both runs', '',
  '| Requested | Run | Inserted / claimed | Complete | Issuance gas | Claim gas | Combined gas | Mean gas/note | Fresh proofs / fullProve ms | Standalone verifier gas mean (n) |',
  '|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|'
];
for (const row of rewardRows) for (const r of row.runs) lines.push(`| ${row.n} | ${r.repetition} | ${r.inserted} / ${r.claimed} | Yes | ${fmt(r.issuanceGas)} | ${fmt(r.claimGas)} | ${fmt(r.combinedGas)} | ${fmt(r.meanGasPerNote)} | ${r.proofCount} / ${fmt(r.fullProveMs)} | ${fmt(r.verification.mean)} (${r.verification.count}) |`);
lines.push('', 'Combined means issuance + claim receipts from the same run, and describes a separately issued batch, not an automatic CTI-to-reward workflow. Verification is already included in claim gas. Per-transaction medians/ranges/sample counts are in [the workload report](workloads/report.md).', '',
  '| Requested | Independent runs | Combined gas median | Combined range | Mean gas/note | Mean proof ms/note |', '|---:|---:|---:|---|---:|---:|');
for(const r of rewardRows) lines.push(`| ${r.n} | 2 | ${fmt(r.combinedGas.median)} | ${fmt(r.combinedGas.min)}–${fmt(r.combinedGas.max)} | ${fmt(r.combinedGas.mean/r.n)} | ${fmt(r.fullProveMs.mean/r.n)} |`);
lines.push('', '## Complete CTI workflow regression: both runs', '',
  '| Requested | Run | Completed | Transactions | Aggregate gas (11 stages) | Mean gas/workflow | Fresh proof total ms (4N proofs) | Publication → acknowledgement gas |', '|---:|---:|---:|---:|---:|---:|---:|---:|');
for(const row of ctiRows) for(const r of row.runs) lines.push(`| ${row.n} | ${r.repetition} | ${r.completed} | ${11*row.n} | ${fmt(r.aggregateGas)} | ${fmt(r.meanGasPerWorkflow)} | ${fmt(r.fullProveMs)} | ${fmt(r.publicationThroughAcknowledgementGas)} |`);
lines.push('', '| N | Old median aggregate gas | New median aggregate gas | New range | Mean gas/workflow |', '|---:|---:|---:|---|---:|');
for(const r of ctiRows) lines.push(`| ${r.n} | ${fmt(r.oldAggregateGas.median)} | ${fmt(r.aggregateGas.median)} | ${fmt(r.aggregateGas.min)}–${fmt(r.aggregateGas.max)} | ${fmt(r.aggregateGas.mean/r.n)} |`);
lines.push('', 'The reward change is outside these 11 CTI transactions. Small gas differences can follow Groth16 randomness and calldata byte variation. Timings are not controlled paired experiments across the two dates; compare observed resource measurements without assigning a statistical performance improvement.', '',
  '## Before/after resource overhead', '', '| Metric | Depth 5 / previous | Depth 7 / updated |', '|---|---:|---:|',
  '| Tree depth / capacity | 5 / 32 | 7 / 128 |', '| Reward R1CS constraints | 3,830 | 4,878 |', '| Wires / private inputs / public inputs | 3,844 / 12 / 3 | 4,896 / 16 / 3 |');
for (const name of ['ShieldedRewardTree','contracts/RewardVerifier.sol:Groth16Verifier']) {
 const a=before.deployments.find(x=>x.contract===name),b=after.deployments.find(x=>x.contract===name);
 lines.push(`| ${name}: deployment gas incl. constructor initialization | ${fmt(a.gasUsed)} | ${fmt(b.gasUsed)} |`,
 `| ${name}: actual runtime bytes (limit 24,576) | ${a.runtimeBytes} | ${b.runtimeBytes} |`,
 `| ${name}: constructor SSTORE instructions | ${a.constructorSstoreInstructions} | ${b.constructorSstoreInstructions} |`);
}
lines.push(`| Separate setIssuer initialization gas | ${fmt(before.initialization.gasUsed)} | ${fmt(after.initialization.gasUsed)} |`,
  '| Separate gas inside constructor initialization | N/A (included in deployment receipt) | N/A (included in deployment receipt) |',
  '| Groth16 proof coordinates / ABI coordinate bytes | 8 / 256 | 8 / 256 |', '',
  'The extra two levels add 1,048 constraints and four private path inputs. They add two constructor SSTORE instructions (zero-hash cache initialization); this trace count is not a count of all distinct populated persistent slots. Additional cached subtree nodes are maintained on insertion. Their cost is included in measured issuance receipts; no separate storage rent or byte footprint was collected. Reward tree runtime size is unchanged. Generated verifier bytecode depends on the new key constants; its small size/gas change is an artifact-generation detail, not a cheaper proof statement. Both runtimes satisfy EIP-170. The verification statement still has three public inputs and the same Groth16 pairing structure.', '',
  'JSON-serialized proof byte lengths (not compressed/ABI length), fresh fullProve distributions, actual standalone verifier receipts and per-operation costs are available in the raw workload report. Reward insertion costs more with seven rather than five hash levels, while append-position/cache/storage effects still affect individual costs. Proof-generation dimensions are fixed within each depth; filled-slot count does not enlarge the circuit. Deployment constructor cost increased, while setIssuer configuration is unchanged. Quantitative timing comparisons require repeated controlled host experiments; two local runs do not establish significance.', '',
  '| Matched workload N | Resource | Previous mean (samples) | Updated mean (samples) |', '|---:|---|---:|---:|');
for (const n of [1,10]) {
 const previous=old.rows.filter(r=>r.n===n),current=rowsAt(n);
 for (const method of ['issueRewardNote','claimReward']) {
  const a=summarize(previous.flatMap(r=>r.transactions).filter(t=>t.category==='operation' && t.method===method).map(t=>t.gasUsed));
  const b=summarize(current.flatMap(r=>r.transactions).filter(t=>t.category==='operation' && t.method===method).map(t=>t.gasUsed));
  lines.push(`| ${n} | ${method} receipt gas | ${fmt(a.mean)} (${a.count}) | ${fmt(b.mean)} (${b.count}) |`);
 }
 const pa=summarize(previous.flatMap(r=>r.proofs).filter(p=>p.circuit==='reward').map(p=>p.fullProveMs));
 const pb=summarize(current.flatMap(r=>r.proofs).filter(p=>p.circuit==='reward').map(p=>p.fullProveMs));
 const ga=summarize(previous.flatMap(r=>r.transactions).filter(t=>t.category==='verification' && t.contract==='reward').map(t=>t.gasUsed));
 const gb=summarize(current.flatMap(r=>r.transactions).filter(t=>t.category==='verification' && t.contract==='reward').map(t=>t.gasUsed));
 lines.push(`| ${n} | fresh reward fullProve ms | ${fmt(pa.mean)} (${pa.count}) | ${fmt(pb.mean)} (${pb.count}) |`,
   `| ${n} | standalone verifier receipt gas | ${fmt(ga.mean)} (${ga.count}) | ${fmt(gb.mean)} (${gb.count}) |`);
}
const oldJson=summarize(old.rows.flatMap(r=>r.proofs).filter(p=>p.circuit==='reward').map(p=>p.proofSizeBytes));
const newJson=summarize(data.rows.flatMap(r=>r.proofs).filter(p=>p.circuit==='reward').map(p=>p.proofSizeBytes));
lines.push('', `Serialized proof JSON sizes: previous ${oldJson.min}–${oldJson.max} bytes (${oldJson.count} samples), updated ${newJson.min}–${newJson.max} bytes (${newJson.count} samples). Decimal-coordinate serialization varies with proof randomness; the eight-coordinate format is unchanged.`, '',
  'First-note issuance initializes cached subtrees at all levels; later insertions update already-populated cache slots. Two additional levels explain the higher issuance cost. Claim and standalone verification retain the same public-input count and pairing structure; small gas differences reflect calldata bytes/key constants rather than a growing Merkle-path loop on-chain. The path is evaluated in the circuit, not in claimReward. Timing comparisons above are observed means across dates, not controlled causal estimates.', '',
  '## Previous capacity-limited results', '', '| Old requested | Old inserted / claimed per run | Old combined median gas | New inserted / claimed per run | New combined median gas |', '|---:|---:|---:|---:|---:|');
for(const n of [1,10,50,100]) {
 const rows=old.rows.filter(r=>r.n===n),s=summarize(rows.map(r=>gas(r,['issueRewardNote','claimReward']))),current=rewardRows.find(r=>r.n===n);
 lines.push(`| ${n} | ${rows[0].completed.rewardIssued} / ${rows[0].completed.rewardClaimed} | ${fmt(s.median)} | ${n} / ${n} | ${fmt(current.combinedGas.median)} |`);
}
lines.push('', `Previous data: \`${oldPath}\`. Only N=1 and N=10 are matched full reward workloads. Old requested N=50/100 stopped at 32, so their aggregate costs cannot be presented as 50/100 completed notes or used for overhead percentages. The old primary run contains no requested N=32 workload; its capped 32-note samples are contextual references only. Original Priv-Share and legacy ZKData baseline data remain separate, with no manufactured reward counterpart.`, '',
  '## Commands and validation', '', '| Exact command / environment | Outcome | Evidence |', '|---|---|---|');
for(const c of validation.commands) lines.push(`| \`${c.command}\` | ${c.outcome} | [log](${c.log}) |`);
lines.push('', 'Capacity regression inserts every position 0–127, compares each Solidity root with the JS Poseidon tree, and verifies real claims at 0/32/49/99/127. It rejects incorrect roots, malformed points, altered public nullifiers, reused nullifiers and invalid upper-level membership witnesses. Appending 129 fails before and after claims; leaf count/root stay unchanged after spending. The compatibility test independently compares Circom, JS and Solidity roots and commitment/nullifier constructions. Existing issuer, denomination, funding and anonymous-event checks remain covered.', '',
  'The broad legacy glob is executed in an isolated copy. Three pre-existing failures remain: two HistoryHidingExtended cases refer to undefined owner, and ProofVerification fails its hook on obsolete identityNullifier input. They are not counted as real-proof evidence. Its obsolete reward helper also uses the old witness semantics and is left excluded rather than changing unrelated legacy identity/rating code. Full canonical contracts/E2E/circuit tests pass. The new receipt evidence tests recompute all counts and aggregates. The retained canonical real-proof smoke file uses verifier gas estimates; those estimates are regression evidence, while the primary tables use actual standalone verifier receipts.', '',
  'Execution incidents are retained: baseline provenance initially hit sandbox child-Git EPERM and passed on approved retry. A new metadata serializer initially rejected BigInt and was corrected. One broad-glob invocation accidentally wrote five historical files; it was stopped, all five were restored from local Git objects/original tool-output snapshots and verified against pre-task SHA-256 hashes. All 256 pre-task files (including the original 235 and subsequent scalability artifacts) match. The first comparative run rejected changes through its preservation guard; its evidence is retained, and a clean rerun passed. See [recovery evidence](historical-recovery.json), [preservation checks](preserved-results.json), and [validation](validation.md).', '',
  '## Limitations and remaining work', '',
  '- Append capacity remains bounded at 128; claim does not reclaim a slot, root history is not accepted for reward claims, and another deployment requires an explicit future capacity/migration design.',
  '- Identity root equality remains disabled in the existing identity circuit; this task does not establish sound identity membership. Acknowledgement is not recipient-authenticated. Slashing is accounting-only. Reward eligibility remains separate from CTI completion.',
  '- State leaves are allocated in the initial root rather than dynamically appended. Identity/stake/state depths remain 7. The workloads cover up to 100 items, not larger populations or public networks.',
  '- Only the current malicious two-vote resolution path is measured. Different manager thresholds, denominations, overlapping issuance/claims, larger repetitions, and independent hardware require further experiments.',
  '- Repair the excluded legacy benchmark fixtures separately. A deployment needs an appropriate trusted setup, matching key/verifier provenance, deployment configuration and a plan for old trees; the local ceremony is a prototype.', '',
  '## Chapter 6 summary', '',
  `The reward tree was extended from depth 5 (32 notes) to depth 7 (128 notes), with a regenerated Groth16 reward circuit and matching production verifier. Two independent local runs successfully issued and anonymously claimed all 100 requested notes; the median issuance-through-claim gas was ${fmt(rewardRows.find(r=>r.n===100).combinedGas.median)}, or ${fmt(rewardRows.find(r=>r.n===100).combinedGas.mean/100)} gas per note. The existing workflow through 100 CTIs also completed twice. These measurements establish bounded prototype execution and resource costs in Hardhat; they do not establish public-chain throughput or production performance.`, '',
  `درخت پاداش از عمق ۵ (۳۲ یادداشت) به عمق ۷ (۱۲۸ یادداشت) افزایش یافت و مدار پاداش Groth16 و قرارداد تأییدکنندهٔ متناظر بازتولید شدند. در دو اجرای مستقل محلی، هر ۱۰۰ یادداشت درخواست‌شده با موفقیت صادر و به‌صورت ناشناس دریافت شد. میانهٔ مجموع گس صدور و دریافت ${fmt(rewardRows.find(r=>r.n===100).combinedGas.median)} و میانگین گس هر یادداشت ${fmt(rewardRows.find(r=>r.n===100).combinedGas.mean/100)} بود. گردش‌کار موجود برای ۱۰۰ مورد CTI نیز در هر دو اجرا تکمیل شد. این نتایج هزینهٔ منابع و امکان اجرای نمونهٔ اولیهٔ محدود را در Hardhat نشان می‌دهند و شاهدی بر توان عملیاتی زنجیرهٔ عمومی یا عملکرد محیط عملیاتی نیستند.`, '',
  'Raw evidence: [workload JSON](workloads/results.json), [stage summaries](workloads/workflow-summary.json), [capacity summary](capacity-summary.json), [before metadata](before-capacity-metadata.json), [after metadata](after-capacity-metadata.json), [artifact hashes](artifact-hashes.json), [comparative rerun](comparative-validated/report.md), [command ledger](validation-results.json). Old and new reward artifacts are retained in before-artifacts/ and after-artifacts/. The report can be regenerated with `node scripts/benchmarks/scalability/capacity-report.js <this-run-directory>` into a fresh copy (exclusive writes protect existing reports).'
);
fs.writeFileSync(path.join(out,'report.md'),lines.join('\n')+'\n',{flag:'wx'});
console.log(path.join(out,'report.md'));

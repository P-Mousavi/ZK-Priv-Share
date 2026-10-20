const fs = require('fs');
const path = require('path');
const { outputDir, write, csv, stats } = require('./common');

const ROOT = path.resolve(__dirname, '../../..');
const baselinePath = process.env.BASELINE_TRANSACTION_GAS || path.join(ROOT, 'benchmark-results/comparative/operation-gas-finalized/baseline-transaction-gas.json');
const hhPath = process.env.HH_TRANSACTION_GAS || path.join(ROOT, 'benchmark-results/comparative/history-hiding-transaction-gas/canonical-lifecycle-real-proof.json');
const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
const hh = JSON.parse(fs.readFileSync(hhPath, 'utf8'));

const BASELINE_REVISION = 'df954fd862862e65a2e66af3a18d1526d78bfd7e';
const HH_REVISION = '2a109868533d7dd92737bc3911b108a9559e5b38';
const candidates = [
  { key: 'ctiPublication', baseline: 'ctiPublication', hh: 'ctiPublicationGas', hhMethod: 'AnonymousCtiAccess.publishCti', status: 'partial', note: 'Baseline stores producer address, CIDs, fees and delegates; History-Hiding verifies a state proof and publishes commitments/root. Producer exposure, policy and stored state differ.', baselineStorage: 'ctiCounter/ctiShares with producer, CIDs, fees and delegates; CtiShared event.', hhStorage: 'publishedCti and PrivateStateTree root/nullifier; AnonymousCtiPublished event.' },
  { key: 'accessRequest', baseline: 'accessRequest', hh: 'accessRequestGas', hhMethod: 'AnonymousCtiAccess.requestAccess', status: 'partial', note: 'Baseline allocates an eligible delegate after access-level policy checks; History-Hiding verifies anonymous identity proof and stores opaque request commitments, without equivalent delegate/policy checks.', baselineStorage: 'requestCounter/accessRequests with consumer, allocated delegate and access level; RequestCreated event.', hhStorage: 'request commitment and used nullifier; AnonymousAccessRequested event.' },
  { key: 'responseDelivery', baseline: 'responseDeliveryAndPayment', hh: 'deliveryGas', hhMethod: 'AnonymousCtiAccess.recordDelivery', status: 'partial', note: 'Baseline response updates request state and transfers producer/delegate fees; History-Hiding delivery records a commitment only. Excludes acknowledgement, measured separately.', baselineStorage: 'response CID and Responded status; ResponseProvided event and direct transfers.', hhStorage: 'delivery commitment and delivered flag; AnonymousAccessDelivered event.' },
  { key: 'disputeReporting', baseline: 'disputeReporting', hh: 'disputeReportingGas', hhMethod: 'AnonymousCtiAccess.raiseDispute', status: 'partial', note: 'Baseline requires an involved party and CID evidence while History-Hiding uses opaque commitments and nullifiers.', baselineStorage: 'Dispute record with party addresses/reason/evidence CID; DisputeRaised event.', hhStorage: 'disputed flag and nullifier/request commitment mapping; AnonymousDisputeRaised event.' },
  { key: 'disputeNonThresholdVote', baseline: 'disputeNonThresholdVote', hh: 'disputeNonThresholdVoteGas', hhMethod: 'AnonymousDisputeResolver.vote', status: 'partial', note: 'Authorization, proposal encoding and economic enforcement differ.', baselineStorage: 'hasVoted and totalVotes/votesForGuilty; VotedOnDispute event.', hhStorage: 'manager vote and malicious vote count; AnonymousDisputeVote event.' },
  { key: 'disputeThresholdResolutionVote', baseline: 'disputeThresholdResolutionVote', hh: 'disputeThresholdResolutionVoteGas', hhMethod: 'AnonymousDisputeResolver.vote', status: 'partial', note: 'History-Hiding forwards malicious outcome to a separate proof-gated stake update; that update does not transfer or burn deposited ETH.', baselineStorage: 'closes dispute and invokes IdentityContract deposit transfer; DisputeSettled event.', hhStorage: 'resolved/dispute state and threshold event; forwards outcome to AnonymousSlashing.' }
];

const hhOnly = [
  ['receptionAcknowledgement', 'AnonymousCtiAccess.recordReceptionAcknowledgement', 'receptionAcknowledgementGas', 'No baseline acknowledgement exists; recipient binding is unauthenticated in the PoC.', 'acknowledgement flag/commitment; AnonymousReceptionAcknowledged event.'],
  ['slashing', 'AnonymousSlashing.slash', 'slashingGas', 'No equivalent baseline anonymous proof-gated stake operation; no ETH transfer or burn.', 'used stake nullifier and stake registry balance; AnonymousStakeSlashed event.'],
  ['rewardNoteInsertion', 'ShieldedRewardTree.issueRewardNote', 'rewardInsertionGas', 'One fixed-denomination note per sample; no baseline note-insertion operation.', 'one note commitment appended; RewardNoteIssued event.'],
  ['rewardClaim', 'ShieldedRewardTree.claimReward', 'rewardClaimGas', 'One note per sample; baseline reward is paid during response delivery.', 'nullifier marked spent and one denomination transferred; RewardClaimed event.']
].map(([operation, method, metric, caveat, storage]) => ({ operation, method, contract: method.split('.')[0], samples: hh.rawTransactionGasSamples[metric], statistics: hh.metrics[metric], caveat, storage }));

const baselineRows = baseline.operations;
const operationRows = [
  ...candidates.map((candidate) => {
    const b = baselineRows.find((row) => row.operation === candidate.baseline);
    const hSamples = hh.rawTransactionGasSamples[candidate.hh];
    return {
      operation: candidate.key,
      baseline: { architecture: 'baseline-priv-share', revision: BASELINE_REVISION, contract: b.contract, method: b.method, scenario: b.scenario, storageAndEvents: candidate.baselineStorage, sampleCount: b.sampleCount, samples: b.transactionGasSamples, statistics: b.statistics },
      historyHiding: { architecture: 'history-hiding', revision: HH_REVISION, contract: candidate.hhMethod.split('.')[0], method: candidate.hhMethod.split('.')[1], verifierType: 'production Groth16 verifier', proofType: 'generated Groth16', scenario: hh.scenario, storageAndEvents: candidate.hhStorage, sampleCount: hSamples.length, samples: hSamples, statistics: stats(hSamples) },
      comparability: candidate.status,
      deltaGas: null,
      overheadPercent: null,
      caveat: candidate.note
    };
  }),
  ...hhOnly.map((row) => ({
    operation: row.operation,
    baseline: null,
    historyHiding: { architecture: 'history-hiding', revision: HH_REVISION, contract: row.contract, method: row.method.split('.')[1], verifierType: 'production Groth16 verifier', proofType: 'generated Groth16', scenario: hh.scenario, storageAndEvents: row.storage, sampleCount: row.samples.length, samples: row.samples, statistics: row.statistics },
    comparability: 'no baseline equivalent', deltaGas: null, overheadPercent: null, caveat: row.caveat
  }))
];

const baselineWorkflowSamples = baselineRows.find((row) => row.operation === 'ctiPublication').transactionGasSamples.map((v, i) =>
  v + baselineRows.find((row) => row.operation === 'accessRequest').transactionGasSamples[i] +
  baselineRows.find((row) => row.operation === 'credentialSubmission').transactionGasSamples[i] +
  baselineRows.find((row) => row.operation === 'responseDeliveryAndPayment').transactionGasSamples[i]);
const workflow = {
  definition: 'Baseline aggregate is shareCti + initialRequest + provideCredentials + provideResponse. History-Hiding aggregate is publishCti + requestAccess + recordDelivery + recordReceptionAcknowledgement. These endpoints differ in policy checks, recipient binding and payment, so aggregate is descriptive only and not an overhead pair.',
  baseline: { samples: baselineWorkflowSamples, statistics: stats(baselineWorkflowSamples) },
  historyHiding: { samples: hh.rawTransactionGasSamples.ctiPublicationGas.map((v, i) => v + hh.rawTransactionGasSamples.accessRequestGas[i] + hh.rawTransactionGasSamples.deliveryGas[i] + hh.rawTransactionGasSamples.receptionAcknowledgementGas[i]), statistics: stats(hh.rawTransactionGasSamples.ctiPublicationGas.map((v, i) => v + hh.rawTransactionGasSamples.accessRequestGas[i] + hh.rawTransactionGasSamples.deliveryGas[i] + hh.rawTransactionGasSamples.receptionAcknowledgementGas[i])) },
  comparability: 'not equivalent; no delta or overhead calculated'
};

write('operations.json', {
  schemaVersion: 1,
  revisions: { baseline: BASELINE_REVISION, historyHiding: HH_REVISION, measuredBranchHead: baseline.provenance.historyHidingRevision },
  environment: { network: 'Hardhat in-memory EVM', chainId: 31337, solidity: '0.8.20', optimizer: { enabled: true, runs: 200 }, viaIR: false },
  proofVerifier: 'production generated Solidity Groth16 verifiers; no mock verifiers in the History-Hiding transaction samples',
  operations: operationRows,
  additionalWorkflow: workflow,
  notes: [
    'All transaction gas comes from successful receipts. Setup/deployment is excluded from operation gas.',
    'Proof verification is included in transactions whose methods verify proofs; it is not added again.',
    'Reward note insertion and claim each process one note.',
    'History-Hiding Groth16 proofs do not enforce complete identity membership: the current identity circuit has an unconstrained root equality.',
    'No baseline-to-History-Hiding operation is classified as fully equivalent, so no overhead percentages are calculated.',
    'The History-Hiding PoC slashing path updates recorded stake but does not transfer or burn the deposited ETH.',
    'No automatic cryptographic link ties a specific CTI publication to reward eligibility.'
  ]
});

const rows = operationRows.flatMap((row) => [
  ...(row.baseline ? [{ operation: row.operation, architecture: row.baseline.architecture, method: row.baseline.method, revision: row.baseline.revision, sampleCount: row.baseline.sampleCount, samples: row.baseline.samples, stats: row.baseline.statistics, comparability: row.comparability, caveat: row.caveat }] : []),
  { operation: row.operation, architecture: row.historyHiding.architecture, method: row.historyHiding.method, revision: row.historyHiding.revision, sampleCount: row.historyHiding.sampleCount, samples: row.historyHiding.samples, stats: row.historyHiding.statistics, comparability: row.comparability, caveat: row.caveat }
]);
write('operations.csv', csv(['operation', 'architecture', 'method', 'revision', 'sample_count', 'median_gas', 'mean_gas', 'min_gas', 'max_gas', 'population_stddev_gas', 'comparability', 'caveat'], rows.map((row) => [row.operation, row.architecture, row.method, row.revision, row.sampleCount, row.stats.median, row.stats.mean, row.stats.min, row.stats.max, row.stats.standardDeviation, row.comparability, row.caveat])));
// Candidate pairs are only partial. Keep a separately named measured-points file for plotting and an empty fully-comparable chart file.
write('measured-operation-points.csv', csv(['operation', 'architecture', 'median_transaction_gas', 'sample_count', 'revision'], rows.map((row) => [row.operation, row.architecture, row.stats.median, row.sampleCount, row.revision])));
write('chart-ready-comparable.csv', csv(['operation', 'architecture', 'median_transaction_gas', 'sample_count', 'revision'], []));
write('operation-comparison.csv', csv(['operation', 'baseline_median_gas', 'history_hiding_median_gas', 'absolute_difference', 'percentage_overhead', 'baseline_samples', 'history_hiding_samples', 'comparability'], operationRows.map((row) => [row.operation, row.baseline?.statistics.median ?? null, row.historyHiding.statistics.median, null, null, row.baseline?.sampleCount ?? null, row.historyHiding.sampleCount, row.comparability])));

const report = [
  '# Matched Priv-Share and History-Hiding transaction gas study', '',
  `Baseline revision: \`${BASELINE_REVISION}\`. History-Hiding revision: \`${HH_REVISION}\`; measured branch HEAD: \`${baseline.provenance.historyHidingRevision}\`. The protocol contracts/circuits/compiler config at current HEAD match the requested History-Hiding source revision.`, '',
  '## Summary', '',
  'Ten fresh deployments per architecture were used. History-Hiding samples used generated proofs and production Solidity verifiers. All measured pairs are partial comparisons because operation semantics differ; no operation is labeled equivalent and no overhead is computed. The chart-ready fully comparable dataset has a header and no rows. Measured values remain available in the operation tables for transparent thesis discussion.', '',
  '## Environment', '',
  'Hardhat in-memory EVM, chain ID 31337; Solidity 0.8.20; optimizer enabled with 200 runs; viaIR disabled. Transaction gas is `receipt.gasUsed`; deployment/setup is excluded. Proof verification gas is already included in proof-verifying transactions. Local EVM gas is not a direct prediction of public-chain transaction fees.', '',
  '## Operation comparison', '',
  '| Operation | Baseline method (median; n) | History-Hiding method (median; n) | Status | Delta / overhead |', '|---|---:|---:|---|---|',
  ...candidates.map((c) => { const r = operationRows.find((x) => x.operation === c.key); return `| ${c.key} | ${r.baseline.method} (${r.baseline.statistics.median}; ${r.baseline.sampleCount}) | ${r.historyHiding.method} (${r.historyHiding.statistics.median}; ${r.historyHiding.sampleCount}) | partial | N/A |`; }), '',
  'Each raw sample and full descriptive statistics (median, mean, minimum, maximum, population standard deviation) are in operations.json and operations.csv. Publication exposes different data and performs a state proof in History-Hiding; access-request policy and authorization differ; baseline response transfers payment while History-Hiding delivery records a commitment; disputes use different authorization and enforcement.', '',
  '## History-Hiding operations without a baseline equivalent', '',
  '| Operation | Method | Samples | Median gas | Mean gas | Min–max gas | Population SD |', '|---|---|---:|---:|---:|---:|---:|',
  ...hhOnly.map((r) => `| ${r.operation} | ${r.method} | ${r.samples.length} | ${r.statistics.median} | ${r.statistics.mean.toFixed(2)} | ${r.statistics.min}–${r.statistics.max} | ${r.statistics.standardDeviation.toFixed(2)} |`), '',
  'Each note insertion and each claim handles exactly one reward note. Reward note issuance and claiming are separate transactions; the complete reward uses multiple fixed-denomination notes where required. There is no automatic cryptographic link between a particular CTI and reward eligibility.', '',
  '## Aggregate workflows', '',
  `Baseline publication-through-response workflow median: ${workflow.baseline.statistics.median} gas (n=${workflow.baseline.statistics.count}). History-Hiding publication-through-acknowledgement workflow median: ${workflow.historyHiding.statistics.median} gas (n=${workflow.historyHiding.statistics.count}). These aggregates have different authorization, policy, acknowledgement and payment behavior; no delta or overhead is valid.`, '',
  '## Limits and threats to validity', '',
  '- History-Hiding identity proof circuit does not constrain Merkle root equality, so the benchmark does not establish complete identity-membership enforcement.',
  '- Reception acknowledgement does not authenticate recipient binding in the current PoC.',
  '- Slashing updates recorded stake but does not transfer or burn deposited ETH.',
  '- Dispute resolution and response payments are economically different across architectures.',
  '- No automatic cryptographic link ties a specific CTI to reward eligibility.',
  '- Sample fixtures, tree sizes, and role counts are fixed. These are local EVM measurements and do not establish protocol security, anonymity, or unlinkability.',
  '- Candidate operation pairs are partial, not truly equivalent. `chart-ready-comparable.csv` intentionally contains no invented zero or unmatched bars.', ''
];
write('report.md', report.join('\n'));
console.log(`Wrote operation comparison artifacts for ${operationRows.length} operations to ${outputDir()}`);

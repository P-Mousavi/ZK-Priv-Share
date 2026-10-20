const fs = require('fs');
const path = require('path');
const { outputDir, write, csv, difference } = require('./common');

function main() {
  const read = (name) => JSON.parse(fs.readFileSync(path.join(outputDir(), name)));
  const deployment = read('deployment.json'), offchain = read('offchain.json'), baseline = read('baseline-operations.json');
  const operationStudy = JSON.parse(fs.readFileSync(path.join(outputDir(), 'operation-report/operations.json')));
  const [b, h] = deployment.architectures;
  const change = difference(b.totalDeploymentGas, h.totalDeploymentGas, true);
  const comparisons = [{ metric: 'totalDeploymentGas', scope: 'Cost of each complete explicitly defined architecture, with different privacy/features', baseline: b.totalDeploymentGas, historyHiding: h.totalDeploymentGas, ...change }];
  write('comparison.json', { schemaVersion: 1, comparisons, offchainPercentageOverhead: null,
    reason: 'Original baseline contains no off-chain client or proofs. EVM simulation and Groth16 proving have different semantics and execution environments.' });
  write('comparison.csv', csv(['metric', 'scope', 'baseline', 'history_hiding', 'absolute_difference', 'percentage_change', 'direction'], comparisons.map((c) => [c.metric, c.scope, c.baseline, c.historyHiding, c.absolute, c.percentage, c.direction])));
  const operationRows = operationStudy.operations.map((row) => ({ operation: row.operation, baselineMedianGas: row.baseline?.statistics.median ?? null,
    historyHidingMedianGas: row.historyHiding.statistics.median, absoluteDifference: row.deltaGas, percentageOverhead: row.overheadPercent,
    baselineSamples: row.baseline?.sampleCount ?? null, historyHidingSamples: row.historyHiding.sampleCount, comparability: row.comparability }));
  write('operation-comparison.json', { schemaVersion: 1, operations: operationRows, additionalWorkflow: operationStudy.additionalWorkflow, notes: operationStudy.notes });
  write('operation-comparison.csv', csv(['operation', 'baseline_median_gas', 'history_hiding_median_gas', 'absolute_difference', 'percentage_overhead', 'baseline_samples', 'history_hiding_samples', 'comparability'],
    operationRows.map((row) => [row.operation, row.baselineMedianGas, row.historyHidingMedianGas, row.absoluteDifference, row.percentageOverhead, row.baselineSamples, row.historyHidingSamples, row.comparability])));
  const plottedRows = operationStudy.operations.filter((row) => row.comparability === 'comparable');
  write('operation-chart.csv', csv(['operation', 'architecture', 'median_transaction_gas', 'sample_count', 'revision'], plottedRows.flatMap((row) => [
    [row.operation, row.baseline.architecture, row.baseline.statistics.median, row.baseline.sampleCount, row.baseline.revision],
    [row.operation, row.historyHiding.architecture, row.historyHiding.statistics.median, row.historyHiding.sampleCount, row.historyHiding.revision]
  ])));
  const lines = ['# Original Priv-Share vs canonical History-Hiding benchmarks', '',
    `Baseline revision: \`${deployment.provenance.baselineRevision}\`. History-Hiding revision: \`${deployment.provenance.historyHidingRevision}\`; working-tree hashes/status are recorded in JSON.`, '',
    '## Deployment', '', '| Architecture | Contracts (including nested) | Deployment transactions | Deployment gas | Initialization gas (excluded) |', '|---|---:|---:|---:|---:|',
    ...deployment.architectures.map((a) => `| ${a.architecture} | ${a.contractCount} | ${a.deploymentTransactionCount} | ${a.totalDeploymentGas} | ${a.initializationGas} |`), '',
    `Complete-architecture deployment cost: **${change.direction}** of ${change.absolute} gas (${change.percentage.toFixed(2)}%). This compares the actual required sets, which provide different privacy guarantees and features; it does not isolate a single state-transition feature. One deployment sample per architecture.`, '',
    '| Architecture | Contract | Deployment gas | Actual runtime bytes | Creation bytes |', '|---|---|---:|---:|---:|',
    ...deployment.architectures.flatMap((a) => a.contracts.map((c) => `| ${a.architecture} | ${c.name} | ${c.deploymentGas ?? `included in ${c.deploymentGasIncludedIn}`} | ${c.runtimeBytes} | ${c.creationBytes} |`)), '',
    'Each row is part of its architecture aggregate. IdentityTree is constructor-created; its gas is already in ZKIdentity. Shared libraries are deployed once per architecture. Separate initialization and registration are excluded. Actual runtime was read from every address, including IdentityTree, and checked against 24,576 bytes. This is a runtime size check, not a claim about every deployment constraint.', '',
    'Both architectures use the same compiler configuration: ' + JSON.stringify(b.contracts[0].compiler) + '.', '',
    '## Computation', '',
    '| Circuit/operation | Baseline local EVM call median ms | Witness median ms | Proving median ms | Combined median ms | Trials | Compact proof JSON median bytes | Solidity proof bytes | Peak full worker RSS median MiB |',
    '|---|---:|---:|---:|---:|---:|---:|---:|---:|',
    ...offchain.results.map((r) => {
      const baselineResult = baseline.results.find((v) => v.circuit === r.circuit);
      const m = r.metrics;
      const number = (value) => value == null ? 'unavailable' : value.toFixed(3);
      return `| ${r.circuit} | ${number(baselineResult?.localEvmCallMs.median)} | ${number(m.witnessMs?.median)} | ${number(m.proveMs?.median)} | ${number(m.combinedMs?.median)} | ${m.combinedMs?.count ?? 0} | ${m.proofJsonBytes?.median ?? 'unavailable'} | ${m.proofSolidityBytes?.median ?? 'unavailable'} | ${number(m.peakWorkerRssBytes ? m.peakWorkerRssBytes.median / 1048576 : null)} |`;
    }), '',
    'The baseline column above measures available original Solidity operations through local eth_call, including ethers/provider/EVM work. It is neither off-chain client execution nor proof generation. No time difference or percentage is calculated between that column and proving. Original baseline rating, membership proofs, and shielded reward claims do not exist.', '',
    '## Transaction gas by operation', '',
    'Gas values come from successful transaction receipts. Baseline and History-Hiding use ten fresh deployments each. History-Hiding rows use generated proofs and production Groth16 verifiers. Proof verification is already included in transaction gas. The operation-level pairs are partial because protocol behavior differs; no percentage overhead is calculated.', '',
    '| Operation | Baseline median gas (n) | History-Hiding median gas (n) | Classification | Δ / overhead |', '|---|---:|---:|---|---|',
    ...operationStudy.operations.filter((r) => r.baseline).map((r) => `| ${r.operation} | ${r.baseline.statistics.median} (${r.baseline.sampleCount}) | ${r.historyHiding.statistics.median} (${r.historyHiding.sampleCount}) | ${r.comparability} | N/A |`), '',
    '| History-Hiding operation without baseline equivalent | Method | Median gas (n) |', '|---|---|---:|',
    ...operationStudy.operations.filter((r) => !r.baseline).map((r) => `| ${r.operation} | ${r.historyHiding.method} | ${r.historyHiding.statistics.median} (${r.historyHiding.sampleCount}) |`), '',
    'Baseline response delivery stores a response CID and transfers producer/delegate fees. History-Hiding delivery records an opaque commitment; its reception acknowledgement is a separate transaction and lacks recipient authentication. Baseline dispute voting is address-authorized and immediately settles deposits; History-Hiding uses opaque dispute records and a separate proof-gated stake update, which currently does not transfer or burn ETH. Baseline rewards are coupled to response payments; History-Hiding inserts and claims fixed-denomination notes separately, one note per measured insertion and claim.', '',
    `Aggregate workflows are descriptive only: ${operationStudy.additionalWorkflow.baseline.statistics.median} baseline gas versus ${operationStudy.additionalWorkflow.historyHiding.statistics.median} History-Hiding gas (n=10 each). The aggregate endpoints differ, so no aggregate delta or overhead is valid. The fully comparable chart dataset is empty; measured points are in operation-report/measured-operation-points.csv.`, '',
    'Raw per-transaction samples and mean, median, min, max, and population standard deviation are in operation-report/operations.json and operations.csv. Chart-ready data contains measured values only and no synthetic zero bars.', '',
    'Witness timings include WASM reads and witness writes; proving includes key/witness reads. Input preparation, process startup, serialization, and verification are excluded from those stage timings. Combined time covers contiguous witness/proving stages. workerWallMs separately includes startup, verification, serialization, and IPC. Fresh process per trial, one unmeasured warm-up, repeated fixed generated fixtures. Compilation and trusted setup are excluded. JSON records mean, median, min, max, population standard deviation, raw samples, artifact hashes and host/tool versions.', '',
    '## Limitations and validation', '',
    '- No operation pair is fully equivalent; do not infer overhead from partial comparisons or from legacy ZKData results.',
    '- The History-Hiding PoC does not fully enforce identity membership, does not authenticate recipient binding in acknowledgements, does not transfer or burn slashed ETH, and does not cryptographically link a particular CTI to reward eligibility.',
    '- Matched off-chain CTI, credential/policy, and reward computation measurements are unavailable. These metrics are null rather than zero; local EVM timings and proving costs are reported separately.',
    '- The canonical identity circuit intentionally leaves Merkle root equality unconstrained. These are measurements of the existing proof workflow, not evidence of enforced identity membership. No security checks were altered.',
    '- Peak RSS uses OS maxRSS for each complete worker, including local verification; it cannot be attributed solely to proving or to individual stages. Unsupported hosts omit it.',
    '- Fixed fixtures measure repeated proving cost, not a distribution across CTI sizes, tree sizes, or lifecycle workloads. CPU scheduling/cache effects remain; timings are sequential on the recorded host.',
    '- Local demonstration trusted-setup artifacts are reused, not regenerated; artifact hashes identify the exact measured set. Generated proofs are checked locally and against production Solidity verifiers, with malformed-proof rejection recorded in verification.json.',
    '- Existing canonical result files are preserved. execution.json and logs record actual commands, exit codes and dataset-preservation checks. The intermediate merely-ZK architecture is excluded.',
    '- The protocol minimizes semantic/application history; the blockchain still retains roots, proofs, nullifiers and transaction metadata.', ''];
  write('report.md', lines.join('\n'));
  console.log('Comparative JSON/CSV and report generated; no fully equivalent operation pair is charted.');
}
if (require.main === module) main();
module.exports = main;

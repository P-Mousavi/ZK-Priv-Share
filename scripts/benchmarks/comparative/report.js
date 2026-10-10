const fs = require('fs');
const path = require('path');
const { outputDir, write, csv, difference } = require('./common');

function main() {
  const read = (name) => JSON.parse(fs.readFileSync(path.join(outputDir(), name)));
  const deployment = read('deployment.json'), offchain = read('offchain.json'), baseline = read('baseline-operations.json');
  const [b, h] = deployment.architectures;
  const change = difference(b.totalDeploymentGas, h.totalDeploymentGas, true);
  const comparisons = [{ metric: 'totalDeploymentGas', scope: 'Cost of each complete explicitly defined architecture, with different privacy/features', baseline: b.totalDeploymentGas, historyHiding: h.totalDeploymentGas, ...change }];
  write('comparison.json', { schemaVersion: 1, comparisons, offchainPercentageOverhead: null,
    reason: 'Original baseline contains no off-chain client or proofs. EVM simulation and Groth16 proving have different semantics and execution environments.' });
  write('comparison.csv', csv(['metric', 'scope', 'baseline', 'history_hiding', 'absolute_difference', 'percentage_change', 'direction'], comparisons.map((c) => [c.metric, c.scope, c.baseline, c.historyHiding, c.absolute, c.percentage, c.direction])));
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
    'The baseline column measures available original Solidity operations through local eth_call, including ethers/provider/EVM work. It is neither off-chain client execution nor proof generation. No time difference or percentage is calculated between that column and proving. Original baseline rating, membership proofs, and shielded reward claims do not exist. Baseline CTI publication stores CIDs/fees/delegates; baseline rewards accompany response delivery; canonical state proofs and shielded claims have different semantics and inputs.', '',
    'Witness timings include WASM reads and witness writes; proving includes key/witness reads. Input preparation, process startup, serialization, and verification are excluded from those stage timings. Combined time covers contiguous witness/proving stages. workerWallMs separately includes startup, verification, serialization, and IPC. Fresh process per trial, one unmeasured warm-up, repeated fixed generated fixtures. Compilation and trusted setup are excluded. JSON records mean, median, min, max, population standard deviation, raw samples, artifact hashes and host/tool versions.', '',
    '## Limitations and validation', '',
    '- The user confirmed that neither proof-of-concept implements actual off-chain CTI processing. Matched off-chain CTI, credential/policy, and reward computation measurements are unavailable by design. These metrics are null rather than zero; local EVM timings and proving costs are reported separately.',
    '- The canonical identity circuit intentionally leaves Merkle root equality unconstrained. These are measurements of the existing proof workflow, not evidence of enforced identity membership. No security checks were altered.',
    '- Peak RSS uses OS maxRSS for each complete worker, including local verification; it cannot be attributed solely to proving or to individual stages. Unsupported hosts omit it.',
    '- Fixed fixtures measure repeated proving cost, not a distribution across CTI sizes, tree sizes, or lifecycle workloads. CPU scheduling/cache effects remain; timings are sequential on the recorded host.',
    '- Local demonstration trusted-setup artifacts are reused, not regenerated; artifact hashes identify the exact measured set. Generated proofs are checked locally and against production Solidity verifiers, with malformed-proof rejection recorded in verification.json.',
    '- Existing canonical result files are preserved. execution.json and logs record actual commands, exit codes and dataset-preservation checks. The intermediate merely-ZK architecture is excluded.',
    '- The protocol minimizes semantic/application history; the blockchain still retains roots, proofs, nullifiers and transaction metadata.', ''];
  write('report.md', lines.join('\n'));
  console.log('Comparative JSON/CSV and report generated; off-chain CTI measurements are unavailable in both proofs of concept.');
}
if (require.main === module) main();
module.exports = main;

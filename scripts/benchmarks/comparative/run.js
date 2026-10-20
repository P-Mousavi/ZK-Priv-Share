const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { ROOT, outputDir, write, sha256, environment, provenance } = require('./common');

function preservedFiles() {
  const result = {};
  // A comparative run nested in a new capacity report must exclude that
  // active report directory (its logs change while this process runs).
  const scalabilityRoot = path.join(ROOT, 'benchmark-results/history-hiding/scalability');
  const activeRelative = process.env.COMPARATIVE_OUT && path.relative(scalabilityRoot, path.resolve(process.env.COMPARATIVE_OUT));
  const activeCapacityRun = activeRelative && !activeRelative.startsWith('..') && !path.isAbsolute(activeRelative)
    ? path.join(scalabilityRoot, activeRelative.split(path.sep)[0]) : null;
  const visit = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (file === activeCapacityRun) continue;
      if (process.env.COMPARATIVE_OUT && file === path.resolve(process.env.COMPARATIVE_OUT)) continue;
      if (entry.isDirectory()) visit(file);
      else result[path.relative(ROOT, file)] = sha256(file);
    }
  };
  // Excludes ONLY the new comparative runs; includes legacy and canonical datasets.
  for (const entry of fs.readdirSync(path.join(ROOT, 'benchmark-results'), { withFileTypes: true })) {
    if (entry.name === 'comparative') continue;
    const file = path.join(ROOT, 'benchmark-results', entry.name);
    if (entry.isDirectory()) visit(file);
    else result[path.relative(ROOT, file)] = sha256(file);
  }
  return result;
}
async function main() {
  if (!process.env.COMPARATIVE_OUT) process.env.COMPARATIVE_OUT = path.join(ROOT, 'benchmark-results/comparative', new Date().toISOString().replaceAll(':', '-') + `-${process.pid}`);
  const out = outputDir();
  if (fs.readdirSync(out).length) throw new Error('Output directory is not empty; refusing to overwrite a prior run.');
  const before = preservedFiles(), commands = [];
  write('manifest.json', { schemaVersion: 1, startedAt: new Date().toISOString(), provenance: provenance(), environment: environment(),
    requestedTrials: Number(process.env.COMPARATIVE_TRIALS || 20), preservedResultSha256: before });
  const steps = [
    ['compile', [path.join(ROOT, 'node_modules/hardhat/internal/cli/cli.js'), 'compile']],
    ['deployment', [path.join(ROOT, 'node_modules/hardhat/internal/cli/cli.js'), 'run', '--no-compile', 'scripts/benchmarks/comparative/deployment.js']],
    ['baseline-transaction-gas', [path.join(ROOT, 'node_modules/hardhat/internal/cli/cli.js'), 'run', '--no-compile', 'scripts/benchmarks/comparative/baseline-transaction-gas.js']],
    ['history-hiding-transaction-gas', [path.join(ROOT, 'node_modules/hardhat/internal/cli/cli.js'), 'test', '--no-compile', 'test/benchmarks/HistoryHidingLifecycleRealProof.bench.js']],
    ['baseline-operations', [path.join(ROOT, 'node_modules/hardhat/internal/cli/cli.js'), 'run', '--no-compile', 'scripts/benchmarks/comparative/baseline-operations.js']],
    ['offchain', ['scripts/benchmarks/comparative/offchain.js']],
    ['verification', [path.join(ROOT, 'node_modules/hardhat/internal/cli/cli.js'), 'run', '--no-compile', 'scripts/benchmarks/comparative/verify.js']],
    ['operations-report', ['scripts/benchmarks/comparative/operations-report.js']],
    ['report', ['scripts/benchmarks/comparative/report.js']]
  ];
  let failure = null;
  for (const [name, args] of steps) {
    console.log(`Running ${name}; log: ${path.join(out, name + '.log')}`);
    const log = fs.openSync(path.join(out, name + '.log'), 'wx');
    const startedAt = new Date().toISOString();
    const exitCode = await new Promise((resolve, reject) => {
      const childEnv = { ...process.env };
      if (name === 'history-hiding-transaction-gas') childEnv.HH_COMPARATIVE_OUT = path.join(out, 'history-hiding-transaction-gas');
      if (name === 'operations-report') {
        childEnv.COMPARATIVE_OUT = path.join(out, 'operation-report');
        childEnv.BASELINE_TRANSACTION_GAS = path.join(out, 'baseline-transaction-gas.json');
        childEnv.HH_TRANSACTION_GAS = path.join(out, 'history-hiding-transaction-gas', 'canonical-lifecycle-real-proof.json');
      }
      const child = spawn(process.execPath, args, { cwd: ROOT, env: childEnv, stdio: ['ignore', log, log] });
      child.on('error', reject); child.on('exit', (code) => resolve(code));
    });
    fs.closeSync(log);
    commands.push({ name, executable: process.execPath, arguments: args, startedAt, endedAt: new Date().toISOString(), exitCode, log: name + '.log' });
    if (exitCode !== 0) { failure = `${name} failed (exit ${exitCode})`; break; }
  }
  const after = preservedFiles();
  const preserved = JSON.stringify(before) === JSON.stringify(after);
  write('execution.json', { schemaVersion: 1, commands, success: !failure && preserved,
    canonicalAndLegacyResultsPreserved: preserved, completedAt: new Date().toISOString(), failure,
    matchedBaselineOffchainComparisonComplete: false, limitation: 'User confirms neither proof-of-concept implements actual off-chain CTI processing; no matched operation exists.' });
  if (failure || !preserved) throw new Error(failure || 'Existing datasets changed during benchmark execution');
  console.log(`Results: ${out}`);
}
main().catch((error) => { console.error(error); process.exitCode = 1; });

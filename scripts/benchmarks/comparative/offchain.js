const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { write, csv, stats, CIRCUITS, artifactDir, sha256, environment, provenance } = require('./common');

async function main() {
  const trials = Number(process.env.COMPARATIVE_TRIALS || 20);
  if (!Number.isInteger(trials) || trials < 1) throw new Error('COMPARATIVE_TRIALS must be a positive integer');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'priv-share-comparative-proving-'));
  const results = [], failures = [];
  try {
    for (const circuit of CIRCUITS) {
      const dir = artifactDir(circuit);
      const artifacts = Object.fromEntries(['input.json', `${circuit}.wasm`, `${circuit}.zkey`, `${circuit}.r1cs`, 'verification_key.json'].map((name) => {
        const file = path.join(dir, name);
        return [name, { sha256: sha256(file), bytes: fs.statSync(file).size }];
      }));
      const samples = [];
      let lastProof = null;
      // One complete unmeasured warm-up; all measured trials use fresh workers.
      for (let trial = -1; trial < trials; trial++) {
        const start = process.hrtime.bigint();
        try {
          const { stdout } = await promisify(execFile)(process.execPath, [path.join(__dirname, 'proving-worker.js'), circuit, path.join(temp, `${circuit}.wtns`)], { maxBuffer: 4 * 1024 * 1024, timeout: 300000 });
          const sample = JSON.parse(stdout);
          lastProof = { proof: sample.proof, publicSignals: sample.publicSignals };
          delete sample.proof; delete sample.publicSignals;
          if (trial >= 0) samples.push({ trial, ...sample, workerWallMs: Number(process.hrtime.bigint() - start) / 1e6 });
        } catch (error) {
          failures.push({ circuit, trial, success: false, error: error.message });
          break;
        }
      }
      const metrics = {};
      if (samples.length) for (const metric of ['witnessMs', 'proveMs', 'combinedMs', 'serializationMs', 'proofJsonBytes', 'proofSolidityBytes', 'workerWallMs', 'peakWorkerRssBytes']) {
        metrics[metric] = samples.every((s) => s[metric] !== null) ? stats(samples.map((s) => s[metric])) : null;
      }
      results.push({ circuit, operation: circuit === 'state' ? 'NONEXISTENT -> SUBMITTED with identity/stake/accountability witnesses' : circuit,
        success: samples.length === trials, artifacts, metrics, samples });
      if (lastProof) write(`proof-${circuit}.json`, lastProof);
      console.log(`${circuit}: ${samples.length}/${trials} trials${metrics.combinedMs ? `, combined median ${metrics.combinedMs.median.toFixed(2)} ms` : ''}`);
    }
    write('offchain.json', { schemaVersion: 1, provenance: provenance(), environment: environment(), requestedTrials: trials,
      definitions: { inputPreparation: 'Fixed generated input fixtures, read and parsed before stage timing; SHA-256 recorded. No varied-input population claim.',
        witnessMs: 'snarkjs.wtns.calculate including WASM loading and witness file write.',
        proveMs: 'snarkjs.groth16.prove including witness/key file reads; excludes verification and proof serialization.',
        combinedMs: 'Contiguous witness generation plus proving in the same worker.',
        workerWallMs: 'Process startup, module loading, input read, witness/prove, serialization, local verification and IPC.',
        proofJsonBytes: 'UTF-8 compact JSON proof only, excluding public signals; size may vary with randomized coordinates.',
        proofSolidityBytes: 'Eight uncompressed BN254 coordinates, 32 bytes each; excludes public signals and ABI envelope.',
        peakWorkerRssBytes: 'OS process.resourceUsage().maxRSS for fresh worker, INCLUDING startup and local verification; not stage memory or sampled RSS. Null on unsupported OS.',
        statistics: 'Population standard deviation; arithmetic median (average middle pair for even counts).',
        setup: 'Compilation, ceremony, proving-key generation and fixture creation excluded. One unmeasured warm-up per circuit. Default snarkjs threading.',
        baseline: 'No baseline off-chain client exists at audited revision. Local EVM simulation is recorded separately; no matched off-chain overhead inferred.' }, results, failures });
    write('offchain.csv', csv(['circuit', 'success', 'metric', 'samples', 'median', 'mean', 'min', 'max', 'population_stddev'], results.flatMap((r) => Object.entries(r.metrics).map(([metric, s]) => [r.circuit, r.success, metric, s?.count, s?.median, s?.mean, s?.min, s?.max, s?.standardDeviation]))));
    if (failures.length) throw new Error('Proving failed; inspect offchain.json.');
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });

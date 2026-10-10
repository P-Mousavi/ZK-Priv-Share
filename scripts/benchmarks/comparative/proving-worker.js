const fs = require('fs');
const path = require('path');
const { groth16, wtns } = require('snarkjs');
const { artifactDir } = require('./common');

async function main() {
  const [circuit, witnessFile] = process.argv.slice(2);
  const dir = artifactDir(circuit);
  const input = JSON.parse(fs.readFileSync(path.join(dir, 'input.json'), 'utf8'));
  const start = process.hrtime.bigint();
  await wtns.calculate(input, path.join(dir, `${circuit}.wasm`), witnessFile);
  const witnessEnd = process.hrtime.bigint();
  const { proof, publicSignals } = await groth16.prove(path.join(dir, `${circuit}.zkey`), witnessFile);
  const proveEnd = process.hrtime.bigint();
  const serialized = JSON.stringify(proof);
  const serializedEnd = process.hrtime.bigint();
  // Linux/macOS Node reports maxRSS in KiB. This covers the complete isolated
  // worker process, including module startup and validation, not a per-stage delta.
  const vk = JSON.parse(fs.readFileSync(path.join(dir, 'verification_key.json'), 'utf8'));
  if (!await groth16.verify(vk, publicSignals, proof)) throw new Error('Generated proof failed local verification');
  const result = { success: true, witnessMs: Number(witnessEnd - start) / 1e6,
    proveMs: Number(proveEnd - witnessEnd) / 1e6, combinedMs: Number(proveEnd - start) / 1e6,
    serializationMs: Number(serializedEnd - proveEnd) / 1e6, proofJsonBytes: Buffer.byteLength(serialized),
    proofSolidityBytes: 256, peakWorkerRssBytes: ['linux', 'darwin'].includes(process.platform) ? process.resourceUsage().maxRSS * 1024 : null,
    proof, publicSignals };
  process.stdout.write(JSON.stringify(result) + '\n', () => process.exit(0));
}
main().catch((error) => { console.error(error); process.exit(1); });

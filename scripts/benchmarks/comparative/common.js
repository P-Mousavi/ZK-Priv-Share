const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../../..');
const BASELINE = 'df954fd862862e65a2e66af3a18d1526d78bfd7e';
const CIRCUITS = ['identity', 'state', 'rating', 'slashing', 'reward'];
const VERIFIERS = { identity: 'Verifier', state: 'StateVerifier', rating: 'RatingVerifier', slashing: 'SlashingVerifier', reward: 'RewardVerifier' };
const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const artifactDir = (name) => path.join(ROOT, 'circuits/build/artifacts', name);
const outputDir = () => {
  if (!process.env.COMPARATIVE_OUT) throw new Error('Run npm run benchmark:comparative, or set COMPARATIVE_OUT to a NEW output directory.');
  const dir = path.resolve(process.env.COMPARATIVE_OUT);
  const allowed = ['benchmark-results/comparative', 'benchmark-results/history-hiding/scalability'].some(base => {
    const relative = path.relative(path.join(ROOT, base), dir);
    return relative && !relative.startsWith('..') && !path.isAbsolute(relative);
  });
  if (!allowed) throw new Error('Output must be a new comparative or History-Hiding scalability run subdirectory.');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};
function validate(value) {
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('Non-finite benchmark value');
  if (Array.isArray(value)) value.forEach(validate);
  else if (value && typeof value === 'object') Object.values(value).forEach(validate);
}
function write(name, value) {
  validate(value);
  fs.writeFileSync(path.join(outputDir(), name), typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
}
function stats(values) {
  if (!values.length) throw new Error('No samples');
  validate(values);
  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  const middle = Math.floor(values.length / 2);
  return { count: values.length, median: sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2,
    mean, min: sorted[0], max: sorted.at(-1), standardDeviation: Math.sqrt(values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length) };
}
function csv(headers, rows) {
  const cell = (v) => '"' + String(v ?? '').replaceAll('"', '""') + '"';
  return [headers, ...rows].map((row) => row.map(cell).join(',')).join('\n') + '\n';
}
function difference(baseline, history, comparable) {
  if (!comparable || baseline <= 0) return null;
  validate([baseline, history]);
  return { absolute: history - baseline, percentage: (history - baseline) / baseline * 100,
    direction: history > baseline ? 'increase' : history < baseline ? 'decrease' : 'unchanged' };
}
function receiptGas(receipt) {
  if (!receipt || Number(receipt.status) !== 1) throw new Error('Cannot record gas from an unsuccessful transaction receipt');
  const gasUsed = Number(receipt.gasUsed);
  if (!Number.isSafeInteger(gasUsed) || gasUsed <= 0) throw new Error('Transaction receipt has invalid gasUsed');
  return gasUsed;
}
function sourceManifest() {
  const files = [...new Set(git('ls-files', '--cached', '--others', '--exclude-standard', 'contracts', 'circuits', 'scripts', 'package.json', 'package-lock.json', 'hardhat.config.js').split('\n'))]
    .filter((file) => fs.existsSync(path.join(ROOT, file)));
  return Object.fromEntries(files.map((file) => [file, sha256(path.join(ROOT, file))]));
}
function environment() {
  let circom;
  for (const bin of [process.env.CIRCOM_BIN, path.join(os.homedir(), '.cargo/bin/circom'), 'circom'].filter(Boolean)) {
    try { circom = execFileSync(bin, ['--version'], { encoding: 'utf8' }).trim(); break; } catch (_) { /* try next executable */ }
  }
  return { cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, ramBytes: os.totalmem(),
    os: { type: os.type(), release: os.release(), architecture: os.arch() }, node: process.version,
    circom: circom || null, snarkjs: require(path.join(ROOT, 'node_modules/snarkjs/package.json')).version,
    hardhat: require('hardhat/package.json').version };
}
function provenance() {
  return { baselineRevision: BASELINE, historyHidingRevision: git('rev-parse', 'HEAD'),
    branch: git('branch', '--show-current'), workingTreeStatus: git('status', '--short'), sourceSha256: sourceManifest() };
}
module.exports = { ROOT, BASELINE, CIRCUITS, VERIFIERS, git, sha256, artifactDir, outputDir, write, stats, csv, difference, receiptGas, environment, provenance, validate };

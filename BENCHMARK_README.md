# Priv-Share Benchmarking Suite

This README covers two different benchmark groups: legacy Standard-vs-ZK/`ZKData` comparisons and the canonical History-hiding real-proof suite. Their results are separate and should not be compared as if they measured the same architecture. The canonical History-hiding suite is the production-verifier benchmark; several older suites use mock verifiers or illustrative estimates.

## CTI-to-reward linkability benchmark

Run the observer-model benchmark with:

```bash
npm run benchmark:linkability
```

It writes `benchmark-results/linkability-results.json` and evaluates the public chain evidence available to a passive observer: transaction senders, logs, event order, and public note denomination.

- Scenario A: the response transaction and delegate payment are synchronous, so the participant is directly observable.
- Scenario B: a relayed ZK response mints one deferred note, followed by unrelated events and a relayed ZK claim. Address reuse is removed, but one public denomination still produces a singleton candidate set.
- Scenario C: the response mints ten identical fixed-denomination notes before the deferred claim. The claim has ten same-denomination candidates, demonstrating the anonymity-set benefit.

The benchmark uses Hardhat's existing 20 local accounts; no account configuration change is required. It deploys an accept-all verifier only on the in-process Hardhat network so the benchmark measures event linkability without the cost and latency of generating Groth16 proofs. Production verification remains covered by the real reward-proof tests.

## Installation

```bash
npm install
```

## Running Benchmarks

### 1. Run Individual Legacy Phase Benchmarks

These phase-level commands measure the earlier Standard-vs-ZK and `ZKData` flows. They are useful for reproducing legacy comparisons, but they are not the canonical History-hiding benchmark suite. Some use testing-mode or accept-all verifiers; inspect each benchmark before treating its output as a production-proof measurement.

```bash
# Identity & Registration Phase
npx hardhat test test/benchmarks/IdentityPhase.bench.js

# Identity-registration scalability (10, 50, and 100 identities; 5 runs each)
npm run benchmark:identity-scalability

# Reward-note activity and candidate-set accumulation (low/medium/high activity)
npm run benchmark:reward-activity

# CTI Submission & Consumption Phase
npx hardhat test test/benchmarks/CTIPhase.bench.js

# Dispute & Regulation Phase
npx hardhat test test/benchmarks/DisputePhase.bench.js

# Reward Claiming Phase
npx hardhat test test/benchmarks/RewardPhase.bench.js

# Deployment Analysis
npx hardhat test test/benchmarks/Deployment.bench.js

# Direct Groth16 proof verification
npx hardhat test test/benchmarks/ProofVerification.bench.js

# Canonical History-hiding suite (real generated Groth16 proofs/verifiers;
# state, proof verification, state scale, reward insertion/claim, rating,
# slashing, and the complete canonical lifecycle)
npm run benchmark:history-hiding

# Legacy extended History-hiding microbenchmarks (uses mock/accept-all
# verifiers; not part of the canonical real-proof command above)
npm run benchmark:history-hiding:extended
```

### 2. Run All Benchmark Files

```bash
REPORT_GAS=1 npx hardhat test test/benchmarks/*.bench.js
```

**Note:** Set `REPORT_GAS=1` to enable Hardhat gas reporting. This glob runs legacy and History-hiding benchmark files, including the mock-verifier `HistoryHidingExtended` suite; it is not equivalent to the canonical real-proof command. Without the environment variable, the tests may still record transaction gas directly, but the Hardhat gas reporter is disabled.

### 3. Run Off-Chain Proving Benchmarks

```bash
node scripts/benchmarks/offChainProving.bench.js
```

### 4. Generate Comprehensive Report

```bash
node scripts/benchmarks/generateReport.js
```

## Benchmark Results

Results are saved to:
- `benchmark-results/identity-registration-scalability-results.json` - Five-run identity-registration gas summaries at 10, 50, and 100 identities
- `benchmark-results/reward-note-activity-results.json` - Controlled reward-note rates and estimated time to 5, 10, and 20 candidates
- `benchmark-results/deployment-results.json` - Deployment gas costs
- `benchmark-results/proof-verification-results.json` - Direct identity and reward `verifyProof()` gas costs
- `benchmark-results/offchain-proving-results.json` - Off-chain proving times
- `benchmark-results/history-hiding/` - History-hiding results. The files emitted by the canonical real-proof command are `state-results.json`, `state-scale.json`, `real-proof-verification.json` / `.csv`, and `canonical-lifecycle-real-proof.json` / `.csv`. The extended mock-verifier command separately writes `rating.json`, `slashing.json`, `reward-integration.json`, `metadata-history.json`, and `end-to-end.json`.
- `reports/GasComparisonReport.md` - Comprehensive markdown report
- `reports/GasComparisonReport.csv` - CSV data for analysis

## Key Metrics

The following phase-level figures are historical/illustrative legacy comparison ranges from the earlier benchmark setup. They are not current measurements of the canonical History-hiding contracts, and some underlying benchmark cases use mocks or estimates.

### Legacy Gas Overhead by Phase (Historical Estimates)
- **Identity & Registration**: 30-50% increase (~30,000-50,000 gas)
- **CTI Submission & Consumption**: 430-500% increase (~215,000-300,000 gas)
- **Dispute & Regulation**: 598-699% increase (~676,000-978,000 gas)
- **Reward Claiming**: 1,080-950% increase (~540,000-760,000 gas)

### Legacy Complete Lifecycle (Historical Estimates)
- **Standard**: ~403,000-646,000 gas
- **ZK**: ~1,604,000-2,369,000 gas
- **Overhead**: 298-267% increase

### Legacy Off-Chain Proving Estimates
- **Identity proof**: 5-8 seconds, ~150-250 MB memory
- **Reward proof**: 7-11 seconds, ~200-300 MB memory
- **Verification**: 50-100 ms

## Note-Based Reward System Benchmarks

The canonical reward system uses `ShieldedRewardTree` with fixed denominations and opaque note commitments. The `RewardPhase.bench.js` commands below instead exercise the older `ZKData` reward-note flow; treat those as legacy measurements, not canonical reward-tree results.

### Multi-Note Minting Benchmarks

The `RewardPhase.bench.js` suite includes benchmarks for minting different numbers of reward notes:

```bash
npx hardhat test test/benchmarks/RewardPhase.bench.js --grep "Multi-Note Minting"
```

**Benchmarks include:**
- Minting 1 reward note (baseline)
- Minting 3 reward notes
- Minting 5 reward notes
- Minting 9 reward notes
- Minting 20 reward notes
- Privacy-cost tradeoff analysis

### Privacy-Cost Tradeoff Analysis

The legacy benchmark estimates the following gas cost by note count:

- **1 note**: ~40,000-60,000 gas (baseline)
- **3 notes**: ~80,000-120,000 gas (2-3x)
- **5 notes**: ~120,000-180,000 gas (3-4x)
- **9 notes**: ~200,000-300,000 gas (5-6x)
- **20 notes**: ~400,000-600,000 gas (10-12x)

These are approximate historical estimates, not freshly measured canonical-tree results. Note splitting may increase a candidate set, but these gas figures alone do not establish a particular anonymity guarantee.

### Reward Decomposition Example

The `decomposeReward()` function decomposes arbitrary amounts into fixed denominations:

```javascript
// Example: 0.135 ETH decomposes into:
// 1 x 0.1 ETH
// 3 x 0.01 ETH
// 5 x 0.001 ETH
```

This example describes the legacy `ZKData.decomposeReward()` denomination split. It does not imply a single global anonymity set or guarantee denomination privacy.

## Notes

- Some legacy benchmarks use estimated values or mock verifiers where valid ZK proofs are not exercised. Do not report those as production-proof measurements.
- The canonical History-hiding benchmark command uses generated Groth16 proofs and generated Solidity verifiers; its checked-in result files are described below.
- Gas costs are measured on Hardhat network (chainId: 31337)
- Repetition counts vary by benchmark; single-sample results are not statistical summaries.

## History-hiding benchmark suite

The canonical command runs `HistoryHidingState.bench.js`, `HistoryHidingRealProof.bench.js`, `HistoryHidingScale.bench.js`, and `HistoryHidingLifecycleRealProof.bench.js`. It uses generated Groth16 proofs and generated Solidity verifiers for real-proof verification, state scale, reward insertion/claim, rating, slashing, and the canonical lifecycle. The standalone metadata/history and older rating/slashing/reward-integration JSON files are produced by the separate extended benchmark, which uses mock verifiers and is not included in the canonical command.

The canonical benchmark expects the circuit-scoped artifacts under `circuits/build/artifacts/`. Build them when they are absent or need regeneration, then verify the generated artifact sets:

```bash
npm run build:groth16
npm run verify:groth16
npm run benchmark:history-hiding
```

Results from the canonical suite are written below `benchmark-results/history-hiding/`: `state-results.json`, `state-scale.json`, `real-proof-verification.json` / `.csv`, and `canonical-lifecycle-real-proof.json` / `.csv`. `npm run benchmark:history-hiding:extended` writes the separate mock-verifier outputs. The current build script uses a 2¹⁵ Powers of Tau setup. These locally generated ceremony artifacts are demonstration-only, not production ceremony material.

The state-scale benchmark currently records two samples per scale (N=1, 10, 50, and 100); real-proof verifier and canonical lifecycle measurements record three samples. State-scale `fullProve` timing combines witness generation and proving, and compilation/witness-generation timings are not currently separated.

## Original Priv-Share versus canonical History-Hiding deployment/computation

```bash
# Reuse existing generated artifacts; build only if absent/outdated.
npm run build:groth16
npm run verify:groth16
npm run test:comparative
npm run benchmark:comparative

# Optional shorter exploratory run (report its reduced sample count).
COMPARATIVE_TRIALS=3 npm run benchmark:comparative
```

The suite requires Node.js, existing dependencies, local Git history containing `df954fd862862e65a2e66af3a18d1526d78bfd7e`, a cached/available Hardhat Solidity compiler, and generated canonical circuit artifacts under `circuits/build/artifacts/`. It reads baseline sources directly from the initial revision rather than using the modified current IdentityContract or intermediate ZK branch. Both architectures use the current contract build's exact compiler and optimizer settings. Missing source/artifacts or failed proof checks fail the run; measurements are never replaced by estimates.

Outputs go into a fresh `benchmark-results/comparative/<timestamp>-<pid>/`. `COMPARATIVE_OUT` may select a new, empty run subdirectory within that directory. The runner refuses overwrites and hashes all existing legacy/canonical datasets before and after execution. Individual entrypoints under `scripts/benchmarks/comparative/` require this environment variable and do not replace the old commands.

Each successful run produces:

- `manifest.json`: environment, revision, working-tree source hashes and preservation hashes.
- `deployment.json` / `.csv`: each actual deployed contract, linked libraries, constructor inputs, runtime/creation sizes, compiler settings, receipt gas, explicit aggregates and separate initialization gas. Constructor-created IdentityTree gas is included in ZKIdentity; all 17 canonical contract addresses are counted and checked against the runtime size limit, with 16 deployment transactions. The original baseline deploys two contracts. No registration costs are included.
- `offchain.json` / `.csv`: 20 measured trials per canonical circuit by default, one unmeasured warm-up, witness/proving/combined/serialization/worker wall times, compact proof JSON and 256-byte Solidity proof sizes, and OS peak full-worker RSS where supported. Metrics include sample count, median, mean, min, max and population standard deviation plus raw samples and artifact hashes.
- `baseline-operations.json` / `.csv`: original address registration, CTI publication, deposit slashing and response/reward operation timings via local EVM simulation. These include ethers/provider/EVM execution, exclude setup, and discard state changes between trials.
- `proof-<circuit>.json` and `verification.json`: one measured proof per circuit verified by the actual generated production Solidity verifier, with malformed-proof rejection and verification gas. Local verification is excluded from proving-stage time.
- `comparison.json` / `.csv` and `report.md`: complete-architecture deployment cost differences, contract sizes and computation tables. Percentages use `(history - baseline) / baseline * 100` only for semantically comparable positive baseline metrics.
- Per-command `.log` files and `execution.json`: exact commands, exit codes and preservation checks. Failed runs retain their logs/results and are not successful datasets.

Stage timing includes artifact reads and witness file I/O, excludes input preparation/startup/serialization/verification; worker wall time records these separately. Peak RSS includes the complete fresh worker process, its startup and local verification, and cannot be interpreted as proving-stage memory alone. Circuit compilation, trusted setup and proving-key generation are outside repeated operation measurements. Inputs are fixed generated fixtures; proof randomness means JSON byte counts can vary. Timing and memory depend on host scheduling and cache behavior.

The user confirmed neither proof-of-concept implements actual off-chain CTI processing. No baseline off-chain client, standalone rating, anonymous membership proof or shielded reward claim exists. The suite marks these metrics unavailable instead of zero and never calculates a time overhead between baseline EVM execution and Groth16 proving. Publication, slashing and rewards have different inputs and semantics across architectures. Deployment totals compare the explicitly listed complete sets and do not isolate history hiding from all other privacy/features. The canonical identity root-equality constraint remains intentionally disabled; benchmarks preserve and disclose that existing exception.

See [the implementation audit](docs/comparative-benchmark-audit.md). Canonical regression benchmarks were also run in a temporary repository copy so their ordinary output definitions could be checked without overwriting existing results. The new commands preserve all earlier benchmark commands.

### Recorded execution

The [20-trial report](benchmark-results/comparative/2026-10-10T11-38-53.918Z-357337/report.md) records 100 successful measured proofs across the five circuits. Deployment totals were 3,137,878 gas for original Priv-Share and 17,460,509 gas for canonical History-Hiding, an increase of 14,322,631 gas (456.44%) for the complete architecture sets. Combined witness/proving medians were 661.90 ms (identity), 1,326.65 ms (state), 733.56 ms (rating), 1,028.27 ms (slashing), and 705.07 ms (reward). These are measurements on the host recorded in the dataset, not general performance guarantees.

A separate two-trial repeat at `benchmark-results/comparative/2026-10-10T11-41-43.861Z-359856/` confirmed matching JSON structure, CSV headers and exact deployment totals. The primary run's `validation.json`, `reproducibility.json`, `regression.json` and regression logs document finite-value checks, compiler equivalence, dataset preservation, production-verifier acceptance/malformed-proof rejection, and passing suites: 126 contract tests, 29 circuit tests, one canonical end-to-end test, four canonical benchmarks and four new measurement-rule tests. Failed development runs are retained with `execution.json.success: false` and must not be used as result datasets.

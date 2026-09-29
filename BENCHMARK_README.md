# Priv-Share Gas Benchmarking Suite

Comprehensive gas cost comparison between Standard Priv-Share and ZK-Priv-Share implementations using Hardhat v2.

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

### 1. Run Individual Phase Benchmarks

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

# Complete history-hiding suite (state, slashing, rating, reward integration,
# metadata/history, and end-to-end)
npm run benchmark:history-hiding
```

### 2. Run All Benchmarks

```bash
REPORT_GAS=1 npx hardhat test test/benchmarks/*.bench.js
```

**Note:** Set `REPORT_GAS=1` environment variable to enable gas reporting. Without it, tests run without gas measurement.

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
- `benchmark-results/history-hiding/` - Separate state, slashing, rating, reward-integration, metadata/history, and end-to-end measurements
- `reports/GasComparisonReport.md` - Comprehensive markdown report
- `reports/GasComparisonReport.csv` - CSV data for analysis

## Key Metrics

### Gas Overhead by Phase
- **Identity & Registration**: 30-50% increase (~30,000-50,000 gas)
- **CTI Submission & Consumption**: 430-500% increase (~215,000-300,000 gas)
- **Dispute & Regulation**: 598-699% increase (~676,000-978,000 gas)
- **Reward Claiming**: 1,080-950% increase (~540,000-760,000 gas)

### Complete Lifecycle
- **Standard**: ~403,000-646,000 gas
- **ZK**: ~1,604,000-2,369,000 gas
- **Overhead**: 298-267% increase

### Off-Chain Proving
- **Identity proof**: 5-8 seconds, ~150-250 MB memory
- **Reward proof**: 7-11 seconds, ~200-300 MB memory
- **Verification**: 50-100 ms

## Note-Based Reward System Benchmarks

The reward system now uses a note-based architecture with fixed denominations. Benchmarks measure the privacy-cost tradeoff of splitting rewards into multiple notes.

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

The system allows tuning privacy vs gas cost by choosing note count:

- **1 note**: ~40,000-60,000 gas (baseline), exact denomination revealed
- **3 notes**: ~80,000-120,000 gas (2-3x), denomination hidden among possibilities
- **5 notes**: ~120,000-180,000 gas (3-4x), moderate denomination privacy
- **9 notes**: ~200,000-300,000 gas (5-6x), strong denomination privacy
- **20 notes**: ~400,000-600,000 gas (10-12x), very strong denomination privacy

**Key insight:** Gas cost scales approximately linearly with note count during minting, while claiming cost remains constant per note. This allows academic measurement of the privacy-cost tradeoff.

### Reward Decomposition Example

The `decomposeReward()` function decomposes arbitrary amounts into fixed denominations:

```javascript
// Example: 0.135 ETH decomposes into:
// 1 x 0.1 ETH
// 3 x 0.01 ETH
// 5 x 0.001 ETH
```

This decomposition enables denomination privacy while preserving a single global anonymity set.

## Notes

- Some benchmarks use estimated values where valid ZK proofs are not available
- For accurate proof verification benchmarks, generate valid proofs using the circom circuits
- Gas costs are measured on Hardhat network (chainId: 31337)
- All benchmarks include statistical analysis where applicable
- Multi-note minting benchmarks demonstrate the privacy-cost tradeoff for academic analysis

## History-hiding benchmark suite

This suite measures the dedicated `PrivateStateTree` flow using a real Groth16 proof for the `NONEXISTENT → SUBMITTED` transition, plus independent slashing, rating, reward-integration, metadata/history, and end-to-end measurements. It records proving time, serialized proof size, verifier gas, transition gas, storage slots, replay-guard behavior, and publicly observable ABI metadata.

Build the circuit artifacts and generated verifier before running it:

```bash
npm run benchmark:history-hiding
```

Results are written below `benchmark-results/history-hiding/`. The state circuit requires a 2¹⁴ Powers of Tau setup because it exceeds the 2¹³ capacity. These local ceremony artifacts are demonstration-only and are not production ceremony material.

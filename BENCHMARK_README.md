# Priv-Share Gas Benchmarking Suite

Comprehensive gas cost comparison between Standard Priv-Share and ZK-Priv-Share implementations using Hardhat v2.

## Installation

```bash
npm install
```

## Running Benchmarks

### 1. Run Individual Phase Benchmarks

```bash
# Identity & Registration Phase
npx hardhat test test/benchmarks/IdentityPhase.bench.js

# CTI Submission & Consumption Phase
npx hardhat test test/benchmarks/CTIPhase.bench.js

# Dispute & Regulation Phase
npx hardhat test test/benchmarks/DisputePhase.bench.js

# Reward Claiming Phase
npx hardhat test test/benchmarks/RewardPhase.bench.js

# Deployment Analysis
npx hardhat test test/benchmarks/Deployment.bench.js
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
- `benchmark-results/deployment-results.json` - Deployment gas costs
- `benchmark-results/offchain-proving-results.json` - Off-chain proving times
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

## Notes

- Some benchmarks use estimated values where valid ZK proofs are not available
- For accurate proof verification benchmarks, generate valid proofs using the circom circuits
- Gas costs are measured on Hardhat network (chainId: 31337)
- All benchmarks include statistical analysis where applicable

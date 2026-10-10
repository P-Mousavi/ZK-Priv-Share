# ZK-Priv-Share

Proof-of-concept smart-contract and Circom implementation of privacy-preserving cyber-threat-intelligence (CTI) sharing. It combines an organisation identity registry, Poseidon-based identity commitments, Groth16 proof verification, CTI request/response and dispute workflows, and an experimental fixed-denomination reward-note claim flow.

This repository is for local development and research. It is not
production-ready: `identity.circom` intentionally does not constrain its
supplied Merkle root because the on-chain identity tree and circomlib tree are
not yet compatible. The canonical History-hiding reward tree is maintained on
chain by `ShieldedRewardTree`; older `ZKData` reward-root helpers are legacy.
See [Security and current limitations](#security-and-current-limitations).

The history-hiding extension and its explicit proof-of-concept boundary are
documented in [HISTORY_HIDING_README.md](HISTORY_HIDING_README.md).

## Components

- `Identity.sol` — registered-organisation identity registry.
- `ZKIdentity.sol` and `IdentityTree.sol` — identity-commitment registration and an on-chain identity tree.
- `ZKData.sol` — CTI sharing, conventional and ZK access flows, disputes, group-manager voting, and reward-note bookkeeping.
- `circuits/identity.circom` — proves knowledge of an identity commitment and creates an action-bound nullifier.
- `circuits/reward.circom` — proves knowledge of a fixed-denomination reward note and its nullifier.
- `Verifier.sol` / `RewardVerifier.sol` — Groth16 verifier contracts generated from the circuits.

The circuits use Poseidon and the identity circuit has depth 7 (128 leaves); the reward circuit has depth 5 (32 leaves).

## Repository layout

- `circuits/` — Circom sources, example inputs, and generated build artefacts.
- `contracts/` — Solidity contracts and libraries.
- `scripts/` — build, deployment, configuration, and sample-witness utilities.
- `config/` — local deployment settings and initial manager/delegate addresses.
- `test/` — contract, circuit, compatibility, and benchmark tests.
- `benchmark-results/` and `reports/` — checked-in benchmark output.
- `docs/Priv-share.pdf` — reference document.

## Implemented flows

### CTI and identity workflows

1. A registered organisation shares CTI with fees, an access policy CID, integrity-hash CID, and delegates.
2. A consumer creates either a conventional request or a ZK access request.
3. A ZK responder supplies a Groth16 identity proof whose `actionId` is bound to the request ID.
4. Managers can resolve conventional disputes by threshold voting. ZK dispute and ZK voting entry points also use nullifiers to guard against replay.

### Legacy reward-note flow

`provideResponseZK` accepts commitments and fixed denominations, verifies their total equals the configured CTI reward, and stores each commitment's denomination. Allowed denominations are 0.001, 0.01, 0.1, 1, and 10 ETH. A reward proof exposes `[root, denomination, nullifierHash]`; `claimReward` verifies it, prevents reuse of the payout nullifier, pays an optional relayer fee, and sends the remainder to a recipient address.

This address-linked `ZKData` reward flow is retained for migration and
regression tests only. It is not the canonical History-hiding reward path.
The canonical path is `ShieldedRewardTree`, which funds and appends opaque
fixed-denomination note commitments to its own Poseidon root and accepts only
real generated reward proofs against that current root. See
`HISTORY_HIDING_README.md`.

## Prerequisites

- Node.js 18 or newer and npm
- Circom CLI available on `PATH`
- A local EVM node on `http://127.0.0.1:8545` (Hardhat or Anvil)

Install dependencies:

```bash
npm install
```

Create `.env` in the repository root with a funded local development key:

```env
PRIVATE_KEY=0xYOUR_FUNDED_LOCAL_ACCOUNT_PRIVATE_KEY
```

Never put a production key in this file.

## Local setup and deployment

Start a local node in a separate terminal:

```bash
npx hardhat node
```

Create local managers and delegates from the default Hardhat mnemonic:

```bash
node scripts/InitializeEntities.js -n 5 -d 3 -t 3
```

This writes five managers, three delegates, and a threshold of three. The deployer is not included in either list.

Build the sample circuits before deploying their verifier contracts:

```bash
node scripts/generateMerkleTree.js
bash scripts/build.sh -c identity -i input.json
bash scripts/build.sh -c reward -i reward_input.json
```

`build.sh` compiles a circuit, creates a demo Groth16 setup and proof, verifies that proof locally, and writes the corresponding Solidity verifier. It is intentionally a demo setup; do not use its ceremony artefacts in production.

For the canonical History-hiding circuits, regenerate all real local proof
artifacts with `npm run build:groth16`, then validate their local proofs and
generated on-chain verifiers with `npm run verify:groth16` and
`npx hardhat test test/contracts/Groth16Artifacts.test.js`. Generated circuit
artifacts are kept under `circuits/build/artifacts/`.

Deploy in this order:

```bash
node scripts/deploy.js -c Identity.sol
node scripts/deploy.js -c ZKIdentity.sol
node scripts/deploy.js -c RewardVerifier.sol
node scripts/deploy.js -c ZKData.sol
```

Deploying `Identity.sol` synchronises `config/config.json`. `ZKData.sol` then reads the identity address and threshold from that file, manager addresses from `config/InitialManagers.json`, and the deployed `ZKIdentity` and `RewardVerifier` addresses from `deployments/localhost/`.

For an identity input compatible with the current depth-7 circuit, use `scripts/generateMerkleTree.js`. It writes `circuits/input.json`. Reward inputs are supplied in `circuits/reward_input.json`.

### Local-run quick checklist

1. `npm install`
2. Create `.env` with funded `PRIVATE_KEY`
3. `node scripts/InitializeEntities.js -n 5 -d 3 -t 3`
4. `node scripts/deploy.js -c Identity.sol`
5. `node scripts/generateMerkleTree.js`
6. `bash scripts/build.sh -c identity -i input.json`
7. `bash scripts/build.sh -c reward -i reward_input.json`
8. Start local chain on `127.0.0.1:8545`
9. `node scripts/deploy.js -c ZKIdentity.sol`
10. `node scripts/deploy.js -c RewardVerifier.sol`
11. `node scripts/deploy.js -c ZKData.sol`
12. Use generated `proof.json` + `public.json` in contract interaction scripts/tests

## Testing and benchmarks

```bash
npm test                 # Solidity contract tests
npm run test:contracts   # Solidity contract tests
npm run test:circuits    # Circom circuit tests
npm run test:all         # both suites
```

Available benchmark commands:

```bash
# CTI-to-reward linkability
npm run benchmark:linkability

# Identity and registration
npx hardhat test test/benchmarks/IdentityPhase.bench.js
npm run benchmark:identity-scalability

# Reward-note activity and candidate-set accumulation
npm run benchmark:reward-activity

# CTI, disputes, rewards, deployment, and proof verification
npx hardhat test test/benchmarks/CTIPhase.bench.js
npx hardhat test test/benchmarks/DisputePhase.bench.js
npx hardhat test test/benchmarks/RewardPhase.bench.js
npx hardhat test test/benchmarks/Deployment.bench.js
npx hardhat test test/benchmarks/ProofVerification.bench.js

# Off-chain proving and report generation
node scripts/benchmarks/offChainProving.bench.js
node scripts/benchmarks/generateReport.js

# All on-chain benchmark suites, with gas reporting enabled
REPORT_GAS=1 npx hardhat test test/benchmarks/*.bench.js
```

See [BENCHMARK_README.md](BENCHMARK_README.md) for benchmark purpose, output files, and interpretation. Benchmark results are written under `benchmark-results/`.

## Security and current limitations

- This is a prototype, not an audited protocol.
- Only `identity.circom` leaves the calculated Merkle-root equality constraint disabled. This is an explicit benchmark-PoC exception; identity membership is therefore not a complete security guarantee. State, stake, rating, slashing, and reward root constraints remain enabled in their canonical circuits.
- `ShieldedRewardTree` is the canonical contract-maintained reward tree. The older `ZKData` reward mappings and `setRewardTreeRoot`/`testingMode` path are legacy test/migration code and must not be used as a production or canonical History-hiding flow.
- `testingMode`, `setZkIdentity`, reward deposit helpers, and `setRewardTreeRoot` are test helpers and are not access-controlled beyond the mode check. Do not deploy this contract as-is.
- Request allocation uses block-derived pseudo-randomness and is not secure randomness.
- The build script creates a fresh demo Powers of Tau setup each run. Use a trusted ceremony and reproducible artefact process for any real deployment.
- CTI content and CIDs are off-chain; the contracts do not validate their availability or correctness.

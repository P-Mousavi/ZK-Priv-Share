# priv-share-zk

Zero-knowledge identity and CTI-sharing prototype using:

- Circom + SnarkJS for proof generation
- Solidity contracts for on-chain verification and workflow logic
- Ethers.js + solc for local deployment scripting

This repository demonstrates a flow where a delegate proves membership in a Merkle tree without revealing identity, then uses that proof in a CTI request/response and dispute system.

## Project Layout

- `circuits/identity.circom`: main ZK circuit (`JoinIdentity`)
- `circuits/reward.circom`: reward claiming circuit (`ClaimReward`)
- `circuits/lib/merkleTree.circom`: Poseidon Merkle inclusion circuit
- `circuits/input.json`: generated identity circuit witness input
- `circuits/reward_input.json`: generated reward circuit witness input
- `circuits/build/`: generated circuit compiler and proof artifacts
- `config/config.json`: deployment settings (`identityContract`, `threshold`)
- `config/InitialManagers.json`: initial group manager addresses
- `deployments/localhost/`: generated contract deployment records
- `contracts/`: Solidity source (`Verifier.sol` and `RewardVerifier.sol` are generated during circuit build)
- `scripts/build.sh`: compile circuit, generate proving/verifying keys, generate proof, export verifier
- `scripts/generateMerkleTree.js`: generate sample `circuits/input.json` for the identity circuit
- `scripts/InitializeEntities.js`: populate manager and delegate list and threshold for local dev
- `scripts/deploy.js`: deploy script for Solidity contracts
- `scripts/syncConfig.js`: sync `identityContract` in config from latest deployment
- `test/helpers/rewardProofHelper.js`: helper functions for reward proof generation and conversion

## What This Prototype Covers

1. Create identity commitment off-chain (`Poseidon(secret, nullifier)`).
2. Generate Merkle tree proof inputs.
3. Build ZK artifacts and export Solidity verifier.
4. Deploy contracts to local chain.
5. Use proof public signals:
   - `root`
   - `actionId`
   - `nullifierHash`
6. **Decoupled Shielded Payouts**: Separate CTI submission from reward claiming for enhanced privacy

---

## Decoupled Shielded Payouts Architecture

The system implements a privacy-enhancing architecture that separates the CTI submission process from the reward claiming process. This prevents tracking of delegate activity by ensuring that the transaction submitting threat intelligence cannot be linked to the transaction withdrawing the financial reward.

### Architecture Overview

**Step 1: CTI Submission & Reward Note Minting (Link-Breaking)**

When a delegate submits a valid response via a relayer:

1. The delegate generates multiple ephemeral secrets off-chain: `secret`, `nullifier` for each note
2. They calculate public commitments: `noteCommitment = Poseidon(denomination, secret, nullifier)`
3. The reward amount is decomposed into fixed denominations (e.g., 0.135 ETH → 0.1 + 3×0.01 + 5×0.001)
4. The relayer calls `provideResponseZK()`, passing arrays of `rewardNoteCommitments` and `rewardNoteDenominations`
5. The ZKDataContract verifies the identity/submission proof
6. The contract validates that denominations sum to the expected reward amount and inserts all notes into the single reward tree
7. Each note's denomination is recorded in the `rewardNoteDenominations` mapping

At this point, the blockchain knows reward notes were minted for a valid CTI response, but it does not know who owns the secrets associated with those leaves.

**Step 2: Anonymous Reward Extraction (The Privacy Loop)**

Days or weeks later, when the anonymity set of the Reward Merkle Tree has grown sufficiently large, the delegate withdraws individual notes to completely fresh, unlinked addresses:

1. The delegate constructs a ZK proof using the `reward.circom` circuit for a specific note
2. The circuit takes `secret`, `nullifier`, and the Merkle membership proof for the Reward Tree as private inputs
3. The circuit reconstructs the leaf: `leaf = Poseidon(denomination, secret, nullifier)`
4. The circuit outputs a deterministic `nullifierHash = Poseidon(nullifier)` to prevent double-claiming
5. The circuit accepts public signals: `root`, `denomination`, `nullifierHash`
6. The delegate sends this proof to a Gas Relayer (or uses an ERC-4337 Paymaster)
7. The relayer submits the transaction to the `claimReward()` function on the contract
8. The contract verifies the proof, checks that the `nullifierHash` has not been spent, and transfers the exact denomination to the fresh `recipientAddress`

### Key Components

**reward.circom Circuit**

Located in `circuits/reward.circom`, this circuit verifies:
- Knowledge of `secret` and `nullifier` for a reward note that exists in the reward tree
- Merkle proof of inclusion for the commitment
- Leaf reconstruction: `Poseidon(denomination, secret, nullifier)`
- Outputs a `nullifierHash = Poseidon(nullifier)` to prevent double-claiming
- Accepts public signals: `root`, `denomination`, `nullifierHash`

**Fixed Denominations**

The system uses fixed denomination notes (stored in wei):
- `DENOMINATION_0_001_ETH = 1e15` (0.001 ETH)
- `DENOMINATION_0_01_ETH = 1e16` (0.01 ETH)
- `DENOMINATION_0_1_ETH = 1e17` (0.1 ETH)
- `DENOMINATION_1_ETH = 1e18` (1 ETH)
- `DENOMINATION_10_ETH = 1e19` (10 ETH)

**Contract Functions**

- `provideResponseZK()`: Accepts arrays of `rewardNoteCommitments` and `rewardNoteDenominations`, validates sum equals reward amount, and mints all notes to the reward tree
- `claimReward()`: Allows anonymous reward withdrawal using ZK proof verification with denomination as public input
- `decomposeReward()`: Helper function to decompose any reward amount into fixed denominations
- `verifyRewardProof()`: Helper function to verify reward proofs using the RewardVerifier contract

**State Variables**

- `allowedDenominations`: Array of allowed denomination values
- `isAllowedDenomination`: Mapping to check if a denomination is allowed
- `rewardNoteDenominations`: Maps `noteCommitment` to its denomination for minted, unclaimed notes
- `spentPayoutNullifiers`: Maps `nullifierHash` to bool to prevent double-claiming
- `rewardTreeRoots`: Track valid reward tree roots
- `currentRewardTreeRoot`: Current reward tree root

### Privacy Benefits

1. **Temporal Decoupling**: Submission and withdrawal happen at different times
2. **Address Decoupling**: Each note can be claimed to a different fresh address
3. **Denomination Privacy**: Splitting rewards into multiple notes hides the exact reward amount
4. **Relayer Support**: Both submission and withdrawal can be done via relayers
5. **Anonymity Set**: Single global reward tree preserves large anonymity set regardless of note count
6. **Independent Claims**: Each note can be claimed independently at different times

### Privacy-Cost Tradeoff

The system allows tuning the privacy-cost tradeoff by choosing how many notes to split a reward into:

- **1 note**: Lowest gas cost, exact denomination revealed
- **3-5 notes**: Moderate gas cost, denomination hidden among possibilities
- **9+ notes**: Higher gas cost, strong denomination privacy
- **20+ notes**: Highest gas cost, very strong denomination privacy

Gas benchmarks show approximately linear scaling with note count during minting, while claiming cost remains constant per note. This allows academic measurement of the privacy-cost tradeoff.

### Deployment Steps

To deploy the updated system:

1. Build the reward circuit and generate the verifier:
```bash
bash scripts/build.sh -c reward -i reward_input.json
```

2. Deploy `RewardVerifier.sol` (auto-generated from `reward.circom`)
```bash
node scripts/deploy.js -c RewardVerifier.sol
```

3. Deploy `ZKData.sol` with the new constructor parameter `_rewardVerifier`
```bash
node scripts/deploy.js -c ZKData.sol
```

---

## Prerequisites

Install the following first:

- Node.js `>=18`
- npm
- `circom` CLI in PATH
- A local EVM RPC on `http://127.0.0.1:8545` (Hardhat node or Anvil)

### Install Circom (example)

If `circom --help` is not available, install Circom first (official install methods vary by OS). Verify:

```bash
circom --help
```

### Optional: local chain options

- Hardhat node:
  ```bash
  npx hardhat node
  ```
- Anvil:
  ```bash
  anvil
  ```

The deployment script is hardcoded to `127.0.0.1:8545`.

---

## 1) Install Dependencies

From repository root:

```bash
npm install
```

---

## 2) Configure Environment and Deployment Inputs

Create `.env` in repo root:

```env
PRIVATE_KEY=0xYOUR_FUNDED_LOCAL_ACCOUNT_PRIVATE_KEY
```

Create or update `config/config.json`:

```json
{
  "identityContract": "0xYOUR_IDENTITY_CONTRACT_ADDRESS",
  "threshold": 2
}
```

Create or update manager and delegate accounts automatically from the default Hardhat dev mnemonic:

```bash
node scripts/InitializeEntities.js -n 5 -d 3 -t 3
```

This writes 5 manager addresses (Hardhat accounts `#1`–`#5`) to `config/InitialManagers.json`, 3 delegate addresses (Hardhat accounts `#6`–`#8`) to `config/InitialDelegates.json`, and sets `threshold` to `3` in `config/config.json`. Account `#0` is reserved for the deployer and is not included in the manager or delegate lists.

You can also create `config/InitialManagers.json` manually:

```json
[
  "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
  "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC"
]
```

Notes:

- The deploy script requires `PRIVATE_KEY`.
- `ZKDataContract` reads `threshold` and `identityContract` from `config/config.json`.
- `ZKDataContract` reads `_initialManagers` from `config/InitialManagers.json`.
- Deployed contract addresses are written to `deployments/localhost/<ContractName>.json`.
- `threshold` must be greater than `0` and less than or equal to the number of managers.
- Use a funded dev account from your local node.
- Never use a mainnet/private production key in this prototype.

---

## 3) Generate Circuit Inputs (Merkle Data)

Generate sample identity values, Merkle path, and circuit input JSON:

```bash
node scripts/generateMerkleTree.js
```

This writes:

- `circuits/input.json`

The generated input contains:

- `identitySecret`
- `identityNullifier`
- `pathElements`
- `pathIndices`
- `root`
- `actionId`

For the reward circuit, the input file `circuits/reward_input.json` should contain:

- `payoutSecret`
- `pathElements`
- `pathIndices`
- `root`
- `nullifierHash`

---

## 4) Build Circuit + Proof + Verifier

### Build Identity Circuit

```bash
bash scripts/build.sh -c identity -i input.json
```

### Build Reward Circuit

```bash
bash scripts/build.sh -c reward -i reward_input.json
```

The script does all of the following:

1. Cleans old build artifacts.
2. Compiles the specified circuit (`identity.circom` or `reward.circom`).
3. Generates witness.
4. Runs Powers of Tau (demo setup).
5. Runs Groth16 setup and key contribution.
6. Exports `verification_key.json`.
7. Generates `proof.json` and `public.json`.
8. Verifies proof locally with SnarkJS.
9. Exports Solidity verifier to `contracts/Verifier.sol` (for identity) or `contracts/RewardVerifier.sol` (for reward).
10. Adds `virtual` to verifier method signature for inheritance compatibility.
11. Fixes pragma version to `^0.8.20`.

Expected generated artifacts (in `circuits/build`):

- `<circuit>.r1cs`
- `<circuit>.sym`
- `<circuit>_js/*` (WASM + witness code)
- `witness.wtns`
- `<circuit>_final.zkey`
- `verification_key.json`
- `proof.json`
- `public.json`

---

## 5) Start Local Chain

In a separate terminal, run one of:

```bash
npx hardhat node
```

or

```bash
anvil
```

Keep this process running.

---

## 6) Deploy Contracts

### 6.1 Deploy `Identity.sol` and sync `config/config.json`

Deploy the non-ZK identity registry first:

```bash
node scripts/deploy.js -c Identity.sol
```

This writes `deployments/localhost/IdentityContract.json` and automatically updates `config/config.json` with the latest `identityContract` address.

You can also refresh `config/config.json` manually after a deployment:

```bash
node scripts/syncConfig.js
```

### 6.2 Deploy `ZKIdentity.sol`

```bash
node scripts/deploy.js -c ZKIdentity.sol
```

This writes:

- `deployments/localhost/ZKIdentity.json`

Note: `ZKIdentity.sol` implements a simplified Poseidon hash function internally for merkle tree operations. **Important**: For full ZK compatibility with circom circuits, the merkle tree computation should be performed off-chain using circomlibjs, and only the final root should be submitted to the contract for verification. The on-chain poseidon implementation is provided for basic functionality but may not match the exact circomlib output due to the complexity of the full Poseidon round structure.

### 6.3 Deploy `RewardVerifier.sol`

Deploy the reward verifier contract (auto-generated from `reward.circom`):

```bash
node scripts/deploy.js -c RewardVerifier.sol
```

This writes:
- `deployments/localhost/RewardVerifier.json`

Note: Ensure you have built the reward circuit first using `bash scripts/build.sh -c reward -i reward_input.json` to generate the verifier contract.

### 6.4 Deploy `ZKData.sol`

Before deploying `ZKData.sol`, make sure:

1. `ZKIdentity.sol` is already deployed.
2. `RewardVerifier.sol` is already deployed.
3. `config/config.json` contains a valid `identityContract` address and `threshold`.
4. `config/InitialManagers.json` contains the manager account list.

Then deploy:

```bash
node scripts/deploy.js -c ZKData.sol
```

Constructor arguments are loaded automatically as:

1. `_zkIdentity` from `deployments/localhost/ZKIdentity.json`
2. `_identityContract` from `config/config.json`
3. `_rewardVerifier` from `deployments/localhost/RewardVerifier.json`
4. `_initialManagers` from `config/InitialManagers.json`
5. `_threshold` from `config/config.json`

Deployment records are saved to:

- `deployments/localhost/ZKDataContract.json`

---

## 7) Using Proof Data with Contracts

From generated files:

- `circuits/build/proof.json`
- `circuits/build/public.json`

You map values into Solidity verifier call parameters:

- `a`: `uint256[2]`
- `b`: `uint256[2][2]`
- `c`: `uint256[2]`
- `input`: `uint256[3]` = `[root, actionId, nullifierHash]`

The contract flow enforces:

- `input[1]` must match expected `actionId` (request/dispute/vote binding)
- `input[0]` must be an accepted Merkle root
- proof must pass `zkIdentity.verifyProof(...)`

---

## 8) End-to-End Local Run (Quick Checklist)

1. `npm install`
2. Create `.env` with funded `PRIVATE_KEY`
3. `node scripts/InitializeEntities.js -n 5 -d 3 -t 3`
4. `node scripts/deploy.js -c Identity.sol`
5. `node scripts/generateMerkleTree.js`
6. `bash scripts/build.sh -c identity -i input.json`
7. `bash scripts/build.sh -c reward -i reward_input.json`
8. Start local chain on `127.0.0.1:8545`
9. `node scripts/deploy.js -c PoseidonT2.sol`
10. `node scripts/deploy.js -c ZKIdentity.sol`
11. `node scripts/deploy.js -c RewardVerifier.sol`
12. `node scripts/deploy.js -c ZKData.sol`
13. Use generated `proof.json` + `public.json` in contract interaction scripts/tests

---

## Troubleshooting

### `PRIVATE_KEY not found in .env file`

- Ensure `.env` is in project root.
- Ensure variable name is exactly `PRIVATE_KEY`.

### `Error: Contract file not found`

- Run command from repo root.
- Check file exists in `contracts/`.

### `circom: command not found`

- Install Circom CLI and ensure it is available in PATH.

### `connect ECONNREFUSED 127.0.0.1:8545`

- Start local chain (`npx hardhat node` or `anvil`).

### Verifier/proof mismatch

- Rebuild all artifacts from scratch:
  1. regenerate input
  2. rerun build script
  3. redeploy contracts if verifier changed

---

## Security and Prototype Notes

- This is a prototype workflow, not production-ready.
- Merkle tree and slashing logic in `ZKIdentity.sol` are simplified placeholders.
- Do not use demo keys or this exact setup in production.
- Replace pseudo-randomness and placeholder fee/transfer logic before real deployment.

---

## Testing

The project includes comprehensive unit tests for both Circom circuits and Solidity contracts.

### Test Structure

- **Circuit Tests** (`test/circuits/`): Tests for Circom circuits using circom_tester
  - `identity.test.ts` - Tests for identity circuit
  - `reward.test.ts` - Tests for reward circuit
  - `merkleTree.test.ts` - Tests for Merkle tree circuit

- **Contract Tests** (`test/contracts/`): Tests for Solidity contracts using Hardhat
  - `Identity.test.js` - Tests for Identity contract
  - `ZKIdentity.test.js` - Tests for ZKIdentity contract
  - `ZKData.test.js` - Tests for ZKDataContract (full workflow)

### Running Tests

Run all tests:
```bash
npm test
```

Run only contract tests:
```bash
npm run test:contracts
```

Run only circuit tests:
```bash
npm run test:circuits
```

Run the identity-registration scalability benchmark (five independent runs at
10, 50, and 100 identities):
```bash
npm run benchmark:identity-scalability
```

The identity tree has depth 7 (128 leaves), and identities are unique by their
commitments rather than their transaction senders. The benchmark therefore uses
one funded Hardhat account with distinct commitment values, and writes results
to `benchmark-results/identity-registration-scalability-results.json`.

Because the identity circuit now uses the same depth, regenerate its witness,
proving key, and Solidity verifier before deploying the updated identity flow:
```bash
node scripts/generateMerkleTreePoseidon.js
bash scripts/build.sh -c identity -i input.json
```

### Test Coverage

**Circuit Tests:**
- Valid proof generation and verification
- Invalid Merkle root detection
- Invalid path elements detection
- Unique nullifier generation for different actions
- Maximum tree depth handling
- Edge cases (zero values, maximum field elements)

**Contract Tests:**
- Identity registration with deposits
- CTI sharing with delegates
- Access request/response workflow
- Dispute raising and resolution
- Group manager voting
- ZK identity registration
- ZK access requests
- Reward claiming
- Fee distribution
- Access control and validation

### Test Utilities

Helper functions are provided in `test/helpers/`:
- `merkle.ts` - Merkle tree construction and proof generation
- `poseidon.ts` - Poseidon hash functions
- `proofs.ts` - ZK proof generation and verification
- `rewardProofHelper.js` - Reward proof generation and Solidity format conversion using snarkjs

---

## Suggested Next Improvements

- Add a proper framework (`hardhat` or `foundry`) with reproducible deploy scripts.
- Add tests for:
  - proof verification success/failure
  - replay/nullifier protections
  - dispute threshold logic
- Add dedicated scripts for converting SnarkJS proof JSON into Solidity calldata.
- Add network config for non-local deployment (testnet/mainnet) with per-network RPC URLs.

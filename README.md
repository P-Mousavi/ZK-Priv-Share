# priv-share-zk

Zero-knowledge identity and CTI-sharing prototype using:

- Circom + SnarkJS for proof generation
- Solidity contracts for on-chain verification and workflow logic
- Ethers.js + solc for local deployment scripting

This repository demonstrates a flow where a delegate proves membership in a Merkle tree without revealing identity, then uses that proof in a CTI request/response and dispute system.

## Project Layout

- `circuits/identity.circom`: main ZK circuit (`JoinIdentity`)
- `circuits/lib/merkleTree.circom`: Poseidon Merkle inclusion circuit
- `circuits/input.json`: generated circuit witness input
- `circuits/build/`: generated circuit compiler and proof artifacts
- `config/config.json`: deployment settings (`identityContract`, `threshold`)
- `config/InitialManagers.json`: initial group manager addresses
- `deployments/localhost/`: generated contract deployment records
- `contracts/`: Solidity source only (`Verifier.sol` is generated during circuit build)
- `scripts/build.sh`: compile circuit, generate proving/verifying keys, generate proof, export verifier
- `scripts/generateMerkleTree.js`: generate sample `circuits/input.json` for the circuit
- `scripts/InitializeEntities.js`: populate manager and delegate list and threshold for local dev
- `scripts/deploy.js`: deploy script for Solidity contracts
- `scripts/syncConfig.js`: sync `identityContract` in config from latest deployment

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

**Step 1: CTI Submission & Reward Minting (Link-Breaking)**

When a delegate submits a valid response via a relayer:

1. The delegate generates an ephemeral secret off-chain: `payoutSecret`
2. They calculate a public commitment: `payoutCommitment = Poseidon(payoutSecret)`
3. The relayer calls `provideResponseZK()`, passing the `payoutCommitment` as a public signal
4. The ZKDataContract verifies the identity/submission proof
5. Instead of moving Ether to a wallet, the contract inserts the `payoutCommitment` into the reward tree and updates the balance for that commitment to equal the reward amount

At this point, the blockchain knows a reward was minted for a valid CTI response, but it does not know who owns the `payoutSecret` associated with that leaf.

**Step 2: Anonymous Reward Extraction (The Privacy Loop)**

Days or weeks later, when the anonymity set of the Reward Merkle Tree has grown sufficiently large, the delegate withdraws the funds to a completely fresh, unlinked address:

1. The delegate constructs a ZK proof using the `claim.circom` circuit
2. The circuit takes `payoutSecret` and the Merkle membership proof for the Reward Tree as private inputs
3. The circuit outputs a deterministic `payoutNullifier = Poseidon(payoutSecret)` to prevent double-claiming
4. The circuit accepts public variables: `root`, `recipient`, `relayerFee`
5. The delegate sends this proof to a Gas Relayer (or uses an ERC-4337 Paymaster)
6. The relayer submits the transaction to the `claimReward()` function on the contract
7. The contract verifies the proof, checks that the `payoutNullifier` has not been spent, and transfers the funds directly to the fresh `recipientAddress`

### Key Components

**claim.circom Circuit**

Located in `circuits/claim.circom`, this circuit verifies:
- Knowledge of a `payoutSecret` that exists in the reward tree
- Merkle proof of inclusion for the commitment
- Outputs a `nullifierHash` to prevent double-claiming
- Accepts public signals: `root`, `nullifierHash`, `recipient`, `relayerFee`

**Contract Functions**

- `provideResponseZK()`: Modified to accept `payoutCommitment` and mint rewards to the reward tree instead of direct transfer
- `claimReward()`: New function that allows anonymous reward withdrawal using ZK proof verification
- `verifyClaimProof()`: Helper function to verify claim proofs using the ClaimVerifier contract

**State Variables**

- `rewardTreeBalances`: Maps `payoutCommitment` to reward amount
- `spentPayoutNullifiers`: Maps `nullifierHash` to bool to prevent double-claiming
- `rewardTreeRoots`: Track valid reward tree roots
- `currentRewardTreeRoot`: Current reward tree root

### Privacy Benefits

1. **Temporal Decoupling**: Submission and withdrawal happen at different times
2. **Address Decoupling**: Rewards go to a fresh address unrelated to the submission
3. **Relayer Support**: Both submission and withdrawal can be done via relayers
4. **Anonymity Set**: As more rewards are minted, the anonymity set grows, making it harder to link specific withdrawals to specific submissions

### Deployment Steps

To deploy the updated system:

1. Deploy `ClaimVerifier.sol` (mock version for testing, replace with real verifier after circuit compilation)
2. Deploy `ZKData.sol` with the new constructor parameter `_claimVerifier`

```bash
node scripts/deploy.js -c ClaimVerifier.sol
node scripts/deploy.js -c ZKData.sol
```

Note: The real `ClaimVerifier.sol` should be generated from the `claim.circom` circuit using the build script once the circuit compilation issues are resolved.

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

---

## 4) Build Circuit + Proof + Verifier

Run:

```bash
bash scripts/build.sh -c identity -i input.json
```

The script does all of the following:

1. Cleans old build artifacts.
2. Compiles `circuits/identity.circom`.
3. Generates witness.
4. Runs Powers of Tau (demo setup).
5. Runs Groth16 setup and key contribution.
6. Exports `verification_key.json`.
7. Generates `proof.json` and `public.json`.
8. Verifies proof locally with SnarkJS.
9. Exports Solidity verifier to `contracts/Verifier.sol`.
10. Adds `virtual` to verifier method signature for inheritance compatibility.

Expected generated artifacts (in `circuits/build`):

- `identity.r1cs`
- `identity.sym`
- `identity_js/*` (WASM + witness code)
- `witness.wtns`
- `identity_final.zkey`
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

### 6.3 Deploy `ClaimVerifier.sol`

Deploy the claim verifier contract (currently a mock for testing):

```bash
node scripts/deploy.js -c ClaimVerifier.sol
```

This writes:
- `deployments/localhost/ClaimVerifier.json`

Note: The real ClaimVerifier should be generated from `claim.circom` using the build script. The current version is a mock that always returns true for testing purposes.

### 6.4 Deploy `ZKData.sol`

Before deploying `ZKData.sol`, make sure:

1. `ZKIdentity.sol` is already deployed.
2. `ClaimVerifier.sol` is already deployed.
3. `config/config.json` contains a valid `identityContract` address and `threshold`.
4. `config/InitialManagers.json` contains the manager account list.

Then deploy:

```bash
node scripts/deploy.js -c ZKData.sol
```

Constructor arguments are loaded automatically as:

1. `_zkIdentity` from `deployments/localhost/ZKIdentity.json`
2. `_identityContract` from `config/config.json`
3. `_claimVerifier` from `deployments/localhost/ClaimVerifier.json`
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
7. Start local chain on `127.0.0.1:8545`
8. `node scripts/deploy.js -c ZKIdentity.sol`
9. `node scripts/deploy.js -c ClaimVerifier.sol`
10. `node scripts/deploy.js -c ZKData.sol`
11. Use generated `proof.json` + `public.json` in contract interaction scripts/tests

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
  - `claim.test.ts` - Tests for claim/reward circuit
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

---

## Suggested Next Improvements

- Add a proper framework (`hardhat` or `foundry`) with reproducible deploy scripts.
- Add tests for:
  - proof verification success/failure
  - replay/nullifier protections
  - dispute threshold logic
- Add dedicated scripts for converting SnarkJS proof JSON into Solidity calldata.
- Add network config for non-local deployment (testnet/mainnet) with per-network RPC URLs.

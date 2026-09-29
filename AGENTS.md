# Agents

## Purpose

This project implements a proof-of-concept of the Priv-share protocol, enhanced with zero-knowledge mechanisms for anonymous identity management, privacy-preserving CTI sharing, unlinkable reward extraction, and history-hiding state transitions.

The `History-hiding` branch extends the existing zk-Priv-Share implementation with a **zero-knowledge state-transition mechanism**. The goal is not to eliminate the underlying blockchain's immutable ledger history, but to minimize the amount of **semantic/application-level history** that can be reconstructed from publicly observable state changes.

The implementation uses zk-SNARKs, Poseidon-based Merkle trees, and Solidity smart contracts to preserve verifiability and accountability while hiding sensitive details of application-level state transitions.

### Key Features

* **Anonymous Identity Management**: Users can register identity commitments without revealing their actual identity.

* **Identity Merkle Tree**: Stores identity commitments used for zero-knowledge membership proofs and anonymous protocol operations.

* **History-Hiding State Tree**: Maintains a commitment to the application's private state. State changes are represented by zero-knowledge-proven transitions from an old state root to a new state root rather than by exposing the semantic details of the underlying operation.

* **Zero-Knowledge State Transitions**: A state-transition circuit proves that a valid private state transition occurred without revealing the underlying private state or transition witness.

* **Transition Nullifiers**: Nullifiers prevent unauthorized replay or reuse of a private state transition while avoiding direct exposure of participant identity.

* **Decoupled Reward Tree**: A separate reward Merkle tree is used for shielded reward claims, preserving the separation between CTI activity and reward extraction.

* **Note-Based Reward System**: Rewards are decomposed into fixed-denomination notes (0.001, 0.01, 0.1, 1, 10 ETH) to reduce amount-based correlation and traceability.

* **ZK Proof Verification**: Groth16 proofs are used for anonymous operations, including identity membership, state transitions, reward claiming, and other supported protocol operations.

* **Poseidon Hash Integration**: Poseidon is used consistently between Circom circuits and the corresponding Merkle-tree/state-commitment implementation to maintain cryptographic compatibility.

### History-Hiding Model

The history-hiding extension does **not** claim to remove the immutable history of the underlying blockchain.

Instead, it targets **semantic history leakage**.

The public blockchain may expose information such as:

* previous state roots;
* new state roots;
* transition nullifiers;
* zero-knowledge proofs;
* transaction metadata required by the underlying blockchain.

However, the protocol should avoid exposing the corresponding private application-level transition, such as:

* which private CTI state was modified;
* which contributor performed the operation;
* the private witness used to authorize the transition;
* the semantic contents of the state transition.

The intended transition model is:

```text
Private State S_t
      |
      | Zero-knowledge transition proof
      v
Private State S_(t+1)

Publicly committed as:

StateRoot_t  ->  StateRoot_(t+1)
```

The distinction between **blockchain history** and **semantic/application history** must be preserved throughout the implementation and documentation.

## Tech Stack

* **Circom 2.2.3**: Arithmetic-circuit framework for zero-knowledge circuits.
* **circomlib 2.0.5**: Poseidon and supporting circuit components.
* **SnarkJS**: Groth16 proving, verification, witness generation, and related ZK tooling.
* **circomlibjs 0.1.7**: JavaScript Poseidon implementation and off-chain cryptographic compatibility testing.
* **ethers.js 6.x**: Ethereum interaction and contract testing.
* **solc / Solidity ^0.8.20**: Smart-contract implementation.
* **Hardhat v2**: Ethereum development, compilation, deployment, and testing environment.
* **poseidon-solidity**: Solidity-side Poseidon implementation where required.
* **@zk-kit/incremental-merkle-tree.sol 1.7.0**: Incremental Merkle-tree functionality.
* **Groth16**: Zero-knowledge proving system used by the project.

The project uses a **CommonJS Node.js project structure** and should remain compatible with Hardhat v2. Do not migrate the project to Hardhat v3/ES modules unless explicitly requested.

## Repository Layout

* **`circuits/`**: Circom circuit definitions and implementations

  * `identity.circom`: Identity commitment and Merkle membership proof.
  * `reward.circom`: Reward claiming and slashing-related ZK verification.
  * `state_transition.circom`: History-hiding private state-transition circuit.
  * `lib/merkleTree.circom`: Merkle-tree inclusion proof template.
  * `lib/`: Shared circuit components and cryptographic primitives.

* **`contracts/`**: Solidity smart contracts

  * `ZKIdentity.sol`: Manages identity commitments and the identity Merkle tree.
  * `ZKData.sol`: Handles CTI sharing, access requests, and dispute resolution.
  * `PrivateStateTree.sol`: Manages the history-hiding state root, transition nullifiers, and state-transition proof verification.
  * `RewardVerifier.sol`: Verifier for reward-related ZK proofs.
  * `Verifier.sol`: Auto-generated verifier contract from Circom circuits.
  * Additional auto-generated verifier contracts may exist for the state-transition circuit.

* **`scripts/`**: Deployment and utility scripts

  * `deploy.js`: Contract deployment script.
  * `localRun.sh`: End-to-end local deployment orchestration.
  * `generateMerkleTree.js`: Generates Merkle trees for identity commitments and related testing.
  * `build.sh`: Builds Circom circuits and generates proving/verifying artifacts.

* **`test/`**: Test suites

  * `contracts/`: Solidity contract unit tests.
  * `circuits/`: Circuit correctness and proof-generation tests.
  * `benchmarks/`: Gas and performance benchmarks.
  * `helpers/poseidon.js`: Poseidon hash helper functions for testing.
  * State-transition tests should cover valid transitions, invalid transitions, incorrect roots, and nullifier reuse.

* **`deployments/`**: Deployed contract addresses and artifacts.

* **`docs/`**: Project documentation, including the reference Priv-share article and project documentation.

## State-Transition Architecture

The history-hiding extension should use a dedicated state commitment rather than modifying the existing identity and reward trees to serve multiple purposes.

The intended architecture is:

```text
                 zk-Priv-Share
                       |
        +--------------+--------------+
        |              |              |
        v              v              v
 Identity Tree     State Tree      Reward Tree
        |              |              |
 Identity/ZK       History hiding    Shielded/
 membership        state updates    fixed-denom.
                                      rewards
```

### State Tree

The state tree represents commitments to private application state.

A state leaf should remain compact and should not directly contain large CTI records.

A conceptual state leaf may be represented as:

```text
Poseidon(
    requestId,
    status,
    stateCommitment
)
```

The exact state-leaf structure must be kept minimal and should only be expanded when required by the protocol.

### State Transition

The state-transition circuit should prove:

```text
oldLeaf ∈ oldRoot
        |
        | valid private transition
        v
newLeaf ∈ newRoot
```

The circuit should expose only the minimum public information required for on-chain verification, such as:

```text
oldRoot
newRoot
nullifier
```

Private information should remain circuit witnesses whenever possible.

### Nullifiers

A transition nullifier is used to prevent replay or reuse of a private state transition.

The nullifier must not directly reveal the contributor's identity.

The Solidity state-transition contract should reject a nullifier that has already been consumed.

### State-Root Update

A state transition should be accepted atomically only when:

1. the supplied old root matches the currently committed state root;
2. the transition proof is valid;
3. the transition nullifier has not previously been used.

After successful verification:

```text
stateRoot = newRoot
```

and the nullifier is marked as consumed.

## Design Constraints

### Preserve Existing Privacy Architecture

The history-hiding extension must not unnecessarily replace the existing privacy mechanisms.

The project should retain:

```text
Identity Tree
    +
History-Hiding State Tree
    +
Fixed-Denomination Reward Tree
```

These trees have distinct responsibilities and should not be merged without a clear cryptographic reason.

### Avoid Monolithic Circuits

Do not combine identity verification, CTI processing, rewards, disputes, and state transitions into a single large Circom circuit unless explicitly required.

Prefer small, composable circuits.

In particular, avoid unnecessarily increasing the size of `ZKData.sol` or creating a monolithic state-transition circuit that risks Solidity compiler `stack too deep` errors or excessive memory usage.

### Poseidon Compatibility

Poseidon parameters and input ordering must remain identical between:

* Circom;
* circomlibjs;
* Solidity;
* Merkle-tree implementations.

Any modification to the Poseidon construction must be accompanied by a compatibility test.

Merkle roots generated off-chain must be reproducible by the corresponding Solidity-side implementation when the same tree and hash construction are used.

### No Literal "Zero-History Blockchain" Claim

The implementation must not claim that the underlying blockchain has no history.

The supported claim is:

> The protocol hides or minimizes semantic/application-level history by representing sensitive state changes as zero-knowledge-proven transitions between committed state roots.

Use terminology such as:

* history hiding;
* semantic history hiding;
* history-minimizing state transitions;
* zero-knowledge state evolution.

Avoid describing the implementation as a literal zero-history blockchain unless such functionality is actually implemented and formally demonstrated.

## Working Rules

* **Documentation Updates**: Update `README.md` and relevant project documentation after each major architectural change.

* **Branch Integrity**: This branch is specifically for the history-hiding extension. Preserve the existing zk-Priv-Share functionality while adding the new state-transition mechanism incrementally.

* **Baseline First**: Before modifying the implementation, verify that the existing zk-Priv-Share tests and benchmarks pass. Do not begin history-hiding changes from a broken baseline.

* **Contract Deployment**: After significant contract modifications, ensure the relevant contracts deploy successfully using the existing deployment workflow, for example:

  ```bash
  node scripts/deploy.js -c ZKIdentity.sol
  node scripts/deploy.js -c ZKData.sol
  ```

  and, when implemented:

  ```bash
  node scripts/deploy.js -c PrivateStateTree.sol
  ```

* **Circuit Testing**: After modifications to Circom circuits, run:

  ```bash
  npm run test:circuits
  ```

* **State-Transition Testing**: The history-hiding extension must include tests for:

  * valid state transitions;
  * invalid state transitions;
  * incorrect old roots;
  * incorrect new roots;
  * invalid Merkle membership;
  * reused nullifiers;
  * malformed or invalid proofs.

* **Regression Testing**: Existing identity, CTI, dispute, and reward functionality must continue to pass unless a change is explicitly intended and documented.

* **Benchmarking**: History-hiding changes should be benchmarked separately from the existing system. At minimum, record:

  * proof-generation time;
  * proof size;
  * on-chain verification gas;
  * state-transition transaction gas;
  * relevant state/storage overhead.

* **Contract Modularity**: Prefer a dedicated state-transition/state-tree contract over adding substantial history-hiding logic directly to `ZKData.sol`.

* **No Unnecessary Rewrites**: Reuse existing Poseidon, Merkle-tree, Groth16, and deployment infrastructure wherever possible. The objective is an incremental extension, not a complete rewrite.

## Research/Implementation Objective

The immediate implementation objective of this branch is to demonstrate a minimal but functional history-hiding CTI state transition:

```text
Private CTI State
       |
       | ZK proof of valid transition
       v
New Private CTI State
       |
       v
New State Root
```

The first supported transition should be intentionally simple, such as:

```text
NONEXISTENT -> SUBMITTED
```

or another single well-defined CTI lifecycle transition.

Once this minimal transition is verified end-to-end, additional CTI state transitions may be added incrementally.

The implementation should prioritize:

1. correctness;
2. cryptographic compatibility;
3. privacy properties;
4. modularity;
5. reproducible testing;
6. measurable performance overhead.

The existing fixed-denomination reward-tree architecture should remain intact and should be integrated with the history-hiding state model only after the basic state-transition mechanism has been independently validated.

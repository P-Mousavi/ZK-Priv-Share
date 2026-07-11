# Agents

## Purpose

This project implements a proof-of-concept of the Priv-share protocol, enhanced with zero-knowledge transactions to enable anonymous identity management. The implementation leverages zk-SNARKs to provide privacy-preserving data sharing capabilities while maintaining the integrity and verifiability of the system.

### Key Features

- **Anonymous Identity Management**: Users can register identity commitments without revealing their actual identity
- **Dual-Tree Structure**: Decoupled merkle trees for identity and reward management:
  - **Identity Merkle Tree**: Stores user identity commitments for anonymous access requests
  - **Reward Merkle Tree**: Manages reward claims and slashing mechanisms
- **ZK Proof Verification**: Groth16 proofs for anonymous operations (access requests, disputes, voting)
- **Poseidon Hash Integration**: Uses Poseidon hash for merkle tree computation to ensure compatibility with circom circuits

## Tech Stack

- **SnarkJS**: JavaScript library for zk-SNARKs generation and verification
- **Circom Framework**: Domain-specific language for building arithmetic circuits
- **circomlib**: Library for Poseidon hash and merkle tree circuits
- **ethers.js**: Ethereum library for interacting with smart contracts
- **solc**: Solidity compiler for smart contract deployment (^0.8.20)
- **Hardhat**: Ethereum development environment for testing and deployment

## Repository Layout

- **`circuits/`**: Circom circuit definitions and implementations
  - `identity.circom`: Identity commitment and merkle proof verification
  - `reward.circom`: Reward claiming and slashing verification
  - `lib/merkleTree.circom`: Merkle tree inclusion proof template
- **`contracts/`**: Solidity smart contracts
  - `ZKIdentity.sol`: Manages identity commitments and identity merkle tree
  - `ZKData.sol`: Handles CTI sharing, access requests, and dispute resolution
  - `RewardVerifier.sol`: Verifier for reward-related ZK proofs
  - `Verifier.sol`: Auto-generated verifier contract from circom circuits
- **`scripts/`**: Deployment and utility scripts
  - `deploy.js`: Contract deployment script
  - `localRun.sh`: End-to-end local deployment orchestration
  - `generateMerkleTree.js`: Generates merkle tree for identity commitments
  - `build.sh`: Builds circom circuits
- **`test/`**: Test suites
  - `contracts/`: Contract unit tests
  - `benchmarks/`: Gas benchmarking tests
  - `helpers/poseidon.js`: Poseidon hash helper functions for testing
- **`deployments/`**: Deployed contract addresses and artifacts
- **`docs/`**: Project documentation, including the reference article (Priv-share.pdf)

## Working Rules

- **Documentation Updates**: Update the README.md file after each major change to reflect the current state of the project
- **Contract Deployment**: After each significant modification, ensure main contracts are deployed successfully using:
  ```bash
  node scripts/deploy.js -c ZKIdentity.sol && node scripts/deploy.js -c ZKData.sol
  ```
- **Testing**: Ensure the circuit tests pass after each modification to the main contracts (ZKData.sol and ZKIdentity.sol):
  ```bash
  npm run test:circuits
  ```
- **Poseidon Hash Compatibility**: For full ZK compatibility with circom circuits, merkle tree computation should be performed off-chain using circomlibjs. The on-chain poseidon implementation in ZKIdentity.sol is a simplified version suitable for basic functionality.

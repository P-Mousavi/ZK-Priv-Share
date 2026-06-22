# Agents

## Purpose

This project implements a proof-of-concept of the Priv-share protocol, enhanced with zero-knowledge transactions to enable anonymous identity management. The implementation leverages zk-SNARKs to provide privacy-preserving data sharing capabilities while maintaining the integrity and verifiability of the system.

## Tech Stack

- **SnarkJS**: JavaScript library for zk-SNARKs generation and verification
- **Circom Framework**: Domain-specific language for building arithmetic circuits
- **ethers.js**: Ethereum library for interacting with smart contracts
- **solc**: Solidity compiler for smart contract deployment

## Repository Layout

- **`circuits/`**: Circom circuit definitions and implementations
- **`config/`**: Project configuration files and environment settings
- **`deployment/`**: Deployed contract addresses and related deployment data
- **`docs/`**: Project documentation, including the reference article (Priv-share.pdf)

## Working Rules

- **Documentation Updates**: Update the README.md file after each major change to reflect the current state of the project
- **Contract Deployment**: After each significant modification, ensure main contracts are deployed successfully using:
  ```bash
  node scripts/deploy.js -c ZKIdentity.sol && node scripts/deploy.js -c ZKData.sol
  ```

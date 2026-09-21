#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
node scripts/InitializeEntities.js -n 5 -d 3 -t 3
node scripts/deploy.js -c Identity.sol
node scripts/generateMerkleTree.js
bash scripts/build.sh -c identity -i input.json
bash scripts/build.sh -c reward -i reward_input.json
bash scripts/build.sh -c state_transition -i state_transition_input.json
npm run compile
node scripts/deploy.js -c ZKIdentity.sol
node scripts/deploy.js -c RewardVerifier.sol
node scripts/deploy.js -c StateTransitionVerifier.sol
node scripts/deploy.js -c PrivateStateTree.sol
node scripts/deploy.js -c ZKData.sol

#PATH="/home/spm/.cargo/bin:${PATH}" npx ts-mocha test/circuits/state_transition.test.ts --timeout 300000
#npx hardhat test test/contracts/PrivateStateTree.test.js
#npx hardhat test test/benchmarks/HistoryHidingState.bench.js

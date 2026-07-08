#!/bin/bash
node scripts/InitializeEntities.js -n 5 -d 3 -t 3
node scripts/deploy.js -c Identity.sol
node scripts/generateMerkleTree.js
bash scripts/build.sh -c identity -i input.json
node scripts/deploy.js -c ZKIdentity.sol
node scripts/deploy.js -c RewardVerifier.sol
node scripts/deploy.js -c ZKData.sol

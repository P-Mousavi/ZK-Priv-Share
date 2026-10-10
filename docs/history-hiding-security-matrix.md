# History-hiding security matrix

All cases below are enforced by Circom constraints or Solidity contracts; no
frontend-only check is counted as a protocol control.

| Adversarial case | Enforcement | Test coverage |
| --- | --- | --- |
| Wrong identity root / identity membership | Explicit benchmark-PoC exclusion | `identity.circom` root equality remains commented; excluded by accepted limitation |
| Wrong identity commitment | State/rating/slashing Circom membership witness | `test/circuits/state.test.ts`, `test/circuits/rating.test.ts` |
| Wrong/unfunded stake or amount | Stake commitment and current registry root | `test/circuits/state.test.ts`, `test/contracts/PrivateStateTree.test.js`, `test/contracts/AnonymousSlashing.test.js` |
| Stale state root / state nullifier replay | `PrivateStateTree` current-root and nullifier guards | `test/contracts/PrivateStateTree.test.js`, canonical E2E |
| Mismatched state index / invalid Merkle path | Shared-path Circom constraints | `test/circuits/state.test.ts` |
| Wrong accountability commitment | Recorded accountability binding | `test/contracts/AnonymousSlashing.test.js` |
| Reward replay / invalid membership | Reward root, generated verifier, `NF_reward` | `test/contracts/ShieldedRewardTree.test.js`, canonical E2E |
| Rating replay / invalid proof | Generated rating verifier, binary-rating and nullifier checks | `test/contracts/AnonymousRating.test.js`, canonical E2E |
| Stake replay / invalid slash / missing stake | Generated slashing verifier, accountability/current-root/nullifier checks | `test/contracts/AnonymousSlashing.test.js`, canonical E2E |
| Dispute/slash mismatch | Access dispute binding and resolver-only transition | `test/contracts/AnonymousCtiAccess.test.js`, canonical E2E |
| Unauthorized root/reward issuance updates | State owner/registry checks and `onlyIssuer` reward insertion | `test/contracts/PrivateStateTree.test.js`, `test/contracts/ShieldedRewardTree.test.js`, canonical E2E |
| Producer/consumer/acknowledgement leakage | Commitment-only canonical events and storage | `test/contracts/AnonymousCtiAccess.test.js`, `test/contracts/ShieldedRewardTree.test.js` |
| Owner dispute shortcut | Threshold `AnonymousDisputeResolver` authorization | canonical E2E |

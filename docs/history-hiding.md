# History-hiding implementation status

Status date: October 1, 2026.

This is a research PoC for **semantic/application-history minimization**. It
does not remove Ethereum transaction history. Roots, nullifiers, proof calldata,
transaction metadata, fixed reward denominations, and aggregate ratings remain
public where required for verification.

## Implemented and tested canonical path

The canonical History-hiding path is independent of the legacy address-linked
`ZKData` workflow:

```text
identity commitment + funded stake
  -> real state Groth16 proof
  -> commitment-only CTI publication
  -> real identity access proof
  -> relayed delivery + anonymous Poseidon acknowledgement
  -> real rating proof
  -> threshold-authorized opaque dispute
  -> real slashing proof
  -> later authorized fixed-denomination reward-note issuance
  -> real reward claim proof
```

The executable reference is
`test/history-hiding/history-hiding.e2e.test.js`. It uses generated Groth16
proofs and generated Solidity verifier contracts for state, identity access,
rating, slashing, and reward claim. It also tests replay rejection for state
publication, rating, slashing, and reward claim.

## Canonical commitments and nullifiers

| Value | Construction |
| --- | --- |
| Identity leaf | `Poseidon(identitySecret)` |
| Stake commitment | `Poseidon(identityCommitment, stakeAmount, stakeRandomness)` |
| CTI commitment | `Poseidon(ctiId, version, SHA256(ctiPayload) mod Fr)` |
| State leaf | `Poseidon(requestId, status, ctiCommitment)` |
| Accountability | `Poseidon(stakeCommitment, ctiCommitment, accountabilityRandomness)` |
| State nullifier | `Poseidon(identitySecret, ctiCommitment, STATE)` |
| Stake nullifier | `Poseidon(identitySecret, stakeCommitment, STAKE)` |
| Rating nullifier | `Poseidon(identitySecret, ctiCommitment, RATING)` |
| Reward note | `Poseidon(denomination, noteSecret, noteNullifier)` |
| Reward nullifier | `Poseidon(noteSecret, noteCommitment, REWARD)` |
| Reception acknowledgement | `Poseidon(ctiCommitment, newStateRoot, stateNullifier)` |

The domain constants are defined in `scripts/helpers/ctiCommitment.js` and are
cross-checked across Circom, circomlibjs, and Solidity by
`npm run test:poseidon-compatibility`.

## Tree and contract responsibilities

| Component | Responsibility | Canonical contract |
| --- | --- | --- |
| Identity tree | Commitment registration/deposit record | `ZKIdentity` / `IdentityTree` |
| Stake tree | Funded stake commitment root | `AnonymousStakeRegistry` |
| State tree | Atomic private lifecycle root update and accountability binding | `PrivateStateTree` |
| Reward tree | Fixed-denomination opaque note insertion/claim root | `ShieldedRewardTree` |
| CTI access | Commitment-only publication, access, delivery, acknowledgement, dispute | `AnonymousCtiAccess` |
| Dispute outcome | Manager-threshold resolution of opaque disputes | `AnonymousDisputeResolver` |
| Slashing | Real proof of malicious CTI/accountability/funded stake binding | `AnonymousSlashing` |
| Rating | One binary anonymous rating per rating nullifier | `AnonymousRating` |

## Security coverage

`docs/history-hiding-security-matrix.md` maps replay, malformed-proof, stale
root, stake, accountability, membership-path, authorization, and metadata
leakage cases to their enforcing circuits/contracts and tests. The canonical
E2E specifically rejects direct owner dispute resolution and unauthorized
reward issuance.

## Benchmarked

Run only canonical real-proof benchmarks with:

```bash
npm run benchmark:history-hiding
```

Outputs live in `benchmark-results/history-hiding/`:

- `state-results.json`: state full-prove time, proof size, verification gas,
  transition gas.
- `state-scale.json`: repeated state tree construction and full-prove results
  at N=1, 10, 50, and 100.
- `real-proof-verification.json` / `.csv`: repeated local and EVM verifier
  measurements for identity, state, slashing, rating, and reward.
- `canonical-lifecycle-real-proof.json` / `.csv`: repeated production-proof
  reward insertion/claim, rating, slashing, total lifecycle gas, and wall time.

`HistoryHidingExtended.bench.js` is legacy only: it uses accept-all verifiers
to isolate storage cost and is excluded from `benchmark:history-hiding`.

## Legacy / non-canonical code

- `ZKData.shareCti`, conventional access requests, address-linked disputes,
  and its old reward-note mappings are migration/regression functionality.
- `PrivateStateTree.acceptReceipt` is the older ECDSA/Keccak receipt path.
- `ZKData.testingMode`, `setRewardTreeRoot`, and related helpers are not
  canonical protocol mechanisms.
- Legacy benchmark files may use mocks only when explicitly labelled as such;
  their output is not final cryptographic performance.

## Known limitations and future work

1. `identity.circom` deliberately retains the commented
   `treeVerifier.root === root` constraint. Identity Merkle-root equality and
   membership are not a security claim and are excluded from compatibility and
   benchmark acceptance. This exception must not be re-enabled incidentally.
2. This PoC uses locally generated Groth16 ceremony material; a deployment
   would require an appropriate trusted setup and artifact provenance process.
3. State-scale `fullProve` timing combines witness generation and proving.
   Separate compile and witness-generation timing remains future benchmark
   work.
4. The threat model is application-level semantic-history leakage reduction,
   not transaction-metadata anonymity or a literal history-free blockchain.

## Verification commands

```bash
npm run build:groth16
npm run verify:groth16
npm run test:poseidon-compatibility
npm run test:contracts
npm run test:history-hiding
npm run benchmark:history-hiding
```

# History-hiding implementation checklist

This checklist tracks the phased requirements in `updatedRequirements.md`.
Items are marked complete only after their circuit, contract, real-proof
integration test, and applicable negative tests have passed.

## Phase 0 — Architecture freeze

- [x] Read the finalized architecture, implementation prompt, current audit,
  relevant circuits, contracts, and build workflow.
- [x] Preserve Hardhat v2, CommonJS, Solidity `^0.8.20`, and Circom 2.2.3.
- [x] Keep generated Circom artifacts below `circuits/build/`.
- [x] Record the explicit benchmark exception: `identity.circom` deliberately
  leaves `treeVerifier.root === root` commented out. Identity-tree root
  equality is therefore not a security guarantee in this PoC.
- [x] Run the pre-change regression suite (`npm run test:all`: 106 contract,
  1 history-hiding, and 23 circuit tests passing).

## Implementation phases

- [x] Phase 1 — Canonical identity commitment model, with the explicit root-equality benchmark exception documented below.
  - [x] Canonical History-hiding leaf is `Poseidon(identitySecret)` in identity,
    state, rating, and slashing circuits and proof helpers.
  - [x] `identityNullifierSecret` is separate action-nullifier material.
  - [x] Circom/circomlibjs/Solidity identity-leaf compatibility test passes.
  - [ ] Identity-root equality intentionally remains disabled in `identity.circom`
    per the explicit benchmark instruction; therefore identity membership is
    not a complete protocol security claim.
- [x] Phase 2 — Funded stake commitment membership/binding.
  - [x] `AnonymousStakeRegistry` maintains the canonical append-only funded stake root.
  - [x] State/slashing circuits prove `stakeCommitment` membership under `stakeRoot`.
  - [x] State/slashing contracts reject a stale or unconfigured stake root.
  - [x] A real state Groth16 proof verifies on-chain after funding the exact stake commitment.
- [x] Phase 3 — Same-index atomic state Merkle update.
  - [x] A single private state-tree sibling/path witness derives both old and new roots.
  - [x] A mismatched state-tree index witness fails.
  - [x] The regenerated real state proof verifies on-chain.
- [x] Phase 4 — Durable accountability registration and binding.
  - [x] Full state submission records accountability commitment → CTI commitment.
  - [x] Slashing rejects an unrecorded accountability commitment.
- [x] Phase 5 — Four domain-separated nullifiers.
  - [x] State, stake, rating, and reward use distinct explicit domain constants.
  - [x] Reward circuit/helpers/generated verifier use `Poseidon(secret, noteCommitment, REWARD_DOMAIN)`.
  - [x] A real generated reward proof verifies with the Solidity verifier.
- [x] Phase 6 — Contract-maintained shielded reward tree.
  - [x] `ShieldedRewardTree` appends funded opaque fixed-denomination notes to its canonical Poseidon root.
  - [x] Claims verify real generated reward proofs against the current root and consume `NF_reward`.
  - [x] Canonical reward events contain no producer or recipient address.
- [x] Phase 7 — Real Groth16 rating flow.
  - [x] Rating R1CS/WASM/zkey/verification key/generated Solidity verifier are in `circuits/build/artifacts/rating/`.
  - [x] `AnonymousRating` verifies the real generated proof and consumes `NF_rating`.
  - [x] Real-proof replay, malformed-proof, modified-public-input, and non-binary-rating cases are tested.
- [x] Phase 8 — Real dispute-to-anonymous-slashing flow.
  - [x] `ZKData` forwards guilty resolved-dispute CTI commitments to the configured slashing contract.
  - [x] `AnonymousSlashing` accepts malicious CTIs only from its configured dispute resolver.
  - [x] Real slashing proof, replay, malformed proof, missing accountability, wrong CTI/dispute, and missing funded-stake cases are tested.
- [x] Phase 9 — Canonical anonymous CTI publication/access flow.
  - [x] `AnonymousCtiAccess` publishes CTIs only through the full state-proof path.
  - [x] Access requests use real generated identity proofs and opaque request/access-nullifier commitments.
  - [x] Delivery and dispute records contain only opaque commitments; malicious anonymous dispute outcomes forward to `AnonymousSlashing`.
  - [x] Canonical publication/access/dispute events contain no participant address.
- [x] Phase 10 — Anonymous Poseidon reception acknowledgement.
  - [x] Canonical acknowledgement is `Poseidon(ctiCommitment, newStateRoot, stateNullifier)`.
  - [x] `AnonymousCtiAccess` verifies current root, consumed state nullifier, Poseidon value, and acknowledgement replay.
  - [x] Circom, helper, and Solidity values are cross-checked; canonical acknowledgement events expose no recipient address.
- [x] Phase 11 — Generated Groth16 artifacts and on-chain integration.
  - [x] Regenerate complete circuit-scoped artifact sets for identity, state,
    slashing, rating, and reward.
  - [x] Verify every generated proof locally and through its generated
    Solidity verifier on-chain.
- [x] Phase 12 — Poseidon compatibility matrix.
  - [x] Circom, circomlibjs, and production Solidity Poseidon agree for every
    in-scope canonical leaf, commitment, nullifier, acknowledgement, and
    stake/reward Merkle root.
  - [x] Identity Merkle-root equality/membership remains explicitly excluded
    under the documented benchmark-PoC limitation; the identity leaf remains
    covered.
- [x] Phase 13 — Canonical real-proof end-to-end test.
  - [x] One test creates coordinated witnesses and uses fresh generated proofs
    for state publication, identity access, rating, reward claim, and slashing.
  - [x] The canonical path records accountability, acknowledgement, and
    dispute resolution, then rejects repeated state publication, reward claim,
    rating, and stake slash without deploying a mock verifier.
  - [x] E2E delivery/acknowledgement use canonical commitment-only calls;
    dispute resolution is threshold-authorized and reward issuance is a later
    transaction by a separately authorized issuer.
- [x] Phase 14 — Security and negative-test matrix.
  - [x] Circuit/contract replay, malformed-proof, stale-root, stake,
    accountability, reward, rating, slashing, and leakage cases are mapped to
    enforcement-focused tests in `docs/history-hiding-security-matrix.md`.
  - [x] Canonical E2E rejects direct owner dispute resolution and unauthorized
    reward issuance; identity-root membership remains the documented exclusion.
- [ ] Phase 15 — Real-proof benchmark suite.
  - [x] Canonical benchmark command excludes mock-verifier measurements and
    records repeated real-proof verification metrics in JSON/CSV.
  - [x] Real state-proof scale measurements cover N=1, 10, 50, and 100.
  - [x] Repeated real-proof transaction measurements cover reward insertion/
    claim, rating, slashing, and the full canonical lifecycle.
  - [ ] Separate compilation and witness-generation timing remains future
    benchmark work; current `fullProve` scale timing includes both stages.
- [x] Phase 16 — Implementation-accurate documentation.
  - [x] README and History-hiding documentation distinguish canonical,
    tested, benchmarked, legacy, and future-work paths.
  - [x] Architecture, commitment formulas, nullifiers, all four trees,
    accountability, access/dispute/slashing, rating, acknowledgement, threat
    model, and accepted identity-root limitation are documented accurately.

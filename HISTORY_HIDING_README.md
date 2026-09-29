# History-hiding zk-Priv-Share PoC

This extension is **history-hiding / transaction-history-minimizing**, not a
literal blockchain with no transaction history. The chain necessarily retains
transaction metadata, zero-knowledge proofs, state roots, nullifiers and
required aggregate values. The goal is to prevent direct reconstruction of
the semantic CTI workflow from those public values.

## Architecture

Three trees retain separate roles: the identity tree establishes anonymous
membership, the private state tree commits the current CTI lifecycle state,
and `ShieldedRewardTree` maintains fixed-denomination shielded reward notes.
They are not merged. The minimal state transition is `NONEXISTENT (0) ->
SUBMITTED (1)`.

`stateLeaf = Poseidon(requestId, status, ctiCommitment)` and
`ctiCommitment = Poseidon(ctiId, version, SHA256(cti) mod Fr)`. The optional
extended JavaScript commitment API keeps `category`, `useCase`, and randomness
as independent Poseidon inputs; it never folds them into `ctiId`.

The canonical History-hiding identity leaf is
`identityCommitment = Poseidon(identitySecret)`. `identityNullifierSecret` is
separate secret material used for action-specific identity proofs. The legacy
two-input identity-commitment helper is not part of the canonical
History-hiding path.

## Nullifier domains

All new nullifiers use `Poseidon(secret, context, domain)` with field-safe
constants shared by Circom and `scripts/helpers/ctiCommitment.js`:

| Domain | Constant | Context | Purpose |
| --- | --- | --- | --- |
| State | `0x5354415445` | CTI commitment | blocks state-transition replay |
| Stake | `0x5354414b45` | stake commitment | blocks repeated slashing |
| Rating | `0x524154494e47` | CTI commitment | one rating per participant/CTI |
| Reward | `0x524557415244` | reward-note commitment | blocks reward-note replay |

The accountability binding is
`Poseidon(stakeCommitment, ctiCommitment, accountabilityRandomness)`. It is
separate from the CTI commitment, so normal submissions do not publish a
durable stake-to-CTI link. The off-chain reception acknowledgement is
`Poseidon(ctiCommitment, newStateRoot, stateNullifier)`.

The generated reward circuit and `RewardVerifier.sol` enforce the Reward row
directly: `NF_reward = Poseidon(noteSecret, noteCommitment, REWARD_DOMAIN)`.

## Shielded reward tree

`ShieldedRewardTree` is the canonical reward-note component. An authorized
issuer funds and appends one opaque `Poseidon(denomination, secret, nullifier)`
note at a time. Its append-only Poseidon root is the only root accepted by a
claim. A claim verifies `reward.circom` through the generated
`RewardVerifier.sol`, consumes `NF_reward`, and transfers the note's fixed
denomination without storing or emitting a producer or recipient address.

The older reward-note mappings in `ZKData.sol` are legacy and are not the
canonical history-hiding reward path.

## Anonymous rating

`rating.circom` proves an identity-tree witness, a binary rating, and the
domain-separated `NF_rating` without exposing the rater identity.
`AnonymousRating` uses the generated `RatingVerifier.sol`, consumes the
nullifier, and stores only positive/negative aggregate counts keyed by CTI
commitment.

## Dispute and anonymous slashing

`ZKData` can be configured as the dispute resolver for `AnonymousSlashing`.
When a CTI dispute reaches the existing guilty threshold, it forwards the CTI
commitment to the slashing contract; neither the slashing transaction nor its
events require the participant identity. `slashing.circom` and the generated
`SlashingVerifier.sol` prove the funded stake-tree membership, prior recorded
accountability commitment, CTI binding, and domain-separated `NF_stake`.

## Canonical anonymous CTI access

`AnonymousCtiAccess` is the canonical history-hiding publication/access
component. `publishCti` forwards the full state proof to `PrivateStateTree`
and records only the opaque CTI commitment. `requestAccess` verifies the
generated identity proof against an opaque request commitment and consumes its
access nullifier. Delivery and disputes are recorded as commitments, without
producer, consumer, delegate, CTI payload, or IPFS metadata in canonical
storage/events. A configured dispute resolver can forward a malicious outcome
to `AnonymousSlashing`.

`ZKData.shareCti`, address-linked access requests, and their legacy events
remain for migration/regression compatibility only; they are not used by the
canonical anonymous access test.

## Anonymous reception acknowledgement

The canonical acknowledgement is
`Poseidon(ctiCommitment, newStateRoot, stateNullifier)`. `AnonymousCtiAccess`
recomputes this value with Solidity PoseidonT4, requires the supplied state
root to be current and the state nullifier to have been consumed, and records
the acknowledgement once without a recipient address or signature. The
legacy `PrivateStateTree.acceptReceipt` ECDSA/Keccak receipt remains only for
legacy `ZKData` migration compatibility and is not the canonical path.

## Regenerating real Groth16 artifacts

The canonical proof-bearing circuits are `identity`, `state`, `slashing`,
`rating`, and `reward`. Regenerate all of their R1CS, symbols, WASM, initial
and contributed zkeys, verification keys, witnesses, proofs, public signals,
and generated Solidity verifiers with:

```bash
npm run build:groth16
```

The build requires Circom 2.2.3. By default this PoC uses
`/home/spm/.cargo/bin/circom`; on another environment, set `CIRCOM_BIN` to
that environment's Circom 2.2.3 executable before running the command.

Each circuit's complete artifact set is written below
`circuits/build/artifacts/<circuit>/`; no circuit build artifact belongs at
the repository root. Validate the locally generated proof sets with:

```bash
npm run verify:groth16
npx hardhat test test/contracts/Groth16Artifacts.test.js
```

The latter deploys each generated verifier and verifies its matching generated
proof on-chain. `StateVerifier`, `SlashingVerifier`, `RatingVerifier`,
`RewardVerifier`, and `Verifier` are generated by the same build command and
are the verifier contracts used by the canonical integration paths.

## Poseidon compatibility gate

Run the Phase 12 compatibility matrix with:

```bash
npm run test:poseidon-compatibility
```

It requires equal field elements from Circom, circomlibjs, and the production
`poseidon-solidity` implementation for the identity leaf, stake commitment,
state leaf, CTI commitment, accountability commitment, `NF_state`,
`NF_stake`, `NF_rating`, `NF_reward`, reward-note commitment, reception
acknowledgement, and the contract-maintained stake/reward Merkle roots.

Identity **Merkle-root equality and membership are intentionally excluded**.
The benchmark PoC retains the commented `treeVerifier.root === root` line in
`identity.circom`; Phase 12 neither enables nor validates that constraint.
This documented limitation does not block the other compatibility checks or
History-hiding benchmarks.

## Public/private boundary

| Component | Public | Private |
| --- | --- | --- |
| Identity registration | commitment and deposit | identity secret |
| State proof | identity root, old/new roots, state nullifier, CTI/accountability commitments | identity secret/path, CTI preimage, stake witness, state paths |
| Slashing proof | malicious CTI, accountability commitment, stake nullifier/commitment | identity secret/path and stake randomness |
| Rating proof | identity root, CTI commitment, rating nullifier, binary rating | identity secret/path |
| Reward proof | reward root, denomination, reward nullifier | note secret/nullifier/path |
| Reception acknowledgement | no on-chain identity record | producer-held Poseidon receipt |

`PrivateStateTree` supports the full `state.circom` path through
`submitPrivateCtiWithStateProof` and retains the legacy four-public-input
transition adapter for existing PoC integrations. `AnonymousRating`,
`AnonymousSlashing`, and `AnonymousStakeRegistry` are intentionally separate
enforcement contracts.

## Important PoC limitation

`identity.circom` deliberately leaves `treeVerifier.root === root` commented
out. The deployed Solidity identity tree and circomlib tree have a known
Poseidon-digest mismatch. Therefore identity-root membership is **not** a
security claim of this benchmark configuration. State, rating, slashing, and
reward circuit tests use Circom-compatible roots for their circuit statements.

If another Circom root-equality constraint proves incompatible with the
deployed benchmark tree, that exact constraint is commented out, documented
here and in the implementation checklist, and is not described as an enforced
security property. The funded stake-root constraints are currently enabled and
tested against the registry's compatible Poseidon tree.

## Commands

```bash
npm run test:contracts
npm run test:history-hiding
npm run test:circuits
npm run test:all
bash scripts/build.sh -c state -i circuits/state_input.json
bash scripts/build.sh -c state_transition -i circuits/state_transition_input.json
npm run benchmark:history-hiding
```

The history-hiding benchmark command writes independent measurements to
`benchmark-results/history-hiding/`:

| File | Measurement |
| --- | --- |
| `state-results.json` | real `state.circom` proving, verifier gas, transition gas, storage |
| `slashing.json` | exceptional slash transaction and stake-consumption cost |
| `rating.json` | first, later, and duplicate-rating paths |
| `reward-integration.json` | state submission → asynchronous note mint → relayed claim |
| `metadata-history.json` | ABI-derived legacy versus commitment-only public metadata |
| `end-to-end.json` | state, rating, and slashing lifecycle gas |

The state benchmark uses the real generated Groth16 verifier. The independent
rating and slashing transaction benchmarks deliberately use the local test
verifier so their results isolate enforcement/storage cost from ceremony- and
machine-dependent proof generation time.

`scripts/build.sh` copies each generated `.r1cs`, `.wasm`, `.zkey`, verifying
key, proof, public inputs, and Solidity verifier to
`circuits/build/artifacts/<circuit>/` and validates their presence.

## Benchmark interpretation

History-hiding measurements must remain separate from legacy benchmark output.
They measure proof/witness time, proof size, verifier and transition gas, and
the public metadata surface. They do not claim that roots, nullifiers, proofs,
or blockchain transaction metadata disappear.

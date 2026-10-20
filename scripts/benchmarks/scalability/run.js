// Current canonical contracts only. No mocks, testing modes or root setters.
const hre = require('hardhat');
const { ethers } = hre;
const { groth16 } = require('snarkjs');
const { buildPoseidon } = require('circomlibjs');
const { IncrementalMerkleTree } = require('@zk-kit/incremental-merkle-tree');
const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const H = require('../../helpers/ctiCommitment');
const { sha256, provenance, environment, VERIFIERS } = require('../comparative/common');
const { receiptRecord, summaries } = require('./metrics');
const ROOT = path.resolve(__dirname, '../../..');
const SIZES = (process.env.HH_SCALE_SIZES || '1,10,50,100').split(',').map(Number);
const REWARD_EXTRA_SIZES = (process.env.HH_SCALE_REWARD_EXTRA_SIZES ?? (process.env.HH_SCALE_SIZES ? '' : '32')).split(',').filter(Boolean).map(Number).filter(n => !SIZES.includes(n));
assert(REWARD_EXTRA_SIZES.every(n => Number.isInteger(n) && n > 0 && n <= 128));
const REPETITIONS = Number(process.env.HH_SCALE_REPETITIONS || 2);
assert(SIZES.every(n => Number.isInteger(n) && n > 0 && n <= 128));
assert(Number.isInteger(REPETITIONS) && REPETITIONS > 0);
const OUT = process.env.HH_SCALE_OUT ? path.resolve(process.env.HH_SCALE_OUT) : path.join(ROOT, 'benchmark-results/history-hiding/scalability', new Date().toISOString().replace(/[:.]/g, '-') + '-' + process.pid);
assert(!fs.existsSync(OUT), 'Refusing to overwrite an existing result directory');
fs.mkdirSync(OUT, { recursive: true });
const json = value => JSON.stringify(value, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2) + '\n';
const now = () => process.hrtime.bigint();
const ms = start => Number(now() - start) / 1e6;
const merklePath = proof => ({ pathElements: proof.siblings.map(x => String(x[0])), pathIndices: proof.pathIndices });
const result = { schemaVersion: 2, rewardDepth: 7, rewardCapacity: 128, rewardExtraSizes: REWARD_EXTRA_SIZES, command: 'npm run benchmark:history-hiding:scalability', sizes: SIZES, repetitions: REPETITIONS,
  startedAt: new Date().toISOString(), rows: [], failure: null };
function persist() { fs.writeFileSync(path.join(OUT, 'results.json'), json(result)); }
async function runScale(n, repetition, rewardOnly = false) {
  await hre.network.provider.send('hardhat_reset');
  const row = { n, repetition, rewardOnly, transactions: [], proofs: [], failures: [], completed: { registration: 0, cti: 0, rating: 0, dispute: 0, rewardIssued: 0, rewardClaimed: 0 }, offchainTreeMaintenanceMs: 0 };
  result.rows.push(row);
  const [owner, claimant, issuer, relayer, manager1, manager2] = await ethers.getSigners();
  const poseidon = await buildPoseidon();
  const hash = inputs => BigInt(poseidon.F.toString(poseidon(inputs.map(BigInt))));
  const tree = depth => new IncrementalMerkleTree(hash, depth, 0n, 2);
  async function tx(contract, method, args = [], category = 'operation', signer = owner, label = method) {
    const start = now();
    try {
      const receipt = await (await contract.connect(signer)[method](...args)).wait();
      row.transactions.push(receiptRecord(receipt, contract.benchmarkName, label, args, category, ms(start)));
      return receipt;
    } catch (error) {
      row.failures.push({ method: label, category, args, message: error.shortMessage || error.message,
        receipt: error.receipt ? { hash: error.receipt.hash, status: Number(error.receipt.status), gasUsed: String(error.receipt.gasUsed) } : null });
      throw error;
    }
  }
  async function deploy(name, args = [], libraries) {
    const factory = await ethers.getContractFactory(name, libraries ? { libraries } : undefined);
    const start = now(), contract = await factory.deploy(...args);
    const receipt = await contract.deploymentTransaction().wait();
    contract.benchmarkName = name;
    row.transactions.push(receiptRecord(receipt, name, 'constructor', args, 'deployment', ms(start)));
    return contract;
  }
  const poseidonT3 = await deploy('poseidon-solidity/PoseidonT3.sol:PoseidonT3');
  const incremental = await deploy('@zk-kit/incremental-merkle-tree.sol/IncrementalBinaryTree.sol:IncrementalBinaryTree', [], { PoseidonT3: await poseidonT3.getAddress() });
  const libs = { IncrementalBinaryTree: await incremental.getAddress() };
  const identityRegistry = await deploy('ZKIdentity', [], libs);
  const stakes = await deploy('AnonymousStakeRegistry', [1n, owner.address], libs);
  const identityTree = tree(7), stakeTree = tree(7), stateTree = tree(7);
  const records = [];
  for (let i = 0; i < (rewardOnly ? 0 : n); i++) {
    const secret = BigInt(10000 + repetition * 1000 + i), request = BigInt(20000 + i), ctiId = BigInt(30000 + i), payload = `scale-cti-${n}-${repetition}-${i}`;
    const identity = await H.computeIdentityCommitment(secret), stakeRandomness = BigInt(40000 + i), accountabilityRandomness = BigInt(50000 + i);
    const stake = await H.computeStakeCommitment(identity, 1n, stakeRandomness), cti = await H.computeCtiCommitment(ctiId, 1n, payload);
    await tx(identityRegistry, 'registerIdentity', [identity, { value: ethers.parseEther('1') }]);
    await tx(stakes, 'lockStake', [stake, { value: 1n }]);
    const start = now(); identityTree.insert(identity); stakeTree.insert(stake); stateTree.insert(await H.computeStateLeaf(request, 0n, cti)); row.offchainTreeMaintenanceMs += ms(start);
    records.push({ secret, request, ctiId, payload, identity, stake, stakeRandomness, accountabilityRandomness, cti });
    row.completed.registration++;
  }
  const chainIdentityTree = await ethers.getContractAt('IdentityTree', await identityRegistry.identityTree());
  assert.equal(await chainIdentityTree.getNumberOfLeaves(), BigInt(rewardOnly ? 0 : n));
  assert.equal(await chainIdentityTree.getRoot(), identityTree.root);
  assert.equal(await stakes.stakeRoot(), stakeTree.root);
  const verifiers = {};
  for (const [circuit, name] of Object.entries(VERIFIERS)) verifiers[circuit] = await deploy(`contracts/${name}.sol:Groth16Verifier`);
  const state = await deploy('PrivateStateTree', [stateTree.root, await verifiers.state.getAddress()]);
  await tx(state, 'setStakeRegistry', [await stakes.getAddress()], 'initialization');
  const slashing = await deploy('AnonymousSlashing', [await verifiers.slashing.getAddress(), await stakes.getAddress()]);
  await tx(stakes, 'setSlasher', [await slashing.getAddress()], 'initialization');
  await tx(slashing, 'setStateTree', [await state.getAddress()], 'initialization');
  const poseidonT4 = await deploy('poseidon-solidity/PoseidonT4.sol:PoseidonT4');
  const access = await deploy('AnonymousCtiAccess', [await state.getAddress(), await verifiers.identity.getAddress(), await slashing.getAddress()], { PoseidonT4: await poseidonT4.getAddress() });
  const resolver = await deploy('AnonymousDisputeResolver', [await access.getAddress(), [manager1.address, manager2.address], 2]);
  await tx(access, 'setDisputeResolver', [await resolver.getAddress()], 'initialization');
  await tx(slashing, 'setDisputeResolver', [await access.getAddress()], 'initialization');
  const rating = await deploy('AnonymousRating', [await verifiers.rating.getAddress()]);
  const reward = await deploy('ShieldedRewardTree', [await verifiers.reward.getAddress()], libs);
  await tx(reward, 'setIssuer', [issuer.address, true], 'initialization');
  async function prove(circuit, input) {
    try {
      const dir = path.join(ROOT, 'circuits/build/artifacts', circuit), start = now();
      const generated = await groth16.fullProve(input, path.join(dir, `${circuit}.wasm`), path.join(dir, `${circuit}.zkey`));
      const fullProveMs = ms(start);
      const call = JSON.parse(`[${await groth16.exportSolidityCallData(generated.proof, generated.publicSignals)}]`);
      assert.equal(await verifiers[circuit].verifyProof(...call), true);
      if (!row.proofs.some(p => p.circuit === circuit)) {
        const bad = structuredClone(call); bad[0] = ['0', '0'];
        let rejected = false; try { rejected = !await verifiers[circuit].verifyProof(...bad); } catch (_) { rejected = true; }
        assert(rejected, `${circuit} verifier accepted malformed proof`);
      }
      row.proofs.push({ circuit, fresh: true, input, publicSignals: generated.publicSignals, fullProveMs,
        proofSizeBytes: Buffer.byteLength(JSON.stringify(generated.proof)), calldata: call, verifier: await verifiers[circuit].getAddress() });
      const startTx = now();
      const receipt = await (await owner.sendTransaction({ to: await verifiers[circuit].getAddress(), data: verifiers[circuit].interface.encodeFunctionData('verifyProof', call) })).wait();
      row.transactions.push(receiptRecord(receipt, circuit, 'verifyProof', call, 'verification', ms(startTx)));
      return { a: call[0], b: call[1], c: call[2], signals: call[3].map(BigInt) };
    } catch (error) { row.failures.push({ stage: 'proofGenerationOrVerification', circuit, input, message: error.message }); throw error; }
  }
  try {
    for (let i = 0; i < (rewardOnly ? 0 : n); i++) {
      const r = records[i], idPath = merklePath(identityTree.createProof(i)), stakePath = merklePath(stakeTree.createProof(i));
      const statePath = merklePath(stateTree.createProof(i)), oldRoot = stateTree.root;
      let start = now(); stateTree.update(i, await H.computeStateLeaf(r.request, 1n, r.cti)); row.offchainTreeMaintenanceMs += ms(start);
      const stateNf = await H.computeStateNullifier(r.secret, r.cti), accountability = await H.computeAccountabilityCommitment(r.stake, r.cti, r.accountabilityRandomness);
      const stateProof = await prove('state', {
        identitySecret: String(r.secret), identityPathElements: idPath.pathElements, identityPathIndices: idPath.pathIndices,
        stakeAmount: '1', stakeRandomness: String(r.stakeRandomness), stakePathElements: stakePath.pathElements, stakePathIndices: stakePath.pathIndices,
        accountabilityRandomness: String(r.accountabilityRandomness), ctiId: String(r.ctiId), version: '1', ctiHash: String(H.hashCtiData(r.payload)), requestId: String(r.request),
        statePathElements: statePath.pathElements, statePathIndices: statePath.pathIndices,
        identityRoot: String(identityTree.root), stakeRoot: String(stakeTree.root), oldStateRoot: String(oldRoot), newStateRoot: String(stateTree.root),
        stateNullifier: String(stateNf), ctiCommitment: String(r.cti), accountabilityCommitment: String(accountability) });
      await tx(access, 'publishCti', [stateProof.a, stateProof.b, stateProof.c, ...stateProof.signals]);
      assert.equal(await state.stateRoot(), stateTree.root); assert(await state.usedNullifiers(stateNf)); assert(await state.isAccountabilityRecorded(r.cti, accountability));
      const accessProof = await prove('identity', { identitySecret: String(r.secret), identityNullifierSecret: String(60000 + i), ...idPath, root: String(identityTree.root), actionId: String(r.request) });
      const [accessNf, accessRoot, accessRequest] = accessProof.signals;
      await tx(access, 'requestAccess', [accessProof.a, accessProof.b, accessProof.c, accessRoot, accessNf, accessRequest, r.cti]);
      await tx(access, 'recordDelivery', [r.request, BigInt(70000 + i)], 'operation', relayer);
      const acknowledgement = await H.computeAcknowledgement(r.cti, stateTree.root, stateNf);
      await tx(access, 'recordReceptionAcknowledgement', [r.request, stateTree.root, stateNf, acknowledgement], 'operation', claimant);
      assert((await access.accessRequests(r.request)).acknowledged); row.completed.cti++;
      const ratingNf = await H.computeRatingNullifier(r.secret, r.cti);
      const rp = await prove('rating', { identitySecret: String(r.secret), ...idPath,
        identityRoot: String(identityTree.root), ctiCommitment: String(r.cti), ratingNullifier: String(ratingNf), rating: '1' });
      await tx(rating, 'rate', [rp.a, rp.b, rp.c, ...rp.signals]); assert.equal(await rating.positiveCount(r.cti), 1n); row.completed.rating++;
      const disputeNf = BigInt(80000 + i);
      await tx(access, 'raiseDispute', [r.request, disputeNf, BigInt(90000 + i)]);
      await tx(resolver, 'vote', [r.request, disputeNf, true], 'operation', manager1, 'voteFirst');
      await tx(resolver, 'vote', [r.request, disputeNf, true], 'operation', manager2, 'voteThreshold');
      assert((await access.accessRequests(r.request)).resolved); assert(await slashing.maliciousCti(r.cti));
      const stakeNf = await H.computeStakeNullifier(r.secret, r.stake);
      const sp = await prove('slashing', { identitySecret: String(r.secret), identityPathElements: idPath.pathElements, identityPathIndices: idPath.pathIndices, identityRoot: String(identityTree.root),
        stakeAmount: '1', stakeRandomness: String(r.stakeRandomness), stakePathElements: stakePath.pathElements, stakePathIndices: stakePath.pathIndices,
        accountabilityRandomness: String(r.accountabilityRandomness), maliciousCtiCommitment: String(r.cti), stakeRoot: String(stakeTree.root),
        accountabilityCommitment: String(accountability), stakeNullifier: String(stakeNf), stakeCommitment: String(r.stake) });
      await tx(slashing, 'slash', [sp.a, sp.b, sp.c, ...sp.signals]); assert.equal(await stakes.deposits(r.stake), 0n); assert(await slashing.usedStakeNullifiers(stakeNf)); row.completed.dispute++;
      if ((i + 1) % 10 === 0 || n === 1) console.log(`N=${n} repeat=${repetition}: ${i + 1} acknowledged CTIs, ratings and proof-slashed disputes`);
      if ((i + 1) % 10 === 0) { row.summary = summaries(row); persist(); }
    }
    const rewardDepth = Number(await reward.TREE_DEPTH()), capacity = 2 ** rewardDepth;
    assert.equal(rewardDepth, result.rewardDepth);
    const rewards = tree(rewardDepth), notes = [], denomination = ethers.parseEther('0.001');
    for (let i = 0; i < n; i++) {
      const secret = BigInt(100000 + i), nullifier = BigInt(110000 + i), note = await H.poseidonHash([denomination, secret, nullifier]);
      if (i === capacity) {
        let failed = false;
        try { await tx(reward, 'issueRewardNote', [note, denomination, { value: denomination }], 'capacityProbe', issuer); } catch (_) { failed = true; }
        assert(failed, 'append beyond capacity unexpectedly succeeded');
        assert(row.failures.at(-1).message.includes('IncrementalBinaryTree: tree is full'), 'Unexpected failure at capacity boundary');
        row.failures.at(-1).expectedCapacityLimit = true;
        row.uncompletedRewardNotes = n - capacity;
        row.notAttemptedRewardNotes = n - capacity - 1;
        break;
      }
      await tx(reward, 'issueRewardNote', [note, denomination, { value: denomination }], 'operation', issuer);
      const start = now(); rewards.insert(note); row.offchainTreeMaintenanceMs += ms(start);
      notes.push({ secret, nullifier, note }); row.completed.rewardIssued++;
      assert.equal(await reward.rewardRoot(), rewards.root);
    }
    for (let i = 0; i < notes.length; i++) {
      const note = notes[i], nf = await H.computeRewardNullifier(note.secret, note.note);
      const proof = await prove('reward', { secret: String(note.secret), nullifier: String(note.nullifier), ...merklePath(rewards.createProof(i)), root: String(rewards.root), denomination: String(denomination), nullifierHash: String(nf) });
      await tx(reward, 'claimReward', [proof.a, proof.b, proof.c, ...proof.signals], 'operation', claimant);
      assert(await reward.usedRewardNullifiers(nf)); row.completed.rewardClaimed++;
    }
    assert.equal(await reward.rewardLeafCount(), BigInt(notes.length));
    assert.equal(await ethers.provider.getBalance(await reward.getAddress()), 0n);
    // A claim spends the note but does not free an append slot.
    if (notes.length === capacity) {
      let failed = false; try { await tx(reward, 'issueRewardNote', [123456789n, denomination, { value: denomination }], 'capacityProbeAfterClaims', issuer); } catch (_) { failed = true; }
      assert(failed);
      assert(row.failures.at(-1).message.includes('IncrementalBinaryTree: tree is full'), 'Unexpected failure after claims');
      row.failures.at(-1).expectedCapacityLimit = true;
    }
    row.finalState = { identityLeaves: Number(await chainIdentityTree.getNumberOfLeaves()), stakeLeaves: Number(await stakes.stakeLeafCount()),
      stateRoot: String(await state.stateRoot()), rewardLeaves: Number(await reward.rewardLeafCount()), rewardRoot: String(await reward.rewardRoot()), rewardBalance: '0' };
  } finally { row.summary = summaries(row); persist(); }
  console.log(`N=${n} repeat=${repetition}: complete; reward ${row.completed.rewardClaimed}/${n}, expected capacity probes ${row.failures.length}`);
}
async function main() {
  result.provenance = provenance(); result.environment = { ...environment(), compiler: hre.config.solidity, chainId: 31337, network: 'Hardhat in-memory', evmTarget: 'paris' };
  result.artifactHashes = {};
  for (const c of Object.keys(VERIFIERS)) for (const ext of ['wasm', 'zkey', 'r1cs']) {
    const file = path.join(ROOT, 'circuits/build/artifacts', c, `${c}.${ext}`); result.artifactHashes[path.relative(ROOT, file)] = sha256(file);
  }
  result.definitions = { proofGeneration: 'fresh groth16.fullProve (witness + proving), serialization and verifier calls excluded; every proof fresh',
    verification: 'valid proof reused in standalone transaction to production verifier after eth_call returns true; gas includes transaction calldata overhead; excluded from workflow totals',
    executionTime: 'local send + receipt wall time, excludes proof generation; not public-chain latency',
    stateStrategy: 'N pending leaves precommitted in constructor root, sequential NONEXISTENT -> SUBMITTED at distinct indices; no on-chain state append implemented',
    rewardStrategy: 'append all notes then claim against current root; 128 slots maximum; capacity failure not a successful sample',
    workflowGas: 'sum only actual operation receipts from this same row; registration, CTI, dispute, reward stages separate; rating separate; setup and duplicate verifier probe excluded' };
  persist();
  for (const n of SIZES) for (let r = 1; r <= REPETITIONS; r++) await runScale(n, r);
  for (const n of REWARD_EXTRA_SIZES) for (let r = 1; r <= REPETITIONS; r++) await runScale(n, r, true);
  result.completedAt = new Date().toISOString(); persist();
  require('./report')(OUT);
  console.log(`Results: ${OUT}`);
}
main().then(() => process.exit(0)).catch(error => { result.failure = error.stack; persist(); console.error(error); process.exit(1); });

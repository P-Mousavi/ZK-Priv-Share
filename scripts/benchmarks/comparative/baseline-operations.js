const hre = require('hardhat');
const { write, csv, stats, provenance } = require('./common');
const { deployBaseline } = require('./baseline');

async function main() {
  const trials = Number(process.env.COMPARATIVE_TRIALS || 20);
  if (!Number.isInteger(trials) || trials < 1) throw new Error('Invalid trial count');
  const { identity, data, producer, delegate, consumer } = await deployBaseline();
  const [owner] = await hre.ethers.getSigners();
  const cid = 'Qm' + 'a'.repeat(44);
  await (await identity.setDataContract(await data.getAddress())).wait();
  for (const signer of [producer, delegate, consumer]) await (await identity.connect(signer).registerOrganisation(cid, { value: hre.ethers.parseEther('1') })).wait();
  const shareArgs = [cid, cid, 1n, 1n, [delegate.address], [1n]];
  await (await data.connect(producer).shareCti(...shareArgs)).wait();
  await (await data.connect(consumer).initialRequest(1n, 1n)).wait();
  await (await data.connect(consumer).provideCredentials(1n, cid, { value: 3n })).wait();
  const operations = [
    ['identity', 'registerOrganisation', () => identity.connect(owner).registerOrganisation.staticCall(cid, { value: hre.ethers.parseEther('1') }), 'Address registration with deposit/CID; differs from anonymous membership proof.'],
    ['state', 'shareCti', () => data.connect(producer).shareCti.staticCall(...shareArgs), 'CTI publication with fees, CIDs, and one delegate; differs from private state transition.'],
    ['slashing', 'slashAndReward', () => hre.ethers.provider.call({ from: data.target, to: identity.target, data: identity.interface.encodeFunctionData('slashAndReward', [delegate.address, consumer.address]) }), 'Authorized deposit slash/payment after verdict; differs from accountability proof.'],
    ['reward', 'provideResponse', () => data.connect(delegate).provideResponse.staticCall(1n, cid), 'Response and synchronous 1 wei producer/2 wei delegate payout; differs from separate shielded reward claim.']
  ];
  const results = [];
  for (const [circuit, operation, execute, semantics] of operations) {
    await execute();
    const samples = [];
    for (let trial = 0; trial < trials; trial++) {
      const start = process.hrtime.bigint();
      await execute();
      samples.push(Number(process.hrtime.bigint() - start) / 1e6);
    }
    results.push({ circuit, operation, semantics, success: true, localEvmCallMs: stats(samples), samples,
      proofGenerationMs: null, offchainClientMs: null, directlyComparableToProving: false });
  }
  write('baseline-operations.json', { schemaVersion: 1, provenance: provenance(), definitions: {
    timing: 'Local Hardhat eth_call wall time, including ethers encoding/provider handling and EVM simulation. NOT original off-chain client time or mined transaction latency.',
    setup: 'Compilation, deployments, registration, CTI/request/credentials setup excluded; one warm-up per operation.',
    isolation: 'eth_call discards state changes, so each trial executes against identical prepared state.',
    inputs: 'CID Qm followed by 44 a characters; one CTI/delegate/access level, fees 1 wei each, registration deposit 1 ETH. Different semantics from circuit fixtures; not matched off-chain inputs.',
    unavailable: 'Original baseline has no off-chain client, proof generation, standalone rating, or shielded reward claim implementation. These metrics are null, never zero.' }, results,
    unavailable: [{ circuit: 'rating', reason: 'No rating operation in original baseline.' }] });
  write('baseline-operations.csv', csv(['circuit', 'operation', 'metric', 'samples', 'median_ms', 'mean_ms', 'min_ms', 'max_ms', 'population_stddev_ms', 'comparable_to_proving'], results.map((r) => [r.circuit, r.operation, 'localEvmCallMs', r.localEvmCallMs.count, r.localEvmCallMs.median, r.localEvmCallMs.mean, r.localEvmCallMs.min, r.localEvmCallMs.max, r.localEvmCallMs.standardDeviation, false])));
  console.log('Recorded original baseline operations via local EVM simulation; off-chain client measurements unavailable.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });

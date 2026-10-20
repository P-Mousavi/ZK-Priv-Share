const hre = require('hardhat');
const { deployBaseline } = require('./baseline');
const { write, stats, csv, provenance, receiptGas } = require('./common');

const TRIALS = Math.max(10, Number(process.env.COMPARATIVE_TRIALS || 10));
const CID = 'Qm' + 'a'.repeat(44);

async function main() {
  const rows = new Map([
    ['ctiPublication', { contract: 'DataContract', method: 'shareCti', samples: [] }],
    ['accessRequest', { contract: 'DataContract', method: 'initialRequest', samples: [] }],
    ['credentialSubmission', { contract: 'DataContract', method: 'provideCredentials', samples: [] }],
    ['responseDeliveryAndPayment', { contract: 'DataContract', method: 'provideResponse', samples: [] }],
    ['disputeReporting', { contract: 'DataContract', method: 'raiseDispute', samples: [] }],
    ['disputeNonThresholdVote', { contract: 'DataContract', method: 'voteOnDispute', samples: [] }],
    ['disputeThresholdResolutionVote', { contract: 'DataContract', method: 'voteOnDispute', samples: [] }],
    ['disputeResolutionWorkflow', { contract: 'DataContract', method: 'voteOnDispute (two transactions)', samples: [] }]
  ]);

  for (let trial = 0; trial < TRIALS; trial++) {
    await hre.network.provider.send('hardhat_reset');
    const { identity, data, producer, delegate, consumer, manager1, manager2 } = await deployBaseline();
    await (await identity.setDataContract(await data.getAddress())).wait();
    for (const signer of [producer, delegate, consumer]) {
      await (await identity.connect(signer).registerOrganisation(CID, { value: hre.ethers.parseEther('1') })).wait();
    }

    const shareArgs = [CID, CID, 1n, 1n, [delegate.address], [1n]];
    const record = async (key, txPromise) => {
      const tx = await txPromise;
      const receipt = await tx.wait();
      try { rows.get(key).samples.push(receiptGas(receipt)); }
      catch (error) { throw new Error(`${key} trial ${trial}: ${error.message}`); }
    };

    await record('ctiPublication', data.connect(producer).shareCti(...shareArgs));
    await record('accessRequest', data.connect(consumer).initialRequest(1n, 1n));
    await record('credentialSubmission', data.connect(consumer).provideCredentials(1n, CID, { value: 3n }));
    await record('responseDeliveryAndPayment', data.connect(delegate).provideResponse(1n, CID));
    // CID validation follows the baseline contract's IPFS CIDv0 format.
    await record('disputeReporting', data.connect(consumer).raiseDispute(1n, delegate.address, 1, CID));
    await record('disputeNonThresholdVote', data.connect(manager1).voteOnDispute(1n, true));
    await record('disputeThresholdResolutionVote', data.connect(manager2).voteOnDispute(1n, true));
    rows.get('disputeResolutionWorkflow').samples.push(
      rows.get('disputeNonThresholdVote').samples.at(-1) + rows.get('disputeThresholdResolutionVote').samples.at(-1)
    );
  }

  const operations = [...rows.entries()].map(([operation, value]) => ({
    operation,
    architecture: 'baseline-priv-share',
    revision: provenance().baselineRevision,
    contract: value.contract,
    method: value.method,
    scenario: 'Fresh Hardhat chain and fresh deployment per trial; one registered producer, delegate and consumer; one CTI; 1 wei royalty and computation fees; 3 wei consumption payment; one dispute with two manager votes.',
    verifierType: 'none',
    proofType: 'none',
    sampleCount: value.samples.length,
    transactionGasSamples: value.samples,
    statistics: stats(value.samples),
    comparability: 'baseline measurement only; no History-Hiding paired transaction-gas sample in this run',
    caveats: operation === 'responseDeliveryAndPayment'
      ? ['Includes state update, response event, and synchronous 1 wei producer plus 2 wei delegate payments.']
      : operation === 'disputeThresholdResolutionVote'
        ? ['This is the second manager vote; it reaches threshold and performs baseline deposit settlement.']
        : operation === 'disputeResolutionWorkflow'
          ? ['Derived per-trial sum of the non-threshold vote and threshold-reaching settlement vote; this is a two-transaction workflow.']
          : []
  }));

  const metadata = {
    schemaVersion: 1,
    provenance: provenance(),
    revisionAudit: {
      requestedHistoryHidingRevision: '2a109868533d7dd92737bc3911b108a9559e5b38',
      currentBranchHead: provenance().historyHidingRevision,
      protocolSourcesCompared: ['contracts', 'circuits', 'hardhat.config.js'],
      protocolSourcesMatchRequestedRevision: true,
      currentOnlyChangesInComparedSet: ['package.json: comparative benchmark scripts']
    },
    environment: {
      network: 'Hardhat in-memory EVM',
      chainId: 31337,
      solidity: '0.8.20',
      optimizer: { enabled: true, runs: 200 },
      viaIR: false,
      transactionGasSource: 'successful transaction receipts: receipt.gasUsed',
      requestedTrials: TRIALS,
      trialState: 'Each trial resets the chain, deploys fresh baseline contracts, and repeats identical setup.'
    },
    operations
  };
  write('baseline-transaction-gas.json', metadata);
  write('baseline-transaction-gas.csv', csv(
    ['architecture', 'revision', 'operation', 'contract', 'method', 'sample_count', 'median_gas', 'mean_gas', 'min_gas', 'max_gas', 'population_stddev_gas', 'comparable_pair'],
    operations.map((row) => ['baseline-priv-share', row.revision, row.operation, row.contract, row.method, row.sampleCount,
      row.statistics.median, row.statistics.mean, row.statistics.min, row.statistics.max, row.statistics.standardDeviation, 'no'])
  ));
  const comparison = operations.map((operation) => ({
    operation: operation.operation,
    baselineMedianGas: operation.statistics.median,
    historyHidingMedianGas: null,
    absoluteDifference: null,
    percentageOverhead: null,
    sampleCount: operation.sampleCount,
    comparability: 'unpaired: this capture contains no matched History-Hiding transaction-receipt measurements'
  }));
  write('baseline-only-operation-comparison.json', { schemaVersion: 1, operations: comparison,
    exclusions: [
      { operation: 'History-Hiding CTI publication', reason: 'Requires production state-transition Groth16 proof; this baseline-only capture did not execute it.' },
      { operation: 'History-Hiding access request', reason: 'Requires production identity Groth16 proof and opaque request commitment; not captured here.' },
      { operation: 'Delivery and acknowledgement', reason: 'No equivalent baseline acknowledgement; delivery policy, payment, and recipient binding differ.' },
      { operation: 'Dispute and slashing', reason: 'Authorization and economic enforcement differ; History-Hiding PoC records stake changes without transferring or burning ETH.' },
      { operation: 'Rewards', reason: 'Baseline payment occurs within response delivery; History-Hiding notes are separately issued and claimed.' }
    ]
  });
  write('baseline-only-operation-chart.csv', csv(['operation', 'architecture', 'median_transaction_gas', 'sample_count', 'revision'],
    operations.filter((operation) => operation.operation !== 'disputeResolutionWorkflow')
      .map((operation) => [operation.operation, operation.architecture, operation.statistics.median, operation.sampleCount, operation.revision])));
  write('baseline-only-report.md', [
    '# Baseline Priv-Share transaction gas capture', '',
    `Baseline source revision: \`${metadata.provenance.baselineRevision}\`. Requested History-Hiding source revision: \`${metadata.revisionAudit.requestedHistoryHidingRevision}\`. Current branch HEAD: \`${metadata.provenance.historyHidingRevision}\`. The contracts, circuits, and Hardhat configuration at HEAD match the requested History-Hiding revision; the package file adds comparative benchmark commands.`, '',
    '## Environment and method', '',
    `Hardhat chain ${metadata.environment.chainId}; Solidity ${metadata.environment.solidity}; optimizer enabled (${metadata.environment.optimizer.runs} runs); viaIR ${metadata.environment.viaIR}. Gas is read from successful transaction receipts. ${TRIALS} fresh deployments were used, each with the same registered roles, CTI, fees, request, and dispute setup. Deployment and setup transactions are excluded.`, '',
    '| Operation | Method | Samples | Median gas | Mean gas | Min–max gas | Population SD |', '|---|---|---:|---:|---:|---:|---:|',
    ...operations.map((r) => `| ${r.operation} | ${r.contract}.${r.method} | ${r.sampleCount} | ${r.statistics.median} | ${r.statistics.mean.toFixed(2)} | ${r.statistics.min}–${r.statistics.max} | ${r.statistics.standardDeviation.toFixed(2)} |`), '',
    '## Comparison status', '',
    'This capture measures the original baseline only. History-Hiding transaction gas and all paired deltas/overheads are unavailable, not zero. The chart CSV contains only measured baseline points. The JSON lists candidate exclusions and semantic caveats. Do not use older ZKData benchmark values as History-Hiding measurements.', '',
    'Baseline CTI publication stores producer address, policy/hash CIDs, fee values, and delegate addresses. Baseline response delivery stores a response CID and synchronously transfers royalty/computation payments. History-Hiding publication is proof-verified commitment/state-root publication; its delivery operation only records a delivery commitment. Reception acknowledgement has no baseline equivalent. Dispute/slashing and reward processing also differ in authorization, transfers, note issuance, and eligibility links. Dispute voting is separated into a non-threshold vote, the threshold-reaching vote, and the derived two-transaction workflow sum.', '',
    'These are local Hardhat EVM gas measurements and do not directly predict public-chain fees. Gas measurements do not establish security, anonymity, or unlinkability.', ''
  ].join('\n'));
  console.log(`Recorded ${operations.length} baseline transaction operations across ${TRIALS} fresh deployments.`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });

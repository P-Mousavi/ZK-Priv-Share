const { stats, receiptGas } = require('../comparative/common');
function summarize(values) {
  return values.length ? { aggregate: values.reduce((a, b) => a + b, 0), ...stats(values) } : { aggregate: null, count: 0, median: null, mean: null, min: null, max: null, standardDeviation: null };
}
function receiptRecord(receipt, contract, method, args, category, elapsedMs) {
  const gas = receiptGas(receipt);
  return { category, contract, address: receipt.to || receipt.contractAddress, method, args,
    hash: receipt.hash, blockNumber: receipt.blockNumber, status: Number(receipt.status), gasUsed: gas,
    elapsedMs, logs: receipt.logs.map(l => ({ address: l.address, topics: [...l.topics], data: l.data })) };
}
const workflowMethods = {
  registration: ['registerIdentity', 'lockStake'],
  publicationThroughAcknowledgement: ['publishCti', 'requestAccess', 'recordDelivery', 'recordReceptionAcknowledgement'],
  disputeThroughSlashing: ['raiseDispute', 'voteFirst', 'voteThreshold', 'slash'],
  rewardIssuanceThroughClaim: ['issueRewardNote', 'claimReward']
};
function summaries(row) {
  const transactions = row.transactions.filter(t => t.category === 'operation');
  return {
    operations: Object.fromEntries([...new Set(transactions.map(t => t.method))].map(m => [m, summarize(transactions.filter(t => t.method === m).map(t => t.gasUsed))])),
    workflows: Object.fromEntries(Object.entries(workflowMethods).map(([name, methods]) => [name, {
      methods, successfulTransactions: transactions.filter(t => methods.includes(t.method)).length,
      ...summarize(transactions.filter(t => methods.includes(t.method)).map(t => t.gasUsed))
    }])),
    deployment: summarize(row.transactions.filter(t => t.category === 'deployment').map(t => t.gasUsed)),
    initialization: summarize(row.transactions.filter(t => t.category === 'initialization').map(t => t.gasUsed)),
    verificationOnly: Object.fromEntries([...new Set(row.proofs.map(p => p.circuit))].map(c => [c, summarize(row.transactions.filter(t => t.category === 'verification' && t.contract === c).map(t => t.gasUsed))])),
    proofGenerationMs: Object.fromEntries([...new Set(row.proofs.map(p => p.circuit))].map(c => [c, summarize(row.proofs.filter(p => p.circuit === c).map(p => p.fullProveMs))]))
  };
}
module.exports = { summarize, receiptRecord, summaries };

// Run before and after a circuit/tree capacity change. Writes only a NEW file.
const hre = require('hardhat');
const fs = require('fs');
const assert = require('assert/strict');
async function main() {
  const out = process.env.HH_CAPACITY_METADATA_OUT;
  assert(out && !fs.existsSync(out));
  const deployments = [];
  async function deploy(name, args = [], libraries) {
    const f = await hre.ethers.getContractFactory(name, libraries ? { libraries } : undefined);
    const c = await f.deploy(...args), receipt = await c.deploymentTransaction().wait();
    assert.equal(receipt.status, 1);
    const runtimeBytes = (await hre.ethers.provider.getCode(await c.getAddress())).slice(2).length / 2;
    assert(runtimeBytes <= 24576);
    const trace = await hre.network.provider.send('debug_traceTransaction', [receipt.hash, { disableMemory: true, disableStorage: true }]);
    deployments.push({ contract: name, hash: receipt.hash, status: receipt.status, gasUsed: Number(receipt.gasUsed), runtimeBytes,
      constructorSstoreInstructions: trace.structLogs.filter(l => l.op === 'SSTORE').length });
    return c;
  }
  const poseidon = await deploy('poseidon-solidity/PoseidonT3.sol:PoseidonT3');
  const library = await deploy('@zk-kit/incremental-merkle-tree.sol/IncrementalBinaryTree.sol:IncrementalBinaryTree', [], { PoseidonT3: await poseidon.getAddress() });
  const verifier = await deploy('contracts/RewardVerifier.sol:Groth16Verifier');
  const tree = await deploy('ShieldedRewardTree', [await verifier.getAddress()], { IncrementalBinaryTree: await library.getAddress() });
  const [owner, issuer] = await hre.ethers.getSigners();
  const r = await (await tree.setIssuer(issuer.address, true)).wait();
  fs.writeFileSync(out, JSON.stringify({ depth: Number(await tree.TREE_DEPTH()), capacity: 2 ** Number(await tree.TREE_DEPTH()),
    compiler: hre.config.solidity, network: hre.config.networks.hardhat, deployments,
    initialization: { method: 'setIssuer', hash: r.hash, status: r.status, gasUsed: Number(r.gasUsed) },
    emptyRoot: String(await tree.rewardRoot()), owner: owner.address }, (_, v) => typeof v === 'bigint' ? String(v) : v, 2) + '\n', { flag: 'wx' });
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });

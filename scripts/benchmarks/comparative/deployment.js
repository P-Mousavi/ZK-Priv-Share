const hre = require('hardhat');
const { write, csv, provenance, BASELINE } = require('./common');
const { deployBaseline } = require('./baseline');

async function main() {
  const provenanceData = provenance();
  const architectures = [];
  for (const architecture of ['baseline-priv-share', 'history-hiding']) {
    await hre.network.provider.send('hardhat_reset');
    const contracts = [], initialization = [];
    const record = async (name, contract, receipt, bytecode, args, libraries, compiler) => {
      const address = await contract.getAddress();
      const runtimeBytes = hre.ethers.getBytes(await hre.ethers.provider.getCode(address)).length;
      if (!runtimeBytes || runtimeBytes > 24576) throw new Error(`${name}: actual runtime fails EIP-170 size check`);
      contracts.push({ name, address, revision: architecture === 'baseline-priv-share' ? BASELINE : provenanceData.historyHidingRevision,
        deploymentGas: Number(receipt.gasUsed), runtimeBytes, creationBytes: hre.ethers.getBytes(bytecode).length,
        eip170RuntimeSizePass: true, constructorArguments: args.map((v) => typeof v === 'bigint' ? v.toString() : v), libraries,
        compiler, includesConstructorExecution: true });
    };
    const initialize = async (name, promise) => {
      const receipt = await (await promise).wait();
      initialization.push({ operation: name, gas: Number(receipt.gasUsed) });
    };
    if (architecture === 'baseline-priv-share') {
      const { identity, data } = await deployBaseline(record);
      await initialize('IdentityContract.setDataContract', identity.setDataContract(await data.getAddress()));
    } else {
      const [owner, , issuer, , manager1, manager2] = await hre.ethers.getSigners();
      const deploy = async (name, args = [], libraries = {}) => {
        const factory = await hre.ethers.getContractFactory(name, { libraries });
        const contract = await factory.deploy(...args);
        const receipt = await contract.deploymentTransaction().wait();
        const artifact = await hre.artifacts.readArtifact(name);
        const build = await hre.artifacts.getBuildInfo(`${artifact.sourceName}:${artifact.contractName}`);
        await record(name, contract, receipt, factory.bytecode, args, libraries,
          { version: build.solcVersion, longVersion: build.solcLongVersion, settings: build.input.settings });
        return contract;
      };
      const p3 = await deploy('poseidon-solidity/PoseidonT3.sol:PoseidonT3');
      const tree = await deploy('@zk-kit/incremental-merkle-tree.sol/IncrementalBinaryTree.sol:IncrementalBinaryTree', [], { PoseidonT3: await p3.getAddress() });
      const links = { IncrementalBinaryTree: await tree.getAddress() };
      const identity = await deploy('ZKIdentity', [], links);
      // IdentityTree is created inside ZKIdentity's constructor. Its gas is already included.
      const nestedAddress = await identity.identityTree();
      const nestedBytes = hre.ethers.getBytes(await hre.ethers.provider.getCode(nestedAddress)).length;
      if (!nestedBytes || nestedBytes > 24576) throw new Error('Nested IdentityTree runtime size invalid');
      contracts.push({ name: 'IdentityTree (constructor-created)', address: nestedAddress, revision: provenanceData.historyHidingRevision,
        deploymentGas: null, deploymentGasIncludedIn: 'ZKIdentity', runtimeBytes: nestedBytes,
        creationBytes: hre.ethers.getBytes((await hre.ethers.getContractFactory('IdentityTree', { libraries: links })).bytecode).length,
        eip170RuntimeSizePass: true, constructorArguments: [], libraries: links, compiler: contracts.at(-1).compiler });
      const stakes = await deploy('AnonymousStakeRegistry', [1n, owner.address], links);
      const stateVerifier = await deploy('contracts/StateVerifier.sol:Groth16Verifier');
      const input = require('../../../circuits/build/artifacts/state/input.json');
      const state = await deploy('PrivateStateTree', [BigInt(input.oldStateRoot), await stateVerifier.getAddress()]);
      const slashVerifier = await deploy('contracts/SlashingVerifier.sol:Groth16Verifier');
      const slashing = await deploy('AnonymousSlashing', [await slashVerifier.getAddress(), await stakes.getAddress()]);
      const identityVerifier = await deploy('contracts/Verifier.sol:Groth16Verifier');
      const p4 = await deploy('poseidon-solidity/PoseidonT4.sol:PoseidonT4');
      const access = await deploy('AnonymousCtiAccess', [await state.getAddress(), await identityVerifier.getAddress(), await slashing.getAddress()], { PoseidonT4: await p4.getAddress() });
      await deploy('AnonymousRating', [await (await deploy('contracts/RatingVerifier.sol:Groth16Verifier')).getAddress()]);
      const resolver = await deploy('AnonymousDisputeResolver', [await access.getAddress(), [manager1.address, manager2.address], 2]);
      const reward = await deploy('ShieldedRewardTree', [await (await deploy('contracts/RewardVerifier.sol:Groth16Verifier')).getAddress()], links);
      await initialize('PrivateStateTree.setStakeRegistry', state.setStakeRegistry(await stakes.getAddress()));
      await initialize('AnonymousStakeRegistry.setSlasher', stakes.setSlasher(await slashing.getAddress()));
      await initialize('AnonymousSlashing.setStateTree', slashing.setStateTree(await state.getAddress()));
      await initialize('AnonymousCtiAccess.setDisputeResolver', access.setDisputeResolver(await resolver.getAddress()));
      await initialize('AnonymousSlashing.setDisputeResolver', slashing.setDisputeResolver(await access.getAddress()));
      await initialize('ShieldedRewardTree.setIssuer', reward.setIssuer(issuer.address, true));
    }
    architectures.push({ architecture, contracts, totalDeploymentGas: contracts.reduce((sum, c) => sum + (c.deploymentGas ?? 0), 0),
      contractCount: contracts.length, deploymentTransactionCount: contracts.filter((c) => c.deploymentGas !== null).length,
      initialization, initializationGas: initialization.reduce((sum, i) => sum + i.gas, 0) });
  }
  write('deployment.json', { schemaVersion: 1, provenance: provenanceData, samplesPerArchitecture: 1,
    definitions: { deploymentGas: 'Receipt gasUsed including constructor execution and nested creation; initialization and registration excluded.',
      runtimeBytes: 'eth_getCode on each actual deployed address; EIP-170 runtime size check only.',
      creationBytes: 'Linked factory creation bytecode, excluding ABI constructor arguments.',
      contractSet: 'Original two-contract baseline vs canonical lifecycle benchmark dependencies; nested IdentityTree counted once, gas included in ZKIdentity.',
      funding: 'No deployment funding. Stake denomination 1 wei, two managers and threshold 2, initial state root from generated state fixture.',
      embeddedVerifier: 'ZKIdentity also inherits identity verifier code; separate identity verifier is required by AnonymousCtiAccess.' }, architectures });
  write('deployment.csv', csv(['architecture', 'revision', 'contract', 'deployment_gas', 'gas_included_in', 'runtime_bytes', 'creation_bytes', 'eip170_runtime_size_pass'],
    architectures.flatMap((a) => a.contracts.map((c) => [a.architecture, c.revision, c.name, c.deploymentGas, c.deploymentGasIncludedIn, c.runtimeBytes, c.creationBytes, c.eip170RuntimeSizePass]))));
  console.log(architectures.map((a) => `${a.architecture}: ${a.totalDeploymentGas} deployment gas, ${a.contractCount} contracts`).join('\n'));
}
main().catch((error) => { console.error(error); process.exitCode = 1; });

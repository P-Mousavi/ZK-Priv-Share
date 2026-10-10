const { execFileSync } = require('child_process');
const hre = require('hardhat');
const { TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD } = require('hardhat/builtin-tasks/task-names');
const { BASELINE } = require('./common');

// Read the original contracts verbatim from Git, never the modified current Identity.sol.
async function compileBaseline() {
  const reference = await hre.artifacts.getBuildInfo('contracts/ZKIdentity.sol:ZKIdentity');
  if (!reference) throw new Error('Compile the current contracts first.');
  const sources = Object.fromEntries(['contracts/Identity.sol', 'contracts/data.sol'].map((name) => [name, { content: execFileSync('git', ['show', `${BASELINE}:${name}`], { encoding: 'utf8' }) }]));
  const settings = reference.input.settings;
  const build = await hre.run(TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD, { solcVersion: reference.solcVersion, quiet: true });
  let output;
  if (build.isSolcJs) {
    output = require('solc/wrapper')(require(build.compilerPath)).compile(JSON.stringify({ language: 'Solidity', sources, settings }));
  } else {
    output = execFileSync(build.compilerPath, ['--standard-json'], { input: JSON.stringify({ language: 'Solidity', sources, settings }), maxBuffer: 32 * 1024 * 1024, encoding: 'utf8' });
  }
  const compiled = JSON.parse(output);
  const errors = (compiled.errors || []).filter((error) => error.severity === 'error');
  if (errors.length) throw new Error(errors.map((error) => error.formattedMessage).join('\n'));
  return { contracts: compiled.contracts, compiler: { version: reference.solcVersion, longVersion: reference.solcLongVersion, settings } };
}
async function deployBaseline(record) {
  const compiled = await compileBaseline();
  const [owner, producer, delegate, consumer, manager1, manager2] = await hre.ethers.getSigners();
  const deploy = async (file, name, args) => {
    const item = compiled.contracts[file][name];
    const factory = new hre.ethers.ContractFactory(item.abi, '0x' + item.evm.bytecode.object, owner);
    const contract = await factory.deploy(...args);
    const receipt = await contract.deploymentTransaction().wait();
    if (record) await record(name, contract, receipt, factory.bytecode, args, {}, compiled.compiler);
    return contract;
  };
  const identity = await deploy('contracts/Identity.sol', 'IdentityContract', []);
  const data = await deploy('contracts/data.sol', 'DataContract', [await identity.getAddress(), [manager1.address, manager2.address], 2]);
  return { identity, data, producer, delegate, consumer, manager1, manager2, compiler: compiled.compiler };
}
module.exports = { compileBaseline, deployBaseline };

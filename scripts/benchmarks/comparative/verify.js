const hre = require('hardhat');
const fs = require('fs');
const path = require('path');
const { groth16 } = require('snarkjs');
const { CIRCUITS, VERIFIERS, outputDir, write } = require('./common');

async function main() {
  const results = [];
  for (const circuit of CIRCUITS) {
    const { proof, publicSignals } = JSON.parse(fs.readFileSync(path.join(outputDir(), `proof-${circuit}.json`)));
    const args = JSON.parse(`[${await groth16.exportSolidityCallData(proof, publicSignals)}]`);
    const name = `contracts/${VERIFIERS[circuit]}.sol:Groth16Verifier`;
    const verifier = await (await hre.ethers.getContractFactory(name)).deploy();
    await verifier.waitForDeployment();
    if (!await verifier.verifyProof(...args)) throw new Error(`${circuit} failed production Solidity verification`);
    const badArgs = structuredClone(args);
    badArgs[0] = ['0', '0'];
    let rejectsMalformed = false;
    try { rejectsMalformed = !await verifier.verifyProof(...badArgs); } catch (_) { rejectsMalformed = true; }
    if (!rejectsMalformed) throw new Error(`${circuit} accepted malformed proof`);
    results.push({ circuit, verifier: name, valid: true, rejectsMalformed, onChainVerificationGas: Number(await verifier.verifyProof.estimateGas(...args)) });
  }
  write('verification.json', { schemaVersion: 1, definition: 'One generated measured proof per circuit checked against actual current production Solidity verifier; not included in proving stage timing or deployment aggregate.', results });
  console.log('All five measured proofs accepted by production Solidity verifiers; malformed proofs rejected.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });

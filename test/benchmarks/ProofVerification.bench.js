const { expect } = require("chai");
const { ethers } = require("hardhat");
const { groth16 } = require("snarkjs");
const { buildPoseidon } = require("circomlibjs");
const fs = require("fs");
const path = require("path");

const CIRCUIT_BUILD_DIR = path.join(__dirname, "../../circuits/build");
const RESULTS_PATH = path.join(
  __dirname,
  "../../benchmark-results/proof-verification-results.json"
);
const IDENTITY_TREE_DEPTH = 7;
const REWARD_TREE_DEPTH = 5;

function requireArtifact(relativePath) {
  const artifactPath = path.join(CIRCUIT_BUILD_DIR, relativePath);

  if (!fs.existsSync(artifactPath)) {
    throw new Error(
      `Missing circuit artifact: ${artifactPath}. Run the circuit build before this benchmark.`
    );
  }

  return artifactPath;
}

function calculateIntrinsicGas(data) {
  const bytes = Buffer.from(data.slice(2), "hex");
  let intrinsicGas = 21_000n;

  for (const byte of bytes) {
    intrinsicGas += byte === 0 ? 4n : 16n;
  }

  return intrinsicGas;
}

async function buildMockMerkleProof(poseidon, leaf, treeDepth) {
  const hash = (left, right) =>
    BigInt(poseidon.F.toObject(poseidon([BigInt(left), BigInt(right)])));

  let currentLevel = [
    leaf,
    ...Array.from({ length: 2 ** treeDepth - 1 }, (_, index) =>
      BigInt(index + 1)
    )
  ];
  const pathElements = [];
  const pathIndices = [];
  let leafIndex = 0;

  for (let level = 0; level < treeDepth; level++) {
    pathElements.push(currentLevel[leafIndex ^ 1]);
    pathIndices.push(leafIndex & 1);

    const nextLevel = [];
    for (let index = 0; index < currentLevel.length; index += 2) {
      nextLevel.push(hash(currentLevel[index], currentLevel[index + 1]));
    }

    currentLevel = nextLevel;
    leafIndex = Math.floor(leafIndex / 2);
  }

  return {
    root: currentLevel[0],
    pathElements,
    pathIndices
  };
}

async function exportSolidityProof(proof, publicSignals) {
  const callData = await groth16.exportSolidityCallData(proof, publicSignals);
  const [pA, pB, pC, pubSignals] = JSON.parse(`[${callData}]`);

  return { pA, pB, pC, pubSignals };
}

async function generateIdentityProof(poseidon) {
  const identitySecret = 123456789n;
  const identityNullifier = 987654321n;
  const actionId = 42n;
  const commitment = BigInt(
    poseidon.F.toObject(poseidon([identitySecret, identityNullifier]))
  );
  const merkleProof = await buildMockMerkleProof(poseidon, commitment, IDENTITY_TREE_DEPTH);
  const input = {
    identitySecret: identitySecret.toString(),
    identityNullifier: identityNullifier.toString(),
    pathElements: merkleProof.pathElements.map(String),
    pathIndices: merkleProof.pathIndices,
    root: merkleProof.root.toString(),
    actionId: actionId.toString()
  };
  const { proof, publicSignals } = await groth16.fullProve(
    input,
    requireArtifact("identity_js/identity.wasm"),
    requireArtifact("identity_final.zkey")
  );

  return exportSolidityProof(proof, publicSignals);
}

async function generateRewardProof(poseidon) {
  const denomination = ethers.parseEther("1");
  const secret = 111222333n;
  const nullifier = 444555666n;
  const commitment = BigInt(
    poseidon.F.toObject(poseidon([denomination, secret, nullifier]))
  );
  const nullifierHash = BigInt(
    poseidon.F.toObject(poseidon([nullifier]))
  );
  const merkleProof = await buildMockMerkleProof(poseidon, commitment, REWARD_TREE_DEPTH);
  const input = {
    secret: secret.toString(),
    nullifier: nullifier.toString(),
    pathElements: merkleProof.pathElements.map(String),
    pathIndices: merkleProof.pathIndices,
    root: merkleProof.root.toString(),
    denomination: denomination.toString(),
    nullifierHash: nullifierHash.toString()
  };
  const { proof, publicSignals } = await groth16.fullProve(
    input,
    requireArtifact("reward_js/reward.wasm"),
    requireArtifact("reward_final.zkey")
  );

  return exportSolidityProof(proof, publicSignals);
}

describe("Groth16 verifyProof() Gas Benchmarks", function () {
  this.timeout(300_000);

  let signer;
  let identityVerifier;
  let rewardVerifier;
  let identityProof;
  let rewardProof;
  const results = [];

  before(async function () {
    [signer] = await ethers.getSigners();

    const IdentityVerifier = await ethers.getContractFactory(
      "contracts/Verifier.sol:Groth16Verifier"
    );
    identityVerifier = await IdentityVerifier.deploy();
    await identityVerifier.waitForDeployment();

    const RewardVerifier = await ethers.getContractFactory(
      "contracts/RewardVerifier.sol:Groth16Verifier"
    );
    rewardVerifier = await RewardVerifier.deploy();
    await rewardVerifier.waitForDeployment();

    const poseidon = await buildPoseidon();
    identityProof = await generateIdentityProof(poseidon);
    rewardProof = await generateRewardProof(poseidon);
  });

  after(function () {
    fs.mkdirSync(path.dirname(RESULTS_PATH), { recursive: true });
    fs.writeFileSync(
      RESULTS_PATH,
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          network: "hardhat",
          results
        },
        null,
        2
      )
    );
  });

  async function benchmarkVerification(name, verifier, solidityProof) {
    const args = [
      solidityProof.pA,
      solidityProof.pB,
      solidityProof.pC,
      solidityProof.pubSignals
    ];

    expect(await verifier.verifyProof(...args)).to.equal(true);

    const data = verifier.interface.encodeFunctionData("verifyProof", args);
    const transaction = await signer.sendTransaction({
      to: await verifier.getAddress(),
      data
    });
    const receipt = await transaction.wait();
    const intrinsicGas = calculateIntrinsicGas(data);
    const executionGas = receipt.gasUsed - intrinsicGas;
    const result = {
      circuit: name,
      publicSignals: solidityProof.pubSignals.length,
      calldataBytes: (data.length - 2) / 2,
      transactionGas: receipt.gasUsed.toString(),
      intrinsicGas: intrinsicGas.toString(),
      executionGas: executionGas.toString()
    };

    results.push(result);
    console.log(
      `${name} verifyProof(): ${result.transactionGas} total gas ` +
        `(${result.executionGas} execution gas, ${result.calldataBytes} calldata bytes)`
    );
  }

  it("measures one valid identity proof verification", async function () {
    expect(identityProof.pubSignals).to.have.length(3);
    await benchmarkVerification("identity", identityVerifier, identityProof);
  });

  it("measures one valid reward proof verification", async function () {
    expect(rewardProof.pubSignals).to.have.length(3);
    await benchmarkVerification("reward", rewardVerifier, rewardProof);
  });
});

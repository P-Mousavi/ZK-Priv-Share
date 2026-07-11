const { expect } = require("chai");
const { ethers } = require("hardhat");
const { poseidonHash2 } = require("./helpers/poseidon");

describe("Poseidon Hash Compatibility", function () {
  let zkIdentity;

  before(async function () {
    // Deploy ZKIdentity contract (poseidon is now internal)
    const ZKIdentityFactory = await ethers.getContractFactory("ZKIdentity");
    zkIdentity = await ZKIdentityFactory.deploy();
    await zkIdentity.waitForDeployment();
  });

  it("Should match circomlib poseidon hash for two inputs", async function () {
    // Test with various input pairs
    const testCases = [
      [1, 2],
      [123456789, 987654321],
      [BigInt("0x123456789abcdef"), BigInt("0xfedcba987654321")],
      [0, 1],
      [BigInt("21888242871839275222246405745257275088548364400416034343698204186575808495616"), 0], // FIELD_SIZE - 1
    ];

    for (const [left, right] of testCases) {
      // Compute hash using circomlib JavaScript
      const jsHash = await poseidonHash2(left, right);
      
      // Compute hash using Solidity contract
      const solidityHash = await zkIdentity.testPoseidon(left, right);
      
      console.log(`Testing inputs: ${left}, ${right}`);
      console.log(`JS hash: ${jsHash}`);
      console.log(`Solidity hash: ${solidityHash}`);
      
      // They should match
      expect(BigInt(solidityHash)).to.equal(jsHash);
    }
  });

  it("Should produce consistent merkle roots", async function () {
    // Test that merkle tree computation is consistent
    const leaves = [
      await poseidonHash2(1, 2),
      await poseidonHash2(3, 4),
      await poseidonHash2(5, 6),
    ];

    // Register identities to build merkle tree
    const [signer] = await ethers.getSigners();
    const deposit = ethers.parseEther("1");

    for (const leaf of leaves) {
      const tx = await zkIdentity.connect(signer).registerIdentity(leaf, {
        value: deposit,
      });
      await tx.wait();
    }

    // Get the current root from contract
    const contractRoot = await zkIdentity.currentRoot();
    console.log(`Contract merkle root: ${contractRoot}`);
    
    // Compute expected root manually using circomlib poseidon
    let level = leaves;
    while (level.length > 1) {
      const newLevel = [];
      for (let i = 0; i < level.length; i += 2) {
        const left = level[i];
        const right = level[i + 1] || left;
        const hash = await poseidonHash2(left, right);
        newLevel.push(hash);
      }
      level = newLevel;
    }
    const expectedRoot = level[0];
    
    console.log(`Expected merkle root: ${expectedRoot}`);
    
    // They should match
    expect(BigInt(contractRoot)).to.equal(expectedRoot);
  });
});

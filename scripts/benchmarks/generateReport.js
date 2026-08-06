const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

/**
 * Comprehensive Gas Comparison Report Generator
 * 
 * This script runs all benchmark tests and generates a comprehensive
 * academic-grade report comparing Standard vs ZK implementations.
 */

class ReportGenerator {
  constructor() {
    this.resultsDir = path.join(__dirname, "../../benchmark-results");
    this.reportsDir = path.join(__dirname, "../../reports");
    
    if (!fs.existsSync(this.resultsDir)) {
      fs.mkdirSync(this.resultsDir, { recursive: true });
    }
    if (!fs.existsSync(this.reportsDir)) {
      fs.mkdirSync(this.reportsDir, { recursive: true });
    }
    
    this.benchmarkResults = {
      identity: {},
      cti: {},
      dispute: {},
      reward: {},
      deployment: {},
      offchain: {},
      proofVerification: {}
    };
  }

  async runBenchmark(testFile) {
    try {
      console.log(`Running ${testFile}...`);
      const output = execSync(`npx hardhat test ${testFile} --grep "Benchmark"`, {
        cwd: path.join(__dirname, "../.."),
        encoding: "utf8"
      });
      console.log(`Completed ${testFile}`);
      return output;
    } catch (error) {
      console.log(`Error running ${testFile}: ${error.message}`);
      return null;
    }
  }

  async runOffChainBenchmark() {
    try {
      console.log(`Running off-chain proving benchmarks...`);
      const ProvingBenchmark = require("./offChainProving.bench");
      const benchmark = new ProvingBenchmark();
      await benchmark.runAllBenchmarks();
      
      // Load results
      const resultsPath = path.join(this.resultsDir, "offchain-proving-results.json");
      if (fs.existsSync(resultsPath)) {
        this.benchmarkResults.offchain = JSON.parse(fs.readFileSync(resultsPath, "utf8"));
      }
    } catch (error) {
      console.log(`Error running off-chain benchmarks: ${error.message}`);
    }
  }

  async collectAllResults() {
    console.log(`\n=== Collecting Benchmark Results ===`);

    // Load deployment results if available
    const deploymentPath = path.join(this.resultsDir, "deployment-results.json");
    if (fs.existsSync(deploymentPath)) {
      this.benchmarkResults.deployment = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));
    }

    // Load off-chain results if available
    const offchainPath = path.join(this.resultsDir, "offchain-proving-results.json");
    if (fs.existsSync(offchainPath)) {
      this.benchmarkResults.offchain = JSON.parse(fs.readFileSync(offchainPath, "utf8"));
    }

    // Load identity results if available
    const identityPath = path.join(this.resultsDir, "identity-results.json");
    if (fs.existsSync(identityPath)) {
      this.benchmarkResults.identity = JSON.parse(fs.readFileSync(identityPath, "utf8"));
    }

    // Load CTI results if available
    const ctiPath = path.join(this.resultsDir, "cti-results.json");
    if (fs.existsSync(ctiPath)) {
      this.benchmarkResults.cti = JSON.parse(fs.readFileSync(ctiPath, "utf8"));
    }

    // Load dispute results if available
    const disputePath = path.join(this.resultsDir, "dispute-results.json");
    if (fs.existsSync(disputePath)) {
      this.benchmarkResults.dispute = JSON.parse(fs.readFileSync(disputePath, "utf8"));
    }

    // Load reward results if available
    const rewardPath = path.join(this.resultsDir, "reward-results.json");
    if (fs.existsSync(rewardPath)) {
      this.benchmarkResults.reward = JSON.parse(fs.readFileSync(rewardPath, "utf8"));
    }

    // Load proof verification results if available
    const proofVerificationPath = path.join(this.resultsDir, "proof-verification-results.json");
    if (fs.existsSync(proofVerificationPath)) {
      this.benchmarkResults.proofVerification = JSON.parse(fs.readFileSync(proofVerificationPath, "utf8"));
    }
  }

  getDeploymentData(contractName) {
    const deployment = this.benchmarkResults.deployment.find(d => 
      d.contract === contractName || 
      d.contract.includes(contractName)
    );
    if (deployment) {
      return {
        gas: deployment.deploymentGas,
        bytecode: deployment.bytecodeSize,
        compliance: deployment.bytecodeSize <= 24576 ? "PASS" : "FAIL",
        usage: ((deployment.bytecodeSize / 24576) * 100).toFixed(2)
      };
    }
    return null;
  }

  generateMarkdownReport() {
    const reportDate = new Date().toISOString();
    
    // Get actual deployment data from benchmark results
    const identityData = this.getDeploymentData("IdentityContract");
    const zkIdentityData = this.getDeploymentData("ZKIdentity");
    const verifierData = this.getDeploymentData("Verifier");
    const rewardVerifierData = this.getDeploymentData("RewardVerifier");
    const zkDataData = this.getDeploymentData("ZKDataContract");
    
    let markdown = `# Priv-Share vs ZK-Priv-Share: Gas Cost Comparison Report\n\n`;
    markdown += `**Generated:** ${reportDate}\n`;
    markdown += `**Framework:** Hardhat v2 with hardhat-gas-reporter\n`;
    markdown += `**Purpose:** Academic benchmarking of privacy vs efficiency trade-offs\n\n`;
    
    markdown += `## Executive Summary\n\n`;
    markdown += `This report provides a comprehensive gas cost analysis comparing the standard Priv-Share implementation against the zero-knowledge enhanced ZK-Priv-Share variant. The benchmarks cover all phases of the CTI lifecycle: Identity & Registration, CTI Submission & Consumption, Dispute & Regulation, and Reward Claiming.\n\n`;
    
    markdown += `### Key Findings\n\n`;
    markdown += `- **Average Gas Overhead:** N/A (requires actual measurement)\n`;
    markdown += `- **Privacy Premium:** N/A (requires actual measurement)\n`;
    markdown += `- **Deployment Overhead:** N/A (requires actual measurement)\n`;
    markdown += `- **Off-Chain Proving:** N/A (requires actual measurement)\n\n`;
    
    markdown += `## 1. Identity & Registration Phase\n\n`;
    markdown += `### Comparison: registerOrganisation() vs registerIdentity()\n\n`;
    markdown += `| Metric | Standard | ZK | Overhead |\n`;
    markdown += `|--------|----------|-----|----------|\n`;

    // Use identity benchmark results if available
    const registerOrgGas = this.benchmarkResults.identity.registerOrganisation;
    const registerIdGas = this.benchmarkResults.identity.registerIdentity;

    if (registerOrgGas && registerIdGas) {
      const overhead = parseInt(registerIdGas) - parseInt(registerOrgGas);
      const percent = ((overhead / parseInt(registerOrgGas)) * 100).toFixed(0);
      markdown += `| Single Registration | ${registerOrgGas} gas | ${registerIdGas} gas | ${overhead} gas (${percent}% increase) |\n`;
    } else if (identityData && zkIdentityData) {
      const overhead = parseInt(zkIdentityData.gas) - parseInt(identityData.gas);
      const percent = ((overhead / parseInt(identityData.gas)) * 100).toFixed(0);
      markdown += `| Single Registration | ${identityData.gas} gas | ${zkIdentityData.gas} gas | ${overhead} gas (${percent}% increase) |\n`;
    } else {
      markdown += `| Single Registration | N/A | N/A | N/A |\n`;
    }
    markdown += `| Storage Type | Mapping (address → Org) | Mapping (commitment → deposit) + Merkle Tree | N/A |\n`;
    markdown += `| Privacy Level | None (public addresses) | High (commitment-based) | N/A |\n\n`;

    markdown += `### Analysis\n\n`;
    markdown += `The ZK registration overhead primarily comes from:\n`;
    if (registerOrgGas && registerIdGas) {
      const overhead = parseInt(registerIdGas) - parseInt(registerOrgGas);
      markdown += `- Merkle tree insertion: ${overhead} gas overhead\n`;
      markdown += `- Root computation and storage\n`;
      markdown += `- Additional commitment mapping\n\n`;
    } else {
      markdown += `- Merkle tree insertion (requires actual measurement)\n`;
      markdown += `- Root computation and storage (requires actual measurement)\n`;
      markdown += `- Additional commitment mapping (requires actual measurement)\n\n`;
    }
    
    markdown += `### Deployment Comparison\n\n`;
    markdown += `| Contract | Deployment Gas | Bytecode Size | EIP-170 Compliance |\n`;
    markdown += `|----------|----------------|---------------|-------------------|\n`;
    if (identityData) {
      markdown += `| IdentityContract | ${identityData.gas} gas | ${identityData.bytecode} bytes | ${identityData.compliance} |\n`;
    } else {
      markdown += `| IdentityContract | N/A | N/A | N/A |\n`;
    }
    if (zkIdentityData) {
      markdown += `| ZKIdentity | ${zkIdentityData.gas} gas | ${zkIdentityData.bytecode} bytes | ${zkIdentityData.compliance} |\n`;
    } else {
      markdown += `| ZKIdentity | N/A | N/A | N/A |\n`;
    }
    if (verifierData) {
      markdown += `| Verifier.sol | ${verifierData.gas} gas | ${verifierData.bytecode} bytes | ${verifierData.compliance} |\n`;
    } else {
      markdown += `| Verifier.sol | N/A | N/A | N/A |\n`;
    }
    markdown += `\n`;
    
    markdown += `## 2. CTI Submission & Consumption Phase\n\n`;
    markdown += `### Comparison: provideResponse() vs provideResponseZK()\n\n`;
    markdown += `| Metric | Standard | ZK | Overhead |\n`;
    markdown += `|--------|----------|-----|----------|\n`;
    if (this.benchmarkResults.cti) {
      const shareCti = this.benchmarkResults.cti.shareCti;
      const provideResponse = this.benchmarkResults.cti.provideResponse;
      const requestAccess = this.benchmarkResults.cti.requestAccess;
      const provideResponseZK = this.benchmarkResults.cti.provideResponseZK;
      
      if (shareCti) {
        markdown += `| shareCti() | ${shareCti} gas | ${shareCti} gas | 0% (identical) |\n`;
      } else {
        markdown += `| shareCti() | N/A | N/A | N/A |\n`;
      }
      if (provideResponse) {
        markdown += `| provideResponse() | ${provideResponse} gas | N/A | N/A |\n`;
      } else {
        markdown += `| provideResponse() | N/A | N/A | N/A |\n`;
      }
      if (provideResponseZK) {
        markdown += `| provideResponseZK() | N/A | ${provideResponseZK} gas | N/A |\n`;
      } else {
        markdown += `| provideResponseZK() | N/A | N/A | N/A |\n`;
      }
      if (provideResponse && requestAccess && provideResponseZK) {
        const standardCycle = parseInt(provideResponse) + parseInt(requestAccess);
        const zkCycle = parseInt(provideResponseZK);
        const overhead = zkCycle - standardCycle;
        const percent = ((overhead / standardCycle) * 100).toFixed(0);
        markdown += `| Complete Response Cycle | ${standardCycle} gas | ${zkCycle} gas | ${overhead} gas (${percent}% increase) |\n\n`;
      } else {
        markdown += `| Complete Response Cycle | N/A | N/A | N/A |\n\n`;
      }
    } else {
      markdown += `| shareCti() | N/A | N/A | N/A |\n`;
      markdown += `| provideResponse() | N/A | N/A | N/A |\n`;
      markdown += `| provideResponseZK() | N/A | N/A | N/A |\n`;
      markdown += `| Complete Response Cycle | N/A | N/A | N/A |\n\n`;
    }
    
    markdown += `### ZK Proof Verification Breakdown\n\n`;
    markdown += `The primary overhead in provideResponseZK() comes from zk-SNARK verification:\n`;

    // Use proof verification results if available
    const proofResults = Array.isArray(this.benchmarkResults.proofVerification.results) ? this.benchmarkResults.proofVerification.results : [];
    const identityProofResult = proofResults.find(r => r.circuit === "identity");
    const rewardProofResult = proofResults.find(r => r.circuit === "reward");

    if (identityProofResult) {
      markdown += `- Identity proof verification: ${identityProofResult.executionGas} execution gas (${identityProofResult.transactionGas} total gas)\n`;
    } else {
      markdown += `- Identity proof verification (requires actual measurement)\n`;
    }

    if (rewardProofResult) {
      markdown += `- Reward proof verification: ${rewardProofResult.executionGas} execution gas (${rewardProofResult.transactionGas} total gas)\n`;
    } else {
      markdown += `- Reward proof verification (requires actual measurement)\n`;
    }

    markdown += `- Merkle root validation (requires actual measurement)\n`;
    markdown += `- Nullifier check (SSTORE) (requires actual measurement)\n`;
    markdown += `- Reward tree minting (requires actual measurement)\n\n`;
    
    markdown += `### Academic Significance\n\n`;
    markdown += `The ZK response verification overhead represents the core privacy-efficiency trade-off. This cost is justified in privacy-critical applications where:\n`;
    markdown += `- Delegate identity must remain anonymous\n`;
    markdown += `- Request-response linkage must be broken\n`;
    markdown += `- Long-term privacy guarantees are required\n\n`;
    
    markdown += `## 3. Dispute & Regulation Phase\n\n`;
    markdown += `### Comparison: voteOnDispute() vs voteOnDisputeZK()\n\n`;
    markdown += `| Metric | Standard | ZK | Overhead |\n`;
    markdown += `|--------|----------|-----|----------|\n`;
    if (this.benchmarkResults.dispute) {
      const raiseDispute = this.benchmarkResults.dispute.raiseDispute;
      const voteOnDispute = this.benchmarkResults.dispute.voteOnDispute;
      const raiseDisputeZK = this.benchmarkResults.dispute.raiseDisputeZK;
      const voteOnDisputeZK = this.benchmarkResults.dispute.voteOnDisputeZK;
      
      if (raiseDispute && raiseDisputeZK) {
        const overhead = parseInt(raiseDisputeZK) - parseInt(raiseDispute);
        const percent = ((overhead / parseInt(raiseDispute)) * 100).toFixed(0);
        markdown += `| raiseDispute() | ${raiseDispute} gas | ${raiseDisputeZK} gas | ${overhead} gas (${percent}% increase) |\n`;
      } else {
        markdown += `| raiseDispute() | N/A | N/A | N/A |\n`;
      }
      if (voteOnDispute && voteOnDisputeZK) {
        const overhead = parseInt(voteOnDisputeZK) - parseInt(voteOnDispute);
        const percent = ((overhead / parseInt(voteOnDispute)) * 100).toFixed(0);
        markdown += `| voteOnDispute() | ${voteOnDispute} gas | ${voteOnDisputeZK} gas | ${overhead} gas (${percent}% increase) |\n`;
      } else {
        markdown += `| voteOnDispute() | N/A | N/A | N/A |\n`;
      }
      markdown += `| Complete Dispute Resolution | N/A | N/A | N/A |\n\n`;
    } else {
      markdown += `| raiseDispute() | N/A | N/A | N/A |\n`;
      markdown += `| voteOnDispute() | N/A | N/A | N/A |\n`;
      markdown += `| Complete Dispute Resolution | N/A | N/A | N/A |\n\n`;
    }
    
    markdown += `### Anonymous vs Public Voting\n\n`;
    markdown += `**Standard Approach (Public):**\n`;
    markdown += `- Address-based voting: Low gas, no privacy\n`;
    markdown += `- Public account tracking: Transparent but privacy-invasive\n`;
    markdown += `- Direct slashing: Efficient but exposes participants\n\n`;
    
    markdown += `**ZK Approach (Anonymous):**\n`;
    markdown += `- Nullifier-based voting: High gas, complete privacy\n`;
    markdown += `- Anonymous identity verification: Prevents collusion\n`;
    markdown += `- Anonymous slashing: Protects voter identity\n\n`;
    
    markdown += `### Privacy Premium Analysis\n\n`;
    markdown += `The dispute phase shows significant privacy overhead because:\n`;
    markdown += `- Each vote requires ZK proof verification\n`;
    markdown += `- Nullifier management adds storage costs\n`;
    markdown += `- Anonymous slashing requires additional tree operations\n\n`;
    
    markdown += `## 4. Reward Claiming Phase\n\n`;
    markdown += `### Comparison: Direct Payment vs claimReward()\n\n`;
    markdown += `| Metric | Standard | ZK | Overhead |\n`;
    markdown += `|--------|----------|-----|----------|\n`;
    if (this.benchmarkResults.reward) {
      const claimReward = this.benchmarkResults.reward.claimReward;
      const depositReward = this.benchmarkResults.reward.depositReward;
      if (claimReward) {
        markdown += `| claimReward() | N/A | ${claimReward} gas | N/A |\n`;
      } else {
        markdown += `| claimReward() | N/A | N/A | N/A |\n`;
      }
      if (depositReward) {
        markdown += `| depositReward() (minting) | N/A | ${depositReward} gas | N/A |\n`;
      } else {
        markdown += `| depositReward() (minting) | N/A | N/A | N/A |\n`;
      }
      if (depositReward && claimReward) {
        const totalGas = parseInt(depositReward) + parseInt(claimReward);
        markdown += `| Complete Reward Cycle | N/A | ${totalGas} gas | N/A |\n\n`;
      } else {
        markdown += `| Complete Reward Cycle | N/A | N/A | N/A |\n\n`;
      }
    } else {
      markdown += `| Payment (in provideResponse) | N/A | N/A | N/A |\n`;
      markdown += `| Reward Minting (in provideResponseZK) | N/A | N/A | N/A |\n`;
      markdown += `| claimReward() | N/A | N/A | N/A |\n`;
      markdown += `| Complete Reward Cycle | N/A | N/A | N/A |\n\n`;
    }
    
    markdown += `### Decoupled Anonymity Pool Analysis\n\n`;
    markdown += `The ZK reward system introduces a decoupled architecture:\n\n`;
    markdown += `**Benefits:**\n`;
    markdown += `- Complete payout anonymity\n`;
    markdown += `- Flexible claiming timeline\n`;
    markdown += `- Fresh recipient addresses break linkage\n\n`;
    
    markdown += `**Costs:**\n`;
    markdown += `- Additional transaction required\n`;
    markdown += `- ZK proof verification for each claim\n`;
    markdown += `- Reward tree management overhead\n\n`;
    
    markdown += `### Financial Trade-off\n\n`;
    markdown += `**Scenario: 100 CTI responses with rewards**\n\n`;
    markdown += `Standard Approach:\n`;
    markdown += `- Total gas: N/A\n`;
    markdown += `- Cost at 20 gwei: N/A\n\n`;
    
    markdown += `ZK Approach:\n`;
    markdown += `- Total gas: N/A\n`;
    markdown += `- Cost at 20 gwei: N/A\n`;
    markdown += `- Privacy premium: N/A\n\n`;
    
    markdown += `## 5. Deployment Analysis\n\n`;
    markdown += `### Contract Bytecode Sizes\n\n`;
    markdown += `| Contract | Bytecode Size | EIP-170 Limit | Usage | Compliance |\n`;
    markdown += `|----------|--------------|--------------|-------|------------|\n`;
    if (identityData) {
      markdown += `| IdentityContract | ${identityData.bytecode} bytes | 24,576 bytes | ${identityData.usage}% | ${identityData.compliance} |\n`;
    } else {
      markdown += `| IdentityContract | N/A | N/A | N/A | N/A |\n`;
    }
    if (zkIdentityData) {
      markdown += `| ZKIdentity | ${zkIdentityData.bytecode} bytes | 24,576 bytes | ${zkIdentityData.usage}% | ${zkIdentityData.compliance} |\n`;
    } else {
      markdown += `| ZKIdentity | N/A | N/A | N/A | N/A |\n`;
    }
    if (verifierData) {
      markdown += `| Verifier.sol | ${verifierData.bytecode} bytes | 24,576 bytes | ${verifierData.usage}% | ${verifierData.compliance} |\n`;
    } else {
      markdown += `| Verifier.sol | N/A | N/A | N/A | N/A |\n`;
    }
    if (rewardVerifierData) {
      markdown += `| RewardVerifier.sol | ${rewardVerifierData.bytecode} bytes | 24,576 bytes | ${rewardVerifierData.usage}% | ${rewardVerifierData.compliance} |\n`;
    } else {
      markdown += `| RewardVerifier.sol | N/A | N/A | N/A | N/A |\n`;
    }
    if (zkDataData) {
      markdown += `| ZKDataContract | ${zkDataData.bytecode} bytes | 24,576 bytes | ${zkDataData.usage}% | ${zkDataData.compliance}${zkDataData.compliance === 'FAIL' ? ' ⚠️' : ''} |\n\n`;
    } else {
      markdown += `| ZKDataContract | N/A | N/A | N/A | N/A |\n\n`;
    }
    
    // Check if any contract fails EIP-170
    const hasFailures = (identityData?.compliance === 'FAIL') || 
                        (zkIdentityData?.compliance === 'FAIL') || 
                        (verifierData?.compliance === 'FAIL') || 
                        (rewardVerifierData?.compliance === 'FAIL') || 
                        (zkDataData?.compliance === 'FAIL');
    
    if (hasFailures) {
      markdown += `### EIP-170 Compliance Issues\n\n`;
      markdown += `**WARNING:** One or more contracts exceed the EIP-170 limit of 24,576 bytes.\n\n`;
      markdown += `**Recommendations:**\n`;
      markdown += `- Split large contracts into multiple contracts\n`;
      markdown += `- Move verifier logic to separate library\n`;
      markdown += `- Use proxy patterns for upgradeability\n`;
      markdown += `- Optimize Solidity code and remove unused functions\n\n`;
    }
    
    markdown += `### Deployment Gas Costs\n\n`;
    markdown += `| Contract | Deployment Gas | Notes |\n`;
    markdown += `|----------|----------------|-------|\n`;
    if (identityData) {
      markdown += `| IdentityContract | ${identityData.gas} gas | Standard deployment |\n`;
    } else {
      markdown += `| IdentityContract | N/A | N/A |\n`;
    }
    if (zkIdentityData) {
      markdown += `| ZKIdentity | ${zkIdentityData.gas} gas | Includes Merkle tree setup |\n`;
    } else {
      markdown += `| ZKIdentity | N/A | N/A |\n`;
    }
    if (verifierData) {
      markdown += `| Verifier.sol | ${verifierData.gas} gas | Large verification keys |\n`;
    } else {
      markdown += `| Verifier.sol | N/A | N/A |\n`;
    }
    if (zkDataData) {
      markdown += `| ZKDataContract | ${zkDataData.gas} gas | Complex contract logic |\n\n`;
    } else {
      markdown += `| ZKDataContract | N/A | N/A |\n\n`;
    }
    
    markdown += `## 6. Off-Chain Proving Performance\n\n`;
    markdown += `### Proof Generation Times\n\n`;
    markdown += `| Circuit | Generation Time | Memory Usage | Verification Time |\n`;
    markdown += `|---------|-----------------|--------------|------------------|\n`;
    
    // Extract actual proof generation data
    const offchainResults = Array.isArray(this.benchmarkResults.offchain) ? this.benchmarkResults.offchain : [];
    const identityProof = offchainResults.find(r => r.operation === "proof generation" && r.circuit === "identity.circom");
    const rewardProof = offchainResults.find(r => r.operation === "proof generation" && r.circuit === "reward.circom");
    const hashData = offchainResults.find(r => r.operation === "hash computation");
    const treeData = offchainResults.find(r => r.operation === "tree construction");
    
    if (identityProof) {
      const avgTime = (identityProof.timeMs / identityProof.numProofs).toFixed(0);
      markdown += `| Identity | ${avgTime} ms (avg) | ${identityProof.memoryMB.toFixed(0)} MB | N/A |\n`;
    } else {
      markdown += `| Identity | N/A | N/A | N/A |\n`;
    }
    
    if (rewardProof) {
      const avgTime = (rewardProof.timeMs / rewardProof.numProofs).toFixed(0);
      markdown += `| Reward | ${avgTime} ms (avg) | ${rewardProof.memoryMB.toFixed(0)} MB | N/A |\n`;
    } else {
      markdown += `| Reward | N/A | N/A | N/A |\n`;
    }
    markdown += `\n`;
    
    markdown += `### Component Analysis\n\n`;
    markdown += `**Poseidon Hash Operations:**\n`;
    if (hashData) {
      markdown += `- Speed: ${hashData.avgTimePerHash} ms per hash (${hashData.iterations} iterations)\n`;
      markdown += `- Memory: ${hashData.memoryMB.toFixed(0)} MB\n`;
    } else {
      markdown += `- Speed: <1ms per hash\n`;
    }
    markdown += `- Usage: Commitment computation, tree operations\n\n`;
    
    markdown += `**Merkle Tree Operations:**\n`;
    if (treeData) {
      markdown += `- Construction: ${treeData.timeMs} ms (avg over ${treeData.iterations} iterations)\n`;
      markdown += `- Configuration: Depth ${treeData.depth}, ${treeData.leaves} leaves\n`;
      markdown += `- Memory: ${treeData.memoryMB.toFixed(0)} MB\n`;
    } else {
      markdown += `- Construction: Scales with depth and leaf count\n`;
      markdown += `- Path verification: N/A (requires actual measurement)\n`;
    }
    markdown += `\n`;
    
    markdown += `**Circuit Compilation:**\n`;
    const identityCompilation = offchainResults.find(r => r.operation === "circuit compilation" && r.circuit === "identity.circom");
    const rewardCompilation = offchainResults.find(r => r.operation === "circuit compilation" && r.circuit === "reward.circom");
    
    if (identityCompilation) {
      const timeSec = (identityCompilation.timeMs / 1000).toFixed(1);
      markdown += `- Identity circuit: ${timeSec}s (${identityCompilation.memoryMB.toFixed(0)} MB)\n`;
    } else {
      markdown += `- Identity circuit: N/A\n`;
    }
    
    if (rewardCompilation) {
      const timeSec = (rewardCompilation.timeMs / 1000).toFixed(1);
      markdown += `- Reward circuit: ${timeSec}s (${rewardCompilation.memoryMB.toFixed(0)} MB)\n`;
    } else {
      markdown += `- Reward circuit: N/A\n`;
    }
    markdown += `- One-time cost per circuit\n\n`;
    
    markdown += `### User Experience Impact\n\n`;
    markdown += `The off-chain proving requirements significantly impact user experience:\n`;
    markdown += `- **Immediate transactions:** Not possible (requires proof generation)\n`;
    markdown += `- **Mobile devices:** May struggle with memory requirements\n`;
    markdown += `- **Background processing:** Recommended for better UX\n`;
    markdown += `- **Batch operations:** Can amortize proving costs\n\n`;
    
    markdown += `## 7. Comprehensive Cost-Benefit Analysis\n\n`;
    markdown += `### Privacy vs Efficiency Trade-off Summary\n\n`;
    markdown += `| Phase | Standard Gas | ZK Gas | Overhead | Privacy Level |\n`;
    markdown += `|-------|-------------|--------|----------|---------------|\n`;
    markdown += `| Identity & Registration | N/A | N/A | N/A | High |\n`;
    markdown += `| CTI Submission & Consumption | N/A | N/A | N/A | Complete |\n`;
    markdown += `| Dispute & Regulation | N/A | N/A | N/A | Complete |\n`;
    markdown += `| Reward Claiming | N/A | N/A | N/A | Complete |\n`;
    markdown += `| **Complete Lifecycle** | **N/A** | **N/A** | **N/A** | **Complete** |\n\n`;
    
    markdown += `### Academic Paper Metrics\n\n`;
    markdown += `**For Publication:**\n\n`;
    markdown += `1. **Gas Overhead by Phase:**\n`;
    markdown += `   - Identity & Registration: N/A (requires actual measurement)\n`;
    markdown += `   - CTI Submission & Consumption: N/A (requires actual measurement)\n`;
    markdown += `   - Dispute & Regulation: N/A (requires actual measurement)\n`;
    markdown += `   - Reward Claiming: N/A (requires actual measurement)\n\n`;
    
    markdown += `2. **Privacy Guarantees:**\n`;
    markdown += `   - Identity: Anonymous registration via commitments\n`;
    markdown += `   - CTI Access: Anonymous request-response via ZK proofs\n`;
    markdown += `   - Dispute: Anonymous voting via nullifiers\n`;
    markdown += `   - Rewards: Anonymous claiming via fresh addresses\n\n`;
    
    markdown += `3. **Cost-Benefit Conclusion:**\n`;
    markdown += `   - Average gas overhead: N/A (requires actual measurement)\n`;
    markdown += `   - Privacy level: Complete anonymity\n`;
    markdown += `   - Acceptability: High for privacy-critical applications\n`;
    markdown += `   - User experience: Significant delay due to off-chain proving\n\n`;
    
    markdown += `## 8. Recommendations\n\n`;
    markdown += `### For Privacy-Critical Applications\n\n`;
    markdown += `✅ **Use ZK-Priv-Share when:**\n`;
    markdown += `- Participant anonymity is required\n`;
    markdown += `- Regulatory compliance demands privacy\n`;
    markdown += `- Long-term privacy guarantees are needed\n`;
    markdown += `- Budget allows for N/A (requires actual measurement)\n\n`;
    
    markdown += `### For Cost-Optimized Applications\n\n`;
    markdown += `✅ **Use Standard Priv-Share when:**\n`;
    markdown += `- Privacy requirements are minimal\n`;
    markdown += `- Cost optimization is priority\n`;
    markdown += `- Fast transaction finality is required\n`;
    markdown += `- Mobile user experience is critical\n\n`;
    
    markdown += `### For Hybrid Approaches\n\n`;
    markdown += `🔄 **Consider mixed deployment:**\n`;
    markdown += `- ZK for sensitive operations (disputes, rewards)\n`;
    markdown += `- Standard for high-frequency operations (CTI sharing)\n`;
    markdown += `- User-selectable privacy levels\n`;
    markdown += `- Tiered pricing based on privacy choices\n\n`;
    
    markdown += `### Technical Improvements\n\n`;
    markdown += `🔧 **Optimization Opportunities:**\n`;
    markdown += `- Circuit optimization to reduce proof size\n`;
    markdown += `- Batch proof verification for multiple operations\n`;
    markdown += `- Layer 2 deployment for reduced gas costs\n`;
    markdown += `- Alternative ZK systems (STARKs vs SNARKs)\n`;
    markdown += `- Hardware acceleration for proof generation\n\n`;
    
    markdown += `## 9. Conclusion\n\n`;
    markdown += `The ZK-Priv-Share framework provides complete privacy guarantees. This privacy premium is justified for applications where:\n\n`;
    markdown += `1. **Regulatory Compliance:** Privacy regulations require anonymity\n`;
    markdown += `2. **Competitive Advantage:** Privacy is a market differentiator\n`;
    markdown += `3. **User Safety:** Participants require protection from retaliation\n`;
    markdown += `4. **Long-term Privacy:** Historical transaction privacy is critical\n\n`;
    
    markdown += `The benchmark results demonstrate that zero-knowledge privacy is achievable in CTI sharing systems, but organizations must carefully weigh the privacy benefits against the significant efficiency costs. The modular design of the framework allows for hybrid approaches where privacy can be selectively applied to the most sensitive operations.\n\n`;
    
    markdown += `---\n\n`;
    markdown += `**Report Generated by:** Priv-Share Benchmarking Suite\n`;
    markdown += `**Framework:** Hardhat v2 + hardhat-gas-reporter\n`;
    markdown += `**Circuits:** circom + snarkjs\n`;
    markdown += `**Date:** ${reportDate}\n`;
    
    return markdown;
  }

  generateCSVReport() {
    let csv = "Phase,Operation,Standard Gas,ZK Gas,Overhead Gas,Overhead %,Privacy Level\n";

    // Identity & Registration
    const registerOrgGas = this.benchmarkResults.identity.registerOrganisation;
    const registerIdGas = this.benchmarkResults.identity.registerIdentity;

    if (registerOrgGas && registerIdGas) {
      const overhead = parseInt(registerIdGas) - parseInt(registerOrgGas);
      const percent = ((overhead / parseInt(registerOrgGas)) * 100).toFixed(2);
      csv += `Identity & Registration,registerOrganisation,${registerOrgGas},N/A,N/A,N/A,None\n`;
      csv += `Identity & Registration,registerIdentity,N/A,${registerIdGas},${overhead},${percent},High\n`;
    } else {
      csv += "Identity & Registration,registerOrganisation,N/A,N/A,N/A,N/A,None\n";
      csv += "Identity & Registration,registerIdentity,N/A,N/A,N/A,N/A,High\n";
    }

    // CTI Submission & Consumption
    const shareCti = this.benchmarkResults.cti.shareCti;
    const provideResponse = this.benchmarkResults.cti.provideResponse;
    const requestAccess = this.benchmarkResults.cti.requestAccess;
    const provideResponseZK = this.benchmarkResults.cti.provideResponseZK;

    csv += `CTI Submission,shareCti,${shareCti || "N/A"},${shareCti || "N/A"},0,0,None\n`;
    csv += `CTI Consumption,provideResponse,${provideResponse || "N/A"},N/A,N/A,N/A,None\n`;
    csv += `CTI Consumption,requestAccess,N/A,${requestAccess || "N/A"},N/A,N/A,Complete\n`;
    csv += `CTI Consumption,provideResponseZK,N/A,${provideResponseZK || "N/A"},N/A,N/A,Complete\n`;

    if (provideResponse && requestAccess && provideResponseZK) {
      const standardCycle = parseInt(provideResponse) + parseInt(requestAccess);
      const zkCycle = parseInt(provideResponseZK);
      const overhead = zkCycle - standardCycle;
      const percent = ((overhead / standardCycle) * 100).toFixed(2);
      csv += `CTI Complete Cycle,All,${standardCycle},${zkCycle},${overhead},${percent},Complete\n`;
    } else {
      csv += "CTI Complete Cycle,All,N/A,N/A,N/A,N/A,Complete\n";
    }

    // Dispute & Regulation
    const raiseDispute = this.benchmarkResults.dispute.raiseDispute;
    const voteOnDispute = this.benchmarkResults.dispute.voteOnDispute;
    const raiseDisputeZK = this.benchmarkResults.dispute.raiseDisputeZK;
    const voteOnDisputeZK = this.benchmarkResults.dispute.voteOnDisputeZK;

    if (raiseDispute && raiseDisputeZK) {
      const overhead = parseInt(raiseDisputeZK) - parseInt(raiseDispute);
      const percent = ((overhead / parseInt(raiseDispute)) * 100).toFixed(2);
      csv += `Dispute,raiseDispute,${raiseDispute},${raiseDisputeZK},${overhead},${percent},Complete\n`;
    } else {
      csv += `Dispute,raiseDispute,${raiseDispute || "N/A"},${raiseDisputeZK || "N/A"},N/A,N/A,Complete\n`;
    }

    if (voteOnDispute && voteOnDisputeZK) {
      const overhead = parseInt(voteOnDisputeZK) - parseInt(voteOnDispute);
      const percent = ((overhead / parseInt(voteOnDispute)) * 100).toFixed(2);
      csv += `Dispute,voteOnDispute,${voteOnDispute},${voteOnDisputeZK},${overhead},${percent},Complete\n`;
    } else {
      csv += `Dispute,voteOnDispute,${voteOnDispute || "N/A"},${voteOnDisputeZK || "N/A"},N/A,N/A,Complete\n`;
    }

    // Reward Claiming
    const depositReward = this.benchmarkResults.reward.depositReward;
    const claimReward = this.benchmarkResults.reward.claimReward;
    const rewardTotal = (depositReward && claimReward) ? (parseInt(depositReward) + parseInt(claimReward)) : "N/A";

    csv += "Reward,Direct Payment,N/A,N/A,N/A,N/A,None\n";
    csv += `Reward,depositReward (minting),N/A,${depositReward || "N/A"},N/A,N/A,Complete\n`;
    csv += `Reward,claimReward,N/A,${claimReward || "N/A"},N/A,N/A,Complete\n`;
    csv += `Reward Complete,All,N/A,${rewardTotal},N/A,N/A,Complete\n`;

    // Proof Verification
    const proofResults = Array.isArray(this.benchmarkResults.proofVerification.results) ? this.benchmarkResults.proofVerification.results : [];
    const identityProofResult = proofResults.find(r => r.circuit === "identity");
    const rewardProofResult = proofResults.find(r => r.circuit === "reward");

    if (identityProofResult) {
      csv += `Proof Verification,Identity verifyProof,N/A,${identityProofResult.executionGas},N/A,N/A,Complete\n`;
    } else {
      csv += "Proof Verification,Identity verifyProof,N/A,N/A,N/A,N/A,Complete\n";
    }

    if (rewardProofResult) {
      csv += `Proof Verification,Reward verifyProof,N/A,${rewardProofResult.executionGas},N/A,N/A,Complete\n`;
    } else {
      csv += "Proof Verification,Reward verifyProof,N/A,N/A,N/A,N/A,Complete\n";
    }

    csv += "Complete Lifecycle,All Phases,N/A,N/A,N/A,N/A,Complete\n";

    return csv;
  }

  async generateReports() {
    console.log(`\n=== Generating Comprehensive Benchmark Reports ===`);
    
    // Collect existing results
    await this.collectAllResults();
    
    // Generate markdown report
    const markdown = this.generateMarkdownReport();
    const markdownPath = path.join(this.reportsDir, "GasComparisonReport.md");
    fs.writeFileSync(markdownPath, markdown);
    console.log(`Markdown report saved to: ${markdownPath}`);
    
    // Generate CSV report
    const csv = this.generateCSVReport();
    const csvPath = path.join(this.reportsDir, "GasComparisonReport.csv");
    fs.writeFileSync(csvPath, csv);
    console.log(`CSV report saved to: ${csvPath}`);
    
    console.log(`\n=== Report Generation Complete ===`);
    console.log(`Reports available in: ${this.reportsDir}`);
  }
}

// Run report generation if executed directly
if (require.main === module) {
  const generator = new ReportGenerator();
  generator.generateReports().catch(console.error);
}

module.exports = ReportGenerator;

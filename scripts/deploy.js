// scripts/deploy.js (CommonJS)

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");
const hre = require("hardhat");
const { execSync } = require("child_process");
const { syncConfig } = require("./syncConfig");
const {
    ROOT,
    CONFIG_PATH,
    INITIAL_MANAGERS_PATH,
    DEPLOYMENTS_DIR,
    DEPLOYMENTS_NETWORK,
    deploymentRecordPath,
} = require("./paths");

function loadJson(filePath, label) {
    if (!fs.existsSync(filePath)) {
        throw new Error(`${label} not found at ${filePath}`);
    }

    try {
        return JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch (error) {
        throw new Error(`Failed to parse ${label} at ${filePath}: ${error.message}`);
    }
}

function loadDeploymentConfig() {
    const config = loadJson(CONFIG_PATH, "config/config.json");

    if (config.threshold === undefined || config.threshold === null) {
        throw new Error('config/config.json must include a "threshold" field');
    }

    const threshold = Number(config.threshold);
    if (!Number.isInteger(threshold) || threshold <= 0) {
        throw new Error('config/config.json "threshold" must be a positive integer');
    }

    if (!config.identityContract) {
        throw new Error('config/config.json must include an "identityContract" address');
    }

    return {
        threshold,
        identityContract: config.identityContract,
    };
}

function loadInitialManagers() {
    const data = loadJson(INITIAL_MANAGERS_PATH, "config/InitialManagers.json");
    const managers = Array.isArray(data) ? data : data.managers;

    if (!Array.isArray(managers) || managers.length === 0) {
        throw new Error(
            "config/InitialManagers.json must be a non-empty array of addresses, " +
            'or an object with a non-empty "managers" array'
        );
    }

    for (const manager of managers) {
        if (!ethers.isAddress(manager)) {
            throw new Error(`Invalid manager address in config/InitialManagers.json: ${manager}`);
        }
    }

    return managers;
}

function loadDeployedAddress(contractName) {
    const addressPath = deploymentRecordPath(contractName);
    if (!fs.existsSync(addressPath)) {
        throw new Error(`Deployed address file not found: ${addressPath}`);
    }

    const data = loadJson(addressPath, path.basename(addressPath));
    if (!data.address || !ethers.isAddress(data.address)) {
        throw new Error(`Invalid address in ${path.basename(addressPath)}`);
    }

    return data.address;
}

// Parse command-line arguments
function parseArgs() {
    const args = process.argv.slice(2);
    let contractFile = null;

    for (let i = 0; i < args.length; i++) {
        if (args[i] === "-c" && i + 1 < args.length) {
            contractFile = args[i + 1];
            i++; // Skip the next argument as it's the value
        }
    }

    if (!contractFile) {
        console.error("Usage: node scripts/deploy.js -c CONTRACT.sol");
        console.error("Example: node scripts/deploy.js -c ZKIdentity.sol");
        process.exit(1);
    }

    return contractFile;
}

// Extract contract name from Solidity file
function extractContractName(source, fileName) {
    const withoutComments = source
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "");

    const contractMatches = [...withoutComments.matchAll(/\bcontract\s+(\w+)/g)];
    const libraryMatches = [...withoutComments.matchAll(/\blibrary\s+(\w+)/g)];
    
    const allMatches = [...contractMatches, ...libraryMatches];
    
    if (allMatches.length === 0) {
        throw new Error(`No contract or library found in ${fileName}`);
    }

    const allNames = allMatches.map((match) => match[1]);
    const mainContract = allNames.find(name =>
        !name.includes("Interface") &&
        !name.includes("Verifier")
    ) || allNames[0];

    return mainContract;
}

async function main() {
    // ----------------------------
    // Parse command-line arguments
    // ----------------------------
    const contractFile = parseArgs();
    const contractPath = path.join(ROOT, "contracts", contractFile);

    if (!fs.existsSync(contractPath)) {
        console.error(`Error: Contract file not found: ${contractPath}`);
        process.exit(1);
    }

    console.log(`📄 Loading contract: ${contractFile}`);

    // ----------------------------
    // Load & compile contract using Hardhat
    // ----------------------------
    const source = fs.readFileSync(contractPath, "utf8");
    const contractName = extractContractName(source, contractFile);

    console.log(`📦 Compiling contract: ${contractName}`);

    // Use Hardhat's built-in compilation
    await hre.run('compile');

    // Get the compiled contract from artifacts
    const artifactsDir = 'artifacts';
    const artifactPath = path.join(ROOT, artifactsDir, 'contracts', contractFile.replace('.sol', '.sol'), `${contractName}.json`);
    
    if (!fs.existsSync(artifactPath)) {
        console.error(`Error: Contract artifact not found at ${artifactPath}`);
        process.exit(1);
    }

    const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
    const abi = artifact.abi;
    const bytecode = artifact.bytecode;

    console.log("✔ Compilation successful");

    // ----------------------------
    // Connect to local Hardhat node
    // ----------------------------
    const [deployer] = await hre.ethers.getSigners();
    const deployerAddress = await deployer.getAddress();

    console.log("🔗 Connected to Hardhat network");
    console.log("👤 Deploying from:", deployerAddress);

    // Check balance
    const balance = await hre.ethers.provider.getBalance(deployerAddress);
    console.log("💰 Balance:", ethers.formatEther(balance), "ETH");

    if (balance === 0n) {
        console.warn("⚠️  Warning: Account has zero balance. Make sure Hardhat node is running and funded.");
    }

    // ----------------------------
    // Deploy contract using Hardhat
    // ----------------------------
    let factory;
    
    // Check if bytecode contains library placeholders
    const hasLibraryPlaceholders = bytecode.includes('$__');
    
    if (hasLibraryPlaceholders) {
        console.log("🔗 Contract requires library linking");
        let poseidonAddress, ibtAddress;

        // Check if PoseidonT3 is already deployed and valid
        try {
            poseidonAddress = loadDeployedAddress("PoseidonT3");
            const code = await hre.ethers.provider.getCode(poseidonAddress);
            if (code === "0x") {
                console.log(`⚠️  PoseidonT3 at ${poseidonAddress} has no code, redeploying...`);
                throw new Error("Invalid library address");
            }
            console.log(`♻️  Reusing existing PoseidonT3 at: ${poseidonAddress}`);
        } catch (e) {
            // Deploy PoseidonT3 first using Hardhat
            console.log("📦 Deploying PoseidonT3 library...");
            const PoseidonT3Factory = await hre.ethers.getContractFactory("poseidon-solidity/PoseidonT3.sol:PoseidonT3");
            const poseidonT3 = await PoseidonT3Factory.deploy();
            await poseidonT3.waitForDeployment();
            poseidonAddress = await poseidonT3.getAddress();
            
            // Save PoseidonT3 address
            const poseidonData = {
                contractName: "PoseidonT3",
                contractFile: "PoseidonT3.sol",
                address: poseidonAddress,
                deployedAt: new Date().toISOString(),
                network: DEPLOYMENTS_NETWORK
            };
            const poseidonFilePath = deploymentRecordPath("PoseidonT3");
            fs.mkdirSync(DEPLOYMENTS_DIR, { recursive: true });
            fs.writeFileSync(poseidonFilePath, JSON.stringify(poseidonData, null, 2));
            console.log(`✔ PoseidonT3 deployed at: ${poseidonAddress}`);
        }

        // Check if IncrementalBinaryTree is already deployed and valid
        try {
            ibtAddress = loadDeployedAddress("IncrementalBinaryTree");
            const code = await hre.ethers.provider.getCode(ibtAddress);
            if (code === "0x") {
                console.log(`⚠️  IncrementalBinaryTree at ${ibtAddress} has no code, redeploying...`);
                throw new Error("Invalid library address");
            }
            console.log(`♻️  Reusing existing IncrementalBinaryTree at: ${ibtAddress}`);
        } catch (e) {
            // Deploy IncrementalBinaryTree with PoseidonT3 linked using Hardhat
            console.log("📦 Deploying IncrementalBinaryTree library...");
            const IncrementalBinaryTreeFactory = await hre.ethers.getContractFactory("@zk-kit/incremental-merkle-tree.sol/IncrementalBinaryTree.sol:IncrementalBinaryTree", {
                libraries: {
                    PoseidonT3: poseidonAddress
                }
            });
            const incrementalBinaryTree = await IncrementalBinaryTreeFactory.deploy();
            await incrementalBinaryTree.waitForDeployment();
            ibtAddress = await incrementalBinaryTree.getAddress();
            
            // Save IncrementalBinaryTree address
            const ibtData = {
                contractName: "IncrementalBinaryTree",
                contractFile: "IncrementalBinaryTree.sol",
                address: ibtAddress,
                deployedAt: new Date().toISOString(),
                network: DEPLOYMENTS_NETWORK
            };
            const ibtFilePath = deploymentRecordPath("IncrementalBinaryTree");
            fs.mkdirSync(DEPLOYMENTS_DIR, { recursive: true });
            fs.writeFileSync(ibtFilePath, JSON.stringify(ibtData, null, 2));
            console.log(`✔ IncrementalBinaryTree deployed at: ${ibtAddress}`);
        }

        // Deploy contract with IncrementalBinaryTree linked using Hardhat
        factory = await hre.ethers.getContractFactory(contractName, {
            libraries: {
                IncrementalBinaryTree: ibtAddress
            }
        });
    } else {
        // Use fully qualified name for contracts with duplicate names
        if (contractName === "Groth16Verifier") {
            factory = await hre.ethers.getContractFactory("contracts/RewardVerifier.sol:Groth16Verifier");
        } else if (contractName === "PoseidonT3") {
            factory = await hre.ethers.getContractFactory("contracts/crypto/PoseidonT3.sol:PoseidonT3");
        } else {
            factory = await hre.ethers.getContractFactory(contractName);
        }
    }

    // Determine constructor arguments
    let constructorArgs = [];
    
    // Check if contract needs constructor arguments
    const constructorAbi = abi.find(item => item.type === "constructor");
    if (constructorAbi && constructorAbi.inputs && constructorAbi.inputs.length > 0) {
        console.log(`📋 Constructor requires ${constructorAbi.inputs.length} argument(s)`);
        
        if (contractName === "ZKDataContract") {
            const zkIdentityAddress = loadDeployedAddress("ZKIdentity");
            const rewardVerifierAddress = loadDeployedAddress("Groth16Verifier");
            const { identityContract, threshold } = loadDeploymentConfig();
            const initialManagers = loadInitialManagers();

            if (threshold > initialManagers.length) {
                throw new Error(
                    `Invalid threshold ${threshold}: must be <= number of initial managers (${initialManagers.length})`
                );
            }

            constructorArgs = [
                zkIdentityAddress,
                identityContract,
                rewardVerifierAddress,
                initialManagers,
                threshold,
            ];

            console.log(`🔗 Using ZKIdentity address: ${zkIdentityAddress}`);
            console.log(`🔗 Using RewardVerifier address: ${rewardVerifierAddress}`);
            console.log(`🔗 Using Identity contract address: ${identityContract}`);
            console.log(`👥 Initial managers (${initialManagers.length}):`, initialManagers.join(", "));
            console.log(`🗳️  Voting threshold: ${threshold}`);
        } else if (contractName === "DataContract") {
            const { identityContract, threshold } = loadDeploymentConfig();
            const initialManagers = loadInitialManagers();

            if (threshold > initialManagers.length) {
                throw new Error(
                    `Invalid threshold ${threshold}: must be <= number of initial managers (${initialManagers.length})`
                );
            }

            constructorArgs = [identityContract, initialManagers, threshold];

            console.log(`🔗 Using Identity contract address: ${identityContract}`);
            console.log(`👥 Initial managers (${initialManagers.length}):`, initialManagers.join(", "));
            console.log(`🗳️  Voting threshold: ${threshold}`);
        } else {
            // For other contracts, you can add more logic here
            throw new Error(`Contract ${contractName} requires constructor arguments but no handler is defined.`);
        }
    }

    console.log(`⏳ Deploying ${contractName}...`);
    const contract = await factory.deploy(...constructorArgs);

    console.log("⏳ Waiting for deployment confirmation...");
    await contract.waitForDeployment();

    const contractAddress = await contract.getAddress();
    console.log(`🎉 ${contractName} deployed at: ${contractAddress}`);

    // ----------------------------
    // Save contract address to file
    // ----------------------------
    const addressData = {
        contractName: contractName,
        contractFile: contractFile,
        address: contractAddress,
        deployedAt: new Date().toISOString(),
        network: DEPLOYMENTS_NETWORK
    };

    const addressFilePath = deploymentRecordPath(contractName);
    fs.mkdirSync(DEPLOYMENTS_DIR, { recursive: true });
    fs.writeFileSync(addressFilePath, JSON.stringify(addressData, null, 2));
    console.log("💾 Contract address saved to:", addressFilePath);

    if (contractName === "IdentityContract") {
        const { config } = syncConfig();
        console.log(`📝 Updated config/config.json identityContract: ${config.identityContract}`);
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});


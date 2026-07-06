// scripts/deploy.js (CommonJS)

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const solc = require("solc");
const { ethers } = require("ethers");
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
    if (contractMatches.length === 0) {
        throw new Error(`No contract found in ${fileName}`);
    }

    const allContracts = contractMatches.map((match) => match[1]);
    const mainContract = allContracts.find(name =>
        !name.includes("Interface") &&
        !name.includes("Library") &&
        !name.includes("Verifier")
    ) || allContracts[0];

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
    // Load & compile contract
    // ----------------------------
    const source = fs.readFileSync(contractPath, "utf8");
    const contractName = extractContractName(source, contractFile);

    console.log(`📦 Compiling contract: ${contractName}`);

    // Read all contract files for imports
    const contractsDir = path.join(ROOT, "contracts");
    
    // Build sources object with all required files
    // Use both the import path and normalized path as keys to handle solc's path resolution
    const sources = {};

    // Recursively collect all imports
    function collectImports(filePath, sourceKey, collected = new Set()) {
        if (collected.has(sourceKey)) return;
        collected.add(sourceKey);
        
        const fileContent = fs.readFileSync(filePath, "utf8");
        sources[sourceKey] = { content: fileContent };
        
        // Also add normalized version (without ./) as solc might normalize paths
        const normalizedKey = sourceKey.replace(/^\.\//, "");
        if (normalizedKey !== sourceKey) {
            sources[normalizedKey] = { content: fileContent };
        }
        
        const importRegex = /import\s+["']([^"']+)["']/g;
        let match;
        
        while ((match = importRegex.exec(fileContent)) !== null) {
            const importPath = match[1];
            let resolvedPath;
            let importSourceKey;
            
            // Handle relative imports
            if (importPath.startsWith("./")) {
                const baseDir = path.dirname(filePath);
                resolvedPath = path.resolve(baseDir, importPath.replace("./", ""));
                // Keep the import path as the source key (as it appears in the import statement)
                importSourceKey = importPath;
            } else {
                resolvedPath = path.join(contractsDir, importPath);
                importSourceKey = importPath;
            }
            
            if (fs.existsSync(resolvedPath) && !collected.has(importSourceKey)) {
                collectImports(resolvedPath, importSourceKey, collected);
            }
        }
    }

    // Start collecting from the main contract
    // Use the contract file name as the source key
    collectImports(contractPath, contractFile);

    const input = {
        language: "Solidity",
        sources: sources,
        settings: {
            outputSelection: {
                "*": {
                    "*": ["abi", "evm.bytecode"],
                },
            },
            optimizer: {
                enabled: true,
                runs: 200
            },
            viaIR: true
        },
    };

    // Use compileStandardWrapper for better import handling
    const compileStandardWrapper = solc.compileStandardWrapper || solc.compile;
    const output = JSON.parse(compileStandardWrapper(JSON.stringify(input)));

    if (output.errors) {
        const errors = output.errors.filter(e => e.severity === "error");
        if (errors.length > 0) {
            for (const error of errors) {
                console.error(error.formattedMessage);
            }
            throw new Error("Compilation failed");
        }
        // Show warnings but don't fail
        const warnings = output.errors.filter(e => e.severity === "warning");
        for (const warning of warnings) {
            console.warn(warning.formattedMessage);
        }
    }

    const compiled = output.contracts[contractFile][contractName];

    if (!compiled) {
        console.error(`Error: Contract ${contractName} not found in compiled output`);
        console.error("Available contracts:", Object.keys(output.contracts[contractFile] || {}));
        process.exit(1);
    }

    const abi = compiled.abi;
    const bytecode = compiled.evm.bytecode.object;

    console.log("✔ Compilation successful");

    // ----------------------------
    // Connect to local Hardhat node
    // ----------------------------
    const provider = new ethers.JsonRpcProvider("http://127.0.0.1:8545");

    // Check if private key is set
    if (!process.env.PRIVATE_KEY) {
        throw new Error("PRIVATE_KEY not found in .env file");
    }

    const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
    const deployer = await wallet.getAddress();

    console.log("🔗 Connected to: http://127.0.0.1:8545");
    console.log("👤 Deploying from:", deployer);

    // Check balance
    const balance = await provider.getBalance(deployer);
    console.log("💰 Balance:", ethers.formatEther(balance), "ETH");

    if (balance === 0n) {
        console.warn("⚠️  Warning: Account has zero balance. Make sure Hardhat node is running and funded.");
    }

    // ----------------------------
    // Deploy contract
    // ----------------------------
    const factory = new ethers.ContractFactory(abi, bytecode, wallet);

    // Determine constructor arguments
    let constructorArgs = [];
    
    // Check if contract needs constructor arguments
    const constructorAbi = abi.find(item => item.type === "constructor");
    if (constructorAbi && constructorAbi.inputs && constructorAbi.inputs.length > 0) {
        console.log(`📋 Constructor requires ${constructorAbi.inputs.length} argument(s)`);
        
        if (contractName === "ZKDataContract") {
            const zkIdentityAddress = loadDeployedAddress("ZKIdentity");
            const rewardVerifierAddress = loadDeployedAddress("RewardVerifier");
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


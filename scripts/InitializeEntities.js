#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");
const {
    CONFIG_DIR,
    CONFIG_PATH,
    INITIAL_MANAGERS_PATH,
    INITIAL_DELEGATES_PATH,
} = require("./paths");

const HARDHAT_MNEMONIC = "test test test test test test test test test test test junk";
const HARDHAT_ACCOUNT_COUNT = 20;
const MAX_MANAGERS = 8;
const MAX_DELEGATES = 8;

function showHelp() {
    console.log(`Usage: node scripts/InitializeManagers.js -n MANAGERS -d DELEGATES -t THRESHOLD

Populate local dev manager and delegate accounts from the default Hardhat mnemonic.

Options:
  -n MANAGERS     Number of initial manager accounts to use (max 8)
  -d DELEGATES    Number of delegate accounts to use (max 8)
  -t THRESHOLD    Voting threshold written to config/config.json
  -h              Show this help message

Account layout:
  - Account #0 is reserved for the deployer
  - Accounts #1..#n are group managers (written to config/InitialManagers.json)
  - Accounts #(n+1)..#(n+d) are delegates (written to config/InitialDelegates.json)

Example:
  node scripts/InitializeManagers.js -n 5 -d 3 -t 3
`);
}

function parseArgs(argv) {
    let managerCount = null;
    let delegateCount = null;
    let threshold = null;

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];

        if (arg === "-h" || arg === "--help") {
            showHelp();
            process.exit(0);
        }

        if (arg === "-n" && i + 1 < argv.length) {
            managerCount = Number(argv[++i]);
            continue;
        }

        if (arg === "-d" && i + 1 < argv.length) {
            delegateCount = Number(argv[++i]);
            continue;
        }

        if (arg === "-t" && i + 1 < argv.length) {
            threshold = Number(argv[++i]);
            continue;
        }

        console.error(`Unknown or incomplete option: ${arg}`);
        showHelp();
        process.exit(1);
    }

    if (managerCount === null || delegateCount === null || threshold === null) {
        console.error("Error: -n, -d, and -t are all required.");
        showHelp();
        process.exit(1);
    }

    if (!Number.isInteger(managerCount) || managerCount <= 0) {
        throw new Error('"-n" must be a positive integer');
    }

    if (!Number.isInteger(delegateCount) || delegateCount < 0) {
        throw new Error('"-d" must be a non-negative integer');
    }

    if (!Number.isInteger(threshold) || threshold <= 0) {
        throw new Error('"-t" must be a positive integer');
    }

    if (threshold > managerCount) {
        throw new Error(`Threshold (${threshold}) cannot exceed manager count (${managerCount})`);
    }

    if (managerCount > MAX_MANAGERS) {
        throw new Error(`Requested ${managerCount} managers, but maximum is ${MAX_MANAGERS}`);
    }

    if (delegateCount > MAX_DELEGATES) {
        throw new Error(`Requested ${delegateCount} delegates, but maximum is ${MAX_DELEGATES}`);
    }

    const totalAccounts = 1 + managerCount + delegateCount;
    if (totalAccounts > HARDHAT_ACCOUNT_COUNT) {
        throw new Error(
            `Requested ${managerCount} managers + ${delegateCount} delegates exceeds available accounts (${HARDHAT_ACCOUNT_COUNT})`
        );
    }

    return { managerCount, delegateCount, threshold };
}

function deriveHardhatAccount(index) {
    return ethers.HDNodeWallet.fromPhrase(
        HARDHAT_MNEMONIC,
        undefined,
        `m/44'/60'/0'/0/${index}`
    );
}

function loadConfig() {
    if (!fs.existsSync(CONFIG_PATH)) {
        return { threshold: 2 };
    }

    return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
}

function writeInitialManagers(managerAddresses) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(
        INITIAL_MANAGERS_PATH,
        `${JSON.stringify(managerAddresses, null, 2)}\n`
    );
}

function writeInitialDelegates(delegateAddresses) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(
        INITIAL_DELEGATES_PATH,
        `${JSON.stringify(delegateAddresses, null, 2)}\n`
    );
}

function writeThreshold(threshold) {
    const config = loadConfig();
    config.threshold = threshold;
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`);
}

function main() {
    const { managerCount, delegateCount, threshold } = parseArgs(process.argv.slice(2));

    const deployer = deriveHardhatAccount(0);
    const managers = [];
    const delegates = [];

    for (let index = 1; index <= managerCount; index++) {
        managers.push(deriveHardhatAccount(index).address);
    }

    for (let index = managerCount + 1; index <= managerCount + delegateCount; index++) {
        delegates.push(deriveHardhatAccount(index).address);
    }

    writeInitialManagers(managers);
    writeInitialDelegates(delegates);
    writeThreshold(threshold);

    console.log("Initialized local manager and delegate configuration");
    console.log(`  Deployer (account #0): ${deployer.address}`);
    console.log(`  Managers requested: ${managerCount}`);
    console.log(`  Delegates requested: ${delegateCount}`);
    console.log(`  Threshold: ${threshold}`);
    console.log(`  Wrote: ${INITIAL_MANAGERS_PATH}`);
    console.log(`  Wrote: ${INITIAL_DELEGATES_PATH}`);
    console.log(`  Updated: ${CONFIG_PATH}`);
    console.log("");
    console.log("Manager accounts:");
    managers.forEach((address, index) => {
        console.log(`  #${index + 1}: ${address}`);
    });
    if (delegateCount > 0) {
        console.log("");
        console.log("Delegate accounts:");
        delegates.forEach((address, index) => {
            console.log(`  #${managerCount + index + 1}: ${address}`);
        });
    }
}

try {
    main();
} catch (error) {
    console.error(error.message);
    process.exit(1);
}

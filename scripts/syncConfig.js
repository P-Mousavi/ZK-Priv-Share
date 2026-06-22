const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");
const {
    CONFIG_PATH,
    DEPLOYMENTS_DIR,
    deploymentRecordPath,
} = require("./paths");

function loadJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function findLatestIdentityDeployment() {
    if (!fs.existsSync(DEPLOYMENTS_DIR)) {
        throw new Error(`Deployments directory not found: ${DEPLOYMENTS_DIR}`);
    }

    const deployments = fs
        .readdirSync(DEPLOYMENTS_DIR)
        .filter((fileName) => fileName.endsWith(".json"))
        .map((fileName) => {
            const filePath = path.join(DEPLOYMENTS_DIR, fileName);
            const data = loadJson(filePath);

            if (!data.contractName || !data.address || !data.deployedAt) {
                return null;
            }

            if (data.contractName !== "IdentityContract") {
                return null;
            }

            if (!ethers.isAddress(data.address)) {
                throw new Error(`Invalid address in ${fileName}`);
            }

            return { ...data, fileName };
        })
        .filter(Boolean);

    if (deployments.length === 0) {
        throw new Error(
            "No IdentityContract deployment found. Deploy contracts/Identity.sol first."
        );
    }

    deployments.sort(
        (left, right) => new Date(right.deployedAt) - new Date(left.deployedAt)
    );

    return deployments[0];
}

function syncConfig() {
    const latest = findLatestIdentityDeployment();
    const config = fs.existsSync(CONFIG_PATH)
        ? loadJson(CONFIG_PATH)
        : { threshold: 2 };

    if (config.threshold === undefined || config.threshold === null) {
        config.threshold = 2;
    }

    config.identityContract = latest.address;

    fs.writeFileSync(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`);

    return {
        config,
        latest,
    };
}

function main() {
    const { config, latest } = syncConfig();

    console.log("Updated config/config.json");
    console.log(`  identityContract: ${config.identityContract}`);
    console.log(`  threshold: ${config.threshold}`);
    console.log(`  source: deployments/localhost/${latest.fileName} (${latest.deployedAt})`);
}

if (require.main === module) {
    try {
        main();
    } catch (error) {
        console.error(error.message);
        process.exit(1);
    }
}

module.exports = {
    findLatestIdentityDeployment,
    syncConfig,
};

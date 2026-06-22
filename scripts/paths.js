const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const CONFIG_DIR = path.join(ROOT, "config");
const CONFIG_PATH = path.join(CONFIG_DIR, "config.json");
const INITIAL_MANAGERS_PATH = path.join(CONFIG_DIR, "InitialManagers.json");
const INITIAL_DELEGATES_PATH = path.join(CONFIG_DIR, "InitialDelegates.json");
const DEPLOYMENTS_NETWORK = "localhost";
const DEPLOYMENTS_DIR = path.join(ROOT, "deployments", DEPLOYMENTS_NETWORK);

function deploymentRecordPath(contractName) {
    return path.join(DEPLOYMENTS_DIR, `${contractName}.json`);
}

module.exports = {
    ROOT,
    CONFIG_DIR,
    CONFIG_PATH,
    INITIAL_MANAGERS_PATH,
    INITIAL_DELEGATES_PATH,
    DEPLOYMENTS_NETWORK,
    DEPLOYMENTS_DIR,
    deploymentRecordPath,
};

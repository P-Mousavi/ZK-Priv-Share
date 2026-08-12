const { expect } = require("chai");
const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

/*
 * This benchmark models what a passive chain observer can correlate from
 * transaction senders, event logs, event order, and public denominations. It
 * deliberately does not inspect secrets, private keys, or off-chain metadata.
 */
describe("CTI action -> reward extraction linkability benchmark", function () {
  const DEPOSIT = ethers.parseEther("1");
  const NOTE = ethers.parseEther("0.01");
  const REWARD = ethers.parseEther("0.1");
  const ZERO_PROOF_A = [0, 0];
  const ZERO_PROOF_B = [[0, 0], [0, 0]];
  const ZERO_PROOF_C = [0, 0];
  let signers, owner, producer, consumer, delegate, actionRelayer, claimRelayer, recipient;
  let identity, zkIdentity, data, results;

  function address(value) {
    return value.toLowerCase();
  }

  function events(receipt, name) {
    return receipt.logs.flatMap((log) => {
      try {
        const parsed = data.interface.parseLog(log);
        return parsed && parsed.name === name ? [parsed] : [];
      } catch (_) {
        return [];
      }
    });
  }

  async function deployFixture() {
    signers = await ethers.getSigners();
    [owner, producer, consumer, delegate, actionRelayer, claimRelayer, recipient] = signers;

    const Poseidon = await ethers.getContractFactory("poseidon-solidity/PoseidonT3.sol:PoseidonT3");
    const poseidon = await Poseidon.deploy();
    const Tree = await ethers.getContractFactory("@zk-kit/incremental-merkle-tree.sol/IncrementalBinaryTree.sol:IncrementalBinaryTree", {
      libraries: { PoseidonT3: await poseidon.getAddress() }
    });
    const incrementalTree = await Tree.deploy();
    const Identity = await ethers.getContractFactory("IdentityContract", {
      libraries: { IncrementalBinaryTree: await incrementalTree.getAddress() }
    });
    identity = await Identity.deploy();
    const ZKIdentity = await ethers.getContractFactory("ZKIdentity", {
      libraries: { IncrementalBinaryTree: await incrementalTree.getAddress() }
    });
    zkIdentity = await ZKIdentity.deploy();
    const Verifier = await ethers.getContractFactory("AcceptAllRewardVerifier");
    const verifier = await Verifier.deploy();
    const Data = await ethers.getContractFactory("ZKDataContract");
    data = await Data.deploy(
      await zkIdentity.getAddress(), await identity.getAddress(), await verifier.getAddress(),
      [signers[10].address, signers[11].address], 2
    );
    await identity.setDataContract(await data.getAddress());
    await data.setTestingMode(true);

    const cid = "QmLinkabilityBenchmark";
    for (const account of [producer, consumer, delegate]) {
      await identity.connect(account).registerOrganisation(cid, { value: DEPOSIT });
    }
    // A real identity-tree leaf is still required by requestAccess(); proof
    // verification is bypassed only for the local action benchmark.
    await zkIdentity.connect(delegate).registerIdentity(123456789n, { value: DEPOSIT });
    // Production minting records notes but does not itself escrow the value.
    // Give the local benchmark contract a deterministic claim budget without
    // adding an observable transaction to the timeline under analysis.
    await ethers.provider.send("hardhat_setBalance", [await data.getAddress(), ethers.toBeHex(ethers.parseEther("100"))]);
    await data.setRewardTreeRoot(999n);
  }

  async function shareCti(reward = REWARD) {
    await data.connect(producer).shareCti("policy", "hashes", reward, 0, [delegate.address], [1]);
    return await data.ctiCounter();
  }

  async function zkResponseWithNotes(denominations, firstCommitment) {
    const ctiId = await shareCti(denominations.reduce((total, denomination) => total + denomination, 0n));
    const requestReceipt = await (await data.connect(consumer).requestAccess(ctiId)).wait();
    const request = events(requestReceipt, "ZKRequestCreated")[0];
    // ethers exposes event arguments by both index and name, but indexed
    // access keeps this benchmark robust across generated ABI variants.
    const requestId = request.args[0];
    const treeAddress = await zkIdentity.identityTree();
    const tree = await ethers.getContractAt("IdentityTree", treeAddress);
    const root = await tree.getRoot();
    const commitments = denominations.map((_, index) => firstCommitment + BigInt(index));
    const responseReceipt = await (await data.connect(actionRelayer).provideResponseZK(
      requestId, "response", commitments, denominations,
      ZERO_PROOF_A, ZERO_PROOF_B, ZERO_PROOF_C, [
        root,
        1,
        requestId % 21888242871839275222246405745257275088548364400416034343698204186575808495617n
      ]
    )).wait();
    return { responseReceipt, commitments };
  }

  async function unrelatedEvents(count) {
    for (let i = 0; i < count; i++) await shareCti(REWARD);
  }

  async function claim(denomination, nullifierHash) {
    const root = 999n;
    return (await data.connect(claimRelayer).claimReward(
      ZERO_PROOF_A, ZERO_PROOF_B, ZERO_PROOF_C, root, denomination,
      nullifierHash, recipient.address, 0
    )).wait();
  }

  before(async () => { results = { methodology: "Passive observer: transaction sender, event logs, order, and public denomination only.", scenarios: {} }; });

  it("Scenario A — direct/synchronous baseline exposes the same participant", async function () {
    await deployFixture();
    const ctiId = await shareCti();
    await data.connect(consumer).initialRequest(ctiId, 1);
    await data.connect(consumer).provideCredentials(1, "credentials", { value: REWARD * 2n });
    const responseReceipt = await (await data.connect(delegate).provideResponse(1, "response")).wait();
    expect(events(responseReceipt, "ResponseProvided")).to.have.length(1);

    results.scenarios.A = {
      name: "direct/synchronous baseline",
      actionTransaction: responseReceipt.hash,
      extractionTransaction: responseReceipt.hash,
      sameTransaction: true,
      actionSender: delegate.address,
      payoutRecipient: delegate.address,
      addressReuse: true,
      candidateSetSize: 1
    };
  });

  it("Scenario B — deferred claim removes address reuse but a singleton note remains distinguishable", async function () {
    await deployFixture();
    const { responseReceipt } = await zkResponseWithNotes([REWARD], 20000n);
    const mintEvents = events(responseReceipt, "RewardNoteMinted");
    await unrelatedEvents(6);
    const claimReceipt = await claim(REWARD, 50001n);

    expect(mintEvents).to.have.length(1);
    expect(address(actionRelayer.address)).not.to.equal(address(claimRelayer.address));
    results.scenarios.B = {
      name: "deferred reward",
      actionTransaction: responseReceipt.hash,
      extractionTransaction: claimReceipt.hash,
      unrelatedEventsBetween: 6,
      actionSender: actionRelayer.address,
      claimSender: claimRelayer.address,
      recipient: recipient.address,
      addressReuse: false,
      sameDenominationCandidates: mintEvents.length,
      candidateSetSize: mintEvents.length
    };
  });

  it("Scenario C — identical notes enlarge the claim candidate set", async function () {
    await deployFixture();
    const denominations = Array(10).fill(NOTE);
    const { responseReceipt } = await zkResponseWithNotes(denominations, 30000n);
    const mintEvents = events(responseReceipt, "RewardNoteMinted");
    await unrelatedEvents(12);
    const claimReceipt = await claim(NOTE, 60001n);
    const sameDenominationCandidates = mintEvents.filter((event) => event.args.denomination === NOTE).length;

    expect(mintEvents).to.have.length(10);
    expect(sameDenominationCandidates).to.equal(10);
    results.scenarios.C = {
      name: "deferred + fixed denominations",
      actionTransaction: responseReceipt.hash,
      extractionTransaction: claimReceipt.hash,
      unrelatedEventsBetween: 12,
      noteDenominationWei: NOTE.toString(),
      identicalNotesMinted: mintEvents.length,
      addressReuse: false,
      candidateSetSize: sameDenominationCandidates
    };
  });

  after(async () => {
    const resultsDir = path.join(__dirname, "../../benchmark-results");
    fs.mkdirSync(resultsDir, { recursive: true });
    fs.writeFileSync(path.join(resultsDir, "linkability-results.json"), `${JSON.stringify(results, null, 2)}\n`);
    console.log("Linkability benchmark results saved to benchmark-results/linkability-results.json");
  });
});

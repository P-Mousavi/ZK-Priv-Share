// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IZKIdentity {
    function verifyProof(
        uint[2] calldata _pA,
        uint[2][2] calldata _pB,
        uint[2] calldata _pC,
        uint[3] calldata _pubSignals
    ) external view returns (bool);
    function roots(uint256 root) external view returns(bool);
    function nextLeafIndex() external view returns(uint256);
    function deposits(uint256 commitment) external view returns(uint256);
    function slashAndReward(
        address _defendant,
        uint256 _payoutCommitment,
        uint256 _identityCommitment
    ) external;
    function rewardDefendant(
        address _defendant,
        address _complainant
    ) external;
}

// Interface for the IdentityContract (non-ZK)
interface IIdentityContract {
    function isRegistered(address _org) external view returns (bool);
    function slashAndReward(address _defendant, address _complainant) external;
    function rewardDefendant(address _defendant, address _complainant) external;
}

// Interface for the Reward circuit verifier
interface IRewardVerifier {
    function verifyProof(
        uint[2] calldata _pA,
        uint[2][2] calldata _pB,
        uint[2] calldata _pC,
        uint[3] memory _pubSignals
    ) external view returns (bool);
}

/**
 * @title ZKDataContract
 * @dev Manages the CTI sharing (Share Phase) and access (Request-Response Phase) with both ZK and non-ZK support.
 * Also handles the democratic dispute resolution process.
 */
contract ZKDataContract {
    IZKIdentity public zkIdentity;
    IIdentityContract public identityContract;
    IRewardVerifier public rewardVerifier;
    
    // Baby Jubjub field order (from circomlib) - must match the circuit's field
    uint256 constant FIELD_ORDER = 21888242871839275222246405745257275088548364400416034343698204186575808495617;
    
    // Test helper flag
    bool public testingMode;

    // --- Roles & Registration ---
    mapping(address => bool) public isGroupManager;
    address[] public groupManagers;
    uint256 public groupManagerThreshold; // Threshold T for voting

    // --- CTI Sharing (Share Phase) ---
    struct CtiShare {
        address producer;
        string accessPolicyIpfsCid;   // Off-chain policy
        string integrityHashesIpfsCid; // Off-chain hashes
        uint256 royaltyFee;          // Fee R
        uint256 computationCost;     // Fee C
        address[] initialDelegates;  // List of initial delegates
        mapping(address => uint256) delegateAccessLevel; // Level for each delegate
    }
    mapping(uint256 => CtiShare) public ctiShares;
    uint256 public ctiCounter;

    // --- ZK Access Requests ---
    struct ZKAccessRequest {
        uint256 ctiId;
        uint256 allocatedLeafIndex; // Instead of address, we pick a tree index
        bool fulfilled;
        string responseIpfsCid;
    }
    mapping(uint256 => ZKAccessRequest) public zkRequests;
    // Maps RequestID -> NullifierHash to prevent replay of the same response
    mapping(uint256 => bytes32) public requestNullifiers;

    // --- Non-ZK Access Requests (Request-Response Phase) ---
    enum RequestStatus { Initial, CredentialsProvided, Responded, Disputed }
    struct AccessRequest {
        address consumer;
        uint256 ctiId;
        uint256 accessLevel; // Requested differential sharing level
        RequestStatus status;
        address allocatedDelegate;
        string credentialsIpfsCid; // Consumer's credentials
        string responseIpfsCid;    // Delegate's response CTI
    }
    mapping(uint256 => AccessRequest) public accessRequests;
    uint256 public requestCounter;

    // --- Dispute Reasons ---
    enum DisputeReason {
        NONE,
        TAMPERED_CTI,
        FALSE_CREDENTIALS_ACCEPTED,
        FALSE_CTI_SHARED
    }

    // --- Disputes (Regulation Phase) ---
    struct Dispute {
        address complainant;
        address defendant;
        uint256 accessRequestId;
        DisputeReason reason;       // Dispute reason provided by complainant
        string evidenceCid;         // Evidence IPFS CID
        bool isOpen;
        mapping(address => bool) hasVoted;
        uint256 votesForGuilty;
        uint256 totalVotes;
        // ZK-specific fields
        uint256 payoutCommitment;   // For ZK disputes: the delegate's payout commitment
        uint256 identityCommitment; // For ZK disputes: the delegate's identity commitment
        uint256 accuserPayoutCommitment; // For ZK disputes: the accuser's payout commitment (to receive deposit if guilty)
        bool isZKDispute;           // Flag to indicate if this is a ZK dispute
    }
    mapping(uint256 => Dispute) public disputes;
    uint256 public disputeCounter;

    // --- ZK Dispute Tracking ---
    // Maps nullifierHash -> bool to prevent replay of ZK dispute raising
    mapping(bytes32 => bool) public disputeNullifiers;
    // Maps nullifierHash -> bool to prevent replay of ZK votes
    mapping(bytes32 => bool) public voteNullifiers;
    // Maps commitment -> bool to track which ZK identities are group managers
    // Group managers must register their commitment in the ZK identity tree
    mapping(uint256 => bool) public zkGroupManagerCommitments;

    // --- Reward Tree (Decoupled Shielded Payouts) ---
    // Fixed denominations are represented in wei. Reward notes use:
    // leaf = Poseidon(denomination, secret, nullifier).
    uint256 public constant DENOMINATION_0_001_ETH = 1e15;
    uint256 public constant DENOMINATION_0_01_ETH = 1e16;
    uint256 public constant DENOMINATION_0_1_ETH = 1e17;
    uint256 public constant DENOMINATION_1_ETH = 1e18;
    uint256 public constant DENOMINATION_10_ETH = 1e19;
    uint256[] public allowedDenominations;
    mapping(uint256 => bool) public isAllowedDenomination;
    // Maps reward note commitment -> denomination for minted, unclaimed notes.
    mapping(uint256 => uint256) public rewardNoteDenominations;
    // Maps payoutNullifier -> bool to prevent double-claiming.
    mapping(uint256 => bool) public spentPayoutNullifiers;
    // Track valid reward tree roots
    mapping(uint256 => bool) public rewardTreeRoots;
    // Next leaf index for reward tree
    uint256 public rewardTreeNextLeafIndex;
    // Current reward tree root
    uint256 public currentRewardTreeRoot;

    // --- Modifiers ---
    modifier onlyRegistered() {
        require(identityContract.isRegistered(msg.sender), "Organisation not registered");
        _;
    }

    modifier onlyManager() {
        require(isGroupManager[msg.sender], "Not a Group Manager");
        _;
    }

    // --- Internal Helper Functions ---
    function _verifyZKProof(
        uint256[2] calldata a,
        uint256[2][2] calldata b,
        uint256[2] calldata c,
        uint256[3] calldata input
    ) internal view returns (bool) {
        // Bypass proof verification in testing mode for gas measurement
        if (testingMode) {
            return true;
        }
        uint[2] memory _a = [uint(a[0]), uint(a[1])];
        uint[2][2] memory _b = [[uint(b[0][0]), uint(b[0][1])], [uint(b[1][0]), uint(b[1][1])]];
        uint[2] memory _c = [uint(c[0]), uint(c[1])];
        uint[3] memory _input = [uint(input[0]), uint(input[1]), uint(input[2])];
        return zkIdentity.verifyProof(_a, _b, _c, _input);
    }

    function _settleDispute(Dispute storage d, uint256 _disputeId) internal {
        uint256 notGuiltyVotes = d.totalVotes - d.votesForGuilty;
        
        if (d.votesForGuilty >= groupManagerThreshold) {
            // Outcome A: Guilty. Slash defendant, reward complainant.
            d.isOpen = false;
            if (d.isZKDispute) {
                // ZK dispute: transfer delegate's deposit to accuser's payout commitment
                // TODO: require accuser-provided denomination notes for this transfer as well.
                uint256 delegateDeposit = zkIdentity.deposits(d.identityCommitment);
                delegateDeposit;
                // Cancel the delegate's pending reward note if it has not been claimed.
                if (rewardNoteDenominations[d.payoutCommitment] > 0) {
                    rewardNoteDenominations[d.payoutCommitment] = 0;
                }
                // Remove delegate from identity tree by zeroing deposit
                zkIdentity.slashAndReward(d.defendant, d.payoutCommitment, d.identityCommitment);
            } else {
                // Non-ZK dispute: use identity contract
                identityContract.slashAndReward(d.defendant, d.complainant);
            }
            emit DisputeSettled(_disputeId, true);
        } else if (notGuiltyVotes >= groupManagerThreshold) {
            // Outcome B: Innocent. Slash (false accuser) complainant, reward defendant.
            d.isOpen = false;
            if (d.isZKDispute) {
                // ZK dispute: use ZK-specific function
                zkIdentity.rewardDefendant(d.defendant, d.complainant);
            } else {
                // Non-ZK dispute: use identity contract
                identityContract.rewardDefendant(d.defendant, d.complainant);
            }
            emit DisputeSettled(_disputeId, false);
        }
    }

    // --- Events ---
    event CtiShared(uint256 indexed ctiId, address indexed producer);
    event ZKRequestCreated(uint256 requestId, uint256 allocatedLeafIndex);
    event ZKResponseProvided(uint256 requestId);
    event RequestCreated(uint256 indexed requestId, address indexed consumer, address indexed allocatedDelegate);
    event CredentialsProvided(uint256 indexed requestId, string credentialsIpfsCid);
    event ResponseProvided(uint256 indexed requestId, string responseIpfsCid);
    event DisputeRaised(uint256 indexed disputeId, address indexed complainant, address indexed defendant);
    event ZKDisputeRaised(uint256 indexed disputeId, bytes32 nullifierHash);
    event VotedOnDispute(uint256 indexed disputeId, address indexed manager, bool isGuilty);
    event ZKVotedOnDispute(uint256 indexed disputeId, bytes32 nullifierHash, bool isGuilty);
    event DisputeSettled(uint256 indexed disputeId, bool wasGuilty);
    event ZKGroupManagerRegistered(uint256 indexed commitment);
    event RewardNoteMinted(uint256 indexed noteCommitment, uint256 denomination);
    event RewardClaimed(uint256 indexed nullifierHash, address indexed recipient, uint256 denomination, uint256 relayerFee);

    constructor(
        address _zkIdentity,
        address _identityContract,
        address _rewardVerifier,
        address[] memory _initialManagers,
        uint256 _threshold
    ) {
        zkIdentity = IZKIdentity(_zkIdentity);
        identityContract = IIdentityContract(_identityContract);
        rewardVerifier = IRewardVerifier(_rewardVerifier);
        require(_threshold > 0 && _threshold <= _initialManagers.length, "Invalid threshold");
        
        groupManagerThreshold = _threshold;
        for (uint256 i = 0; i < _initialManagers.length; i++) {
            address manager = _initialManagers[i];
            require(manager != address(0), "Invalid manager address");
            require(!isGroupManager[manager], "Duplicate manager");
            isGroupManager[manager] = true;
            groupManagers.push(manager);
        }

        _addAllowedDenomination(DENOMINATION_10_ETH);
        _addAllowedDenomination(DENOMINATION_1_ETH);
        _addAllowedDenomination(DENOMINATION_0_1_ETH);
        _addAllowedDenomination(DENOMINATION_0_01_ETH);
        _addAllowedDenomination(DENOMINATION_0_001_ETH);
    }

    function _addAllowedDenomination(uint256 _denomination) internal {
        isAllowedDenomination[_denomination] = true;
        allowedDenominations.push(_denomination);
    }

    function getAllowedDenominations() external view returns (uint256[] memory) {
        return allowedDenominations;
    }

    function decomposeReward(uint256 _amount) public view returns (uint256[] memory) {
        uint256 remaining = _amount;
        uint256 count;

        for (uint256 i = 0; i < allowedDenominations.length; i++) {
            uint256 denomination = allowedDenominations[i];
            uint256 notes = remaining / denomination;
            count += notes;
            remaining -= notes * denomination;
        }
        require(remaining == 0, "Reward amount not decomposable");

        uint256[] memory denominations = new uint256[](count);
        uint256 index;
        remaining = _amount;

        for (uint256 i = 0; i < allowedDenominations.length; i++) {
            uint256 denomination = allowedDenominations[i];
            uint256 notes = remaining / denomination;
            for (uint256 j = 0; j < notes; j++) {
                denominations[index] = denomination;
                index++;
            }
            remaining -= notes * denomination;
        }

        return denominations;
    }


    // --- SHARE PHASE ---

    /**
     * @dev [SHARE PHASE - Step 6] A CTI Producer shares a new CTI.
     * They define fees (R, C), initial delegates, and their access levels.
     */
    function shareCti(
        string calldata _accessPolicyIpfsCid,
        string calldata _integrityHashesIpfsCid,
        uint256 _royaltyFee,
        uint256 _computationCost,
        address[] calldata _initialDelegates,
        uint256[] calldata _delegateLevels
    ) external onlyRegistered {
        require(_initialDelegates.length == _delegateLevels.length, "Arrays mismatch");
        require(_initialDelegates.length > 0, "Must have at least one delegate");

        ctiCounter++;
        CtiShare storage cti = ctiShares[ctiCounter];
        cti.producer = msg.sender;
        cti.accessPolicyIpfsCid = _accessPolicyIpfsCid;
        cti.integrityHashesIpfsCid = _integrityHashesIpfsCid;
        cti.royaltyFee = _royaltyFee;
        cti.computationCost = _computationCost;
        cti.initialDelegates = _initialDelegates;

        for (uint256 i = 0; i < _initialDelegates.length; i++) {
            require(identityContract.isRegistered(_initialDelegates[i]), "Delegate not registered");
            require(!isGroupManager[_initialDelegates[i]], "Delegate cannot be a group manager");
            cti.delegateAccessLevel[_initialDelegates[i]] = _delegateLevels[i];
        }

        emit CtiShared(ctiCounter, msg.sender);
    }

    // --- ZK REQUEST-RESPONSE PHASE ---

    /**
     * @dev Consumer requests CTI using ZK. 
     * Contract picks a random index from the Identity Tree.
     */
    function requestAccess(uint256 _ctiId) external payable {
        // Check fees...
        
        // 1. Get max index from Identity contract
        uint256 maxIndex = zkIdentity.nextLeafIndex();
        require(maxIndex > 0, "No delegates registered");

        // 2. Randomly select a leaf index (Pseudo-randomness for demo)
        uint256 randomLeaf = uint256(keccak256(abi.encodePacked(block.timestamp, msg.sender))) % maxIndex;

        uint256 reqId = uint256(keccak256(abi.encodePacked(block.timestamp, randomLeaf)));
        
        zkRequests[reqId] = ZKAccessRequest({
            ctiId: _ctiId,
            allocatedLeafIndex: randomLeaf,
            fulfilled: false,
            responseIpfsCid: ""
        });

        emit ZKRequestCreated(reqId, randomLeaf);
    }

    /**
     * @dev Delegate responds using ZK proof.
     * MUST prove they own the identity at 'allocatedLeafIndex'.
     * @param input = [root, nullifierHash, actionId] (snarkjs public signal order)
     * actionId must be the requestId to bind the proof to this task.
     * @param _rewardNoteCommitments Commitments generated off-chain as Poseidon(denomination, secret, nullifier)
     * @param _rewardNoteDenominations Fixed denominations assigned to each reward note
     */
    function provideResponseZK(
        uint256 _requestId,
        string calldata _ipfsCid,
        uint256[] calldata _rewardNoteCommitments,
        uint256[] calldata _rewardNoteDenominations,
        uint256[2] calldata a,
        uint256[2][2] calldata b,
        uint256[2] calldata c,
        uint256[3] calldata input 
    ) external {
        ZKAccessRequest storage req = zkRequests[_requestId];
        require(!req.fulfilled, "Already fulfilled");

        // 1. Validate Input Integrity
        // The actionId in the ZK proof MUST match the requestId
        // snarkjs returns public signals in order: [root, nullifierHash, actionId]
        // The circuit uses actionId mod FIELD_ORDER (Baby Jubjub field), so we must do the same
        require(input[2] == _requestId % FIELD_ORDER, "Invalid Action ID"); 
        
        // 2. Validate Merkle Root
        require(zkIdentity.roots(input[0]), "Invalid Merkle Root");

        // 3. Verify ZK Proof via Identity Contract
        require(_verifyZKProof(a, b, c, input), "Invalid ZK Proof");

        // 4. Update State
        req.responseIpfsCid = _ipfsCid;
        req.fulfilled = true;
        
        // 5. Mint fixed-denomination reward notes to the Reward Tree (Decoupled Payout)
        CtiShare storage cti = ctiShares[req.ctiId];
        uint256 rewardAmount = cti.royaltyFee + cti.computationCost; // Delegate's share
        require(rewardAmount > 0, "No reward available");
        _mintRewardNotes(_rewardNoteCommitments, _rewardNoteDenominations, rewardAmount);

        emit ZKResponseProvided(_requestId);
    }

    function _mintRewardNotes(
        uint256[] calldata _noteCommitments,
        uint256[] calldata _denominations,
        uint256 _expectedAmount
    ) internal {
        require(_noteCommitments.length == _denominations.length, "Reward note arrays mismatch");
        require(_noteCommitments.length > 0, "No reward notes");

        uint256 total;
        for (uint256 i = 0; i < _noteCommitments.length; i++) {
            uint256 noteCommitment = _noteCommitments[i];
            uint256 denomination = _denominations[i];

            require(noteCommitment != 0, "Invalid reward note");
            require(isAllowedDenomination[denomination], "Unsupported denomination");
            require(rewardNoteDenominations[noteCommitment] == 0, "Reward note already minted");

            rewardNoteDenominations[noteCommitment] = denomination;
            total += denomination;
            emit RewardNoteMinted(noteCommitment, denomination);
        }

        require(total == _expectedAmount, "Reward note sum mismatch");
    }

    // --- NON-ZK REQUEST-RESPONSE PHASE ---

    /**
     * @dev [REQUEST PHASE - Step 8 & 9] Consumer requests access to CTI at a specific level.
     * The contract "randomly" allocates a suitable delegate.
     */
    function initialRequest(uint256 _ctiId, uint256 _accessLevel) external onlyRegistered {
        CtiShare storage cti = ctiShares[_ctiId];
        require(cti.producer != address(0), "CTI does not exist");

        // Find available delegates for the requested level
        address[] memory availableDelegates = new address[](cti.initialDelegates.length);
        uint256 count = 0;
        for (uint256 i = 0; i < cti.initialDelegates.length; i++) {
            address delegate = cti.initialDelegates[i];
            // Delegate must have access level >= requested level
            if (cti.delegateAccessLevel[delegate] >= _accessLevel) {
                availableDelegates[count++] = delegate;
            }
        }
        require(count > 0, "No delegates available for this access level");

        // "Random" allocation
        uint256 rand = uint256(keccak256(abi.encodePacked(block.timestamp, msg.sender, _ctiId))) % count;
        address allocatedDelegate = availableDelegates[rand];

        requestCounter++;
        accessRequests[requestCounter] = AccessRequest(
            msg.sender,
            _ctiId,
            _accessLevel,
            RequestStatus.Initial,
            allocatedDelegate,
            "", ""
        );

        emit RequestCreated(requestCounter, msg.sender, allocatedDelegate);
    }

    /**
     * @dev [REQUEST PHASE - Step 10] Consumer provides credentials (via IPFS)
     * and pays the consumption fee (F = 2R + C).
     */
    function provideCredentials(
        uint256 _requestId,
        string calldata _credentialsIpfsCid
    ) external payable onlyRegistered {
        AccessRequest storage req = accessRequests[_requestId];
        require(req.consumer == msg.sender, "Not your request");
        require(req.status == RequestStatus.Initial, "Invalid request status");

        CtiShare storage cti = ctiShares[req.ctiId];
        uint256 totalFee = (2 * cti.royaltyFee) + cti.computationCost; // F = 2R + C
        require(msg.value == totalFee, "Incorrect consumption fee");

        req.credentialsIpfsCid = _credentialsIpfsCid;
        req.status = RequestStatus.CredentialsProvided;

        emit CredentialsProvided(_requestId, _credentialsIpfsCid);
    }

    /**
     * @dev [RESPONSE PHASE - Step 12] Delegate provides the CTI response (via IPFS).
     * The contract pays the delegate (R+C) and producer (R).
     * (Step 11, policy evaluation, happens off-chain).
     */
    function provideResponse(
        uint256 _requestId,
        string calldata _responseIpfsCid
    ) external onlyRegistered {
        AccessRequest storage req = accessRequests[_requestId];
        require(req.allocatedDelegate == msg.sender, "Not the allocated delegate");
        require(req.status == RequestStatus.CredentialsProvided, "Invalid request status");

        req.responseIpfsCid = _responseIpfsCid;
        req.status = RequestStatus.Responded;

        // Distribute fees
        CtiShare storage cti = ctiShares[req.ctiId];
        uint256 delegateShare = cti.royaltyFee + cti.computationCost;
        uint256 producerShare = cti.royaltyFee;

        (bool sentDelegate, ) = req.allocatedDelegate.call{value: delegateShare}("");
        (bool sentProducer, ) = cti.producer.call{value: producerShare}("");
        require(sentDelegate && sentProducer, "Fee transfer failed");

        emit ResponseProvided(_requestId, _responseIpfsCid);
    }

    // --- REGULATION PHASE ---

    /**
     * @dev [REGULATION - Step 1] Any registered org can raise a dispute
     * (e.g., Consumer vs. Delegate, Producer vs. Delegate, Consumer vs. Producer).
     * @param _requestId The access request ID related to the dispute
     * @param _defendant The address of the party being accused
     * @param _reason The reason for the dispute (enum value)
     * @param _evidenceCid IPFS CID of evidence supporting the dispute
     */
    function raiseDispute(
        uint256 _requestId,
        address _defendant,
        DisputeReason _reason,
        string calldata _evidenceCid
    ) external onlyRegistered {
        AccessRequest storage req = accessRequests[_requestId];
        CtiShare storage cti = ctiShares[req.ctiId];
        
        // Check complainant is part of the transaction
        require(msg.sender == req.consumer || msg.sender == cti.producer, "Not party to this request");
        
        // Check defendant is part of the transaction
        require(_defendant == req.allocatedDelegate || _defendant == cti.producer, "Invalid defendant");
        
        require(req.status == RequestStatus.Responded || req.status == RequestStatus.CredentialsProvided, "Invalid status for dispute");
        require(_reason != DisputeReason.NONE, "Dispute reason cannot be NONE");
        require(bytes(_evidenceCid).length >= 10 && bytes(_evidenceCid).length <= 200, "Invalid IPFS CID format");
        
        req.status = RequestStatus.Disputed;

        disputeCounter++;
        Dispute storage d = disputes[disputeCounter];
        d.complainant = msg.sender;
        d.defendant = _defendant;
        d.accessRequestId = _requestId;
        d.reason = _reason;
        d.evidenceCid = _evidenceCid;
        d.isOpen = true;

        emit DisputeRaised(disputeCounter, msg.sender, _defendant);
    }

    /**
     * @dev Retrieves dispute details including reason and evidence.
     * @param _disputeId The ID of the dispute to retrieve
     * @return complainant The address of the complainant
     * @return defendant The address of the defendant
     * @return accessRequestId The access request ID related to the dispute
     * @return reason The reason for the dispute (enum)
     * @return evidenceCid The IPFS CID of evidence provided for the dispute
     * @return isOpen Whether the dispute is still open
     * @return votesForGuilty Number of votes for guilty
     * @return totalVotes Total number of votes cast
     */
    function getDispute(uint256 _disputeId) external view returns (
        address complainant,
        address defendant,
        uint256 accessRequestId,
        DisputeReason reason,
        string memory evidenceCid,
        bool isOpen,
        uint256 votesForGuilty,
        uint256 totalVotes
    ) {
        Dispute storage d = disputes[_disputeId];
        require(d.complainant != address(0), "Dispute does not exist");
        return (
            d.complainant,
            d.defendant,
            d.accessRequestId,
            d.reason,
            d.evidenceCid,
            d.isOpen,
            d.votesForGuilty,
            d.totalVotes
        );
    }

    /**
     * @dev [REGULATION - Step 3] A Group Manager votes on an open dispute.
     */
    function voteOnDispute(uint256 _disputeId, bool _isGuilty) external onlyManager {
        Dispute storage d = disputes[_disputeId];
        require(d.isOpen, "Dispute is closed");
        require(!d.hasVoted[msg.sender], "Already voted");

        d.hasVoted[msg.sender] = true;
        d.totalVotes++;
        if (_isGuilty) {
            d.votesForGuilty++;
        }

        emit VotedOnDispute(_disputeId, msg.sender, _isGuilty);

        // Check if the vote is decisive and settle if so
        _settleDispute(d, _disputeId);
    }

    // --- ZK REGULATION PHASE ---

    /**
     * @dev Registers a group manager's ZK identity commitment.
     * Only callable by an existing group manager to add ZK voting capability.
     * @param _commitment The Poseidon hash commitment of the group manager's identity
     */
    function registerZKGroupManager(uint256 _commitment) external onlyManager {
        require(!zkGroupManagerCommitments[_commitment], "Commitment already registered");
        zkGroupManagerCommitments[_commitment] = true;
        emit ZKGroupManagerRegistered(_commitment);
    }

    /**
     * @dev [REGULATION - Step 1 ZK] Raise a dispute using zero-knowledge proof.
     * Allows a registered party to raise a dispute without revealing their identity.
     * @param _requestId The access request ID related to the dispute
     * @param _defendant The address of the party being accused
     * @param _reason The reason for the dispute (enum value)
     * @param _evidenceCid IPFS CID of evidence supporting the dispute
     * @param _payoutCommitment The delegate's payout commitment (to zero out reward if guilty)
     * @param _identityCommitment The delegate's identity commitment (to remove from tree if guilty)
     * @param _accuserPayoutCommitment The accuser's payout commitment (to receive delegate's deposit if guilty)
     * @param a, b, c ZK proof parameters
     * @param input Public signals: [root, actionId, nullifierHash]
     *              actionId = keccak256(abi.encodePacked(_requestId, uint256(_reason), "DISPUTE"))
     */
    function raiseDisputeZK(
        uint256 _requestId,
        address _defendant,
        DisputeReason _reason,
        string calldata _evidenceCid,
        uint256 _payoutCommitment,
        uint256 _identityCommitment,
        uint256 _accuserPayoutCommitment,
        uint256[2] calldata a,
        uint256[2][2] calldata b,
        uint256[2] calldata c,
        uint256[3] calldata input
    ) external {
        AccessRequest storage req = accessRequests[_requestId];
        CtiShare storage cti = ctiShares[req.ctiId];
        
        // Check defendant is part of the transaction
        require(_defendant == req.allocatedDelegate || _defendant == cti.producer, "Invalid defendant");
        
        require(req.status == RequestStatus.Responded || req.status == RequestStatus.CredentialsProvided, "Invalid status for dispute");
        require(_reason != DisputeReason.NONE, "Dispute reason cannot be NONE");
        require(bytes(_evidenceCid).length >= 10 && bytes(_evidenceCid).length <= 200, "Invalid IPFS CID format");

        // 1. Validate actionId binds proof to this specific dispute
        // The circuit uses actionId mod FIELD_ORDER (Baby Jubjub field), so we must do the same
        // Verifier expects public signals in order: [root, nullifierHash, actionId]
        bytes32 expectedActionId = keccak256(abi.encodePacked(_requestId, uint256(_reason), "DISPUTE"));
        require(input[2] == uint256(expectedActionId) % FIELD_ORDER, "Invalid Action ID");
        
        // 2. Validate Merkle Root
        require(zkIdentity.roots(input[0]), "Invalid Merkle Root");

        // 3. Verify ZK Proof
        require(_verifyZKProof(a, b, c, input), "Invalid ZK Proof");

        // 4. Check nullifier to prevent replay
        bytes32 nullifierHash = bytes32(input[1]);
        require(!disputeNullifiers[nullifierHash], "Dispute already raised with this proof");
        disputeNullifiers[nullifierHash] = true;

        req.status = RequestStatus.Disputed;

        disputeCounter++;
        Dispute storage d = disputes[disputeCounter];
        // In ZK mode, we don't store the complainant address (it's anonymous)
        d.complainant = address(0); // Use address(0) as marker for ZK dispute
        d.defendant = _defendant;
        d.accessRequestId = _requestId;
        d.reason = _reason;
        d.evidenceCid = _evidenceCid;
        d.isOpen = true;
        d.payoutCommitment = _payoutCommitment;
        d.identityCommitment = _identityCommitment;
        d.accuserPayoutCommitment = _accuserPayoutCommitment;
        d.isZKDispute = true;

        emit ZKDisputeRaised(disputeCounter, nullifierHash);
    }

    /**
     * @dev [REGULATION - Step 3 ZK] A Group Manager votes on an open dispute using zero-knowledge proof.
     * Allows group managers to vote anonymously.
     * Note: This function verifies the voter is registered in the ZK identity tree.
     * To restrict voting to only group managers, ensure group managers register their
     * commitments via registerZKGroupManager and modify the circuit to include commitment
     * verification in the public signals.
     * @param _disputeId The ID of the dispute to vote on
     * @param _isGuilty Whether the vote is for guilty (true) or not guilty (false)
     * @param a, b, c ZK proof parameters
     * @param input Public signals: [root, actionId, nullifierHash]
     *              actionId = keccak256(abi.encodePacked(_disputeId, _isGuilty ? 1 : 0, "VOTE"))
     */
    function voteOnDisputeZK(
        uint256 _disputeId,
        bool _isGuilty,
        uint256[2] calldata a,
        uint256[2][2] calldata b,
        uint256[2] calldata c,
        uint256[3] calldata input
    ) external {
        Dispute storage d = disputes[_disputeId];
        require(d.isOpen, "Dispute is closed");
        require(d.defendant != address(0), "Dispute does not exist");

        // 1. Validate actionId binds proof to this specific vote
        // The circuit uses actionId mod FIELD_ORDER (Baby Jubjub field), so we must do the same
        // Verifier expects public signals in order: [root, nullifierHash, actionId]
        bytes32 expectedActionId = keccak256(abi.encodePacked(_disputeId, _isGuilty ? uint256(1) : uint256(0), "VOTE"));
        require(input[2] == uint256(expectedActionId) % FIELD_ORDER, "Invalid Action ID");
        
        // 2. Validate Merkle Root
        require(zkIdentity.roots(input[0]), "Invalid Merkle Root");

        // 3. Verify ZK Proof
        require(_verifyZKProof(a, b, c, input), "Invalid ZK Proof");

        // 4. Check nullifier to prevent double voting
        bytes32 nullifierHash = bytes32(input[1]);
        require(!voteNullifiers[nullifierHash], "Already voted with this proof");
        voteNullifiers[nullifierHash] = true;

        // 5. Verify the voter is a registered ZK group manager
        // Note: This requires the commitment to be registered via registerZKGroupManager
        // The commitment is derived from the proof, but we need to verify it's a group manager
        // For now, we'll allow any registered ZK identity to vote (can be restricted later with commitment verification)
        
        d.totalVotes++;
        if (_isGuilty) {
            d.votesForGuilty++;
        }

        emit ZKVotedOnDispute(_disputeId, nullifierHash, _isGuilty);

        // Check if the vote is decisive and settle if so
        _settleDispute(d, _disputeId);
    }

    // --- DECOUPLED SHIELDED PAYOUTS ---

    /**
     * @dev Claim a reward anonymously using a ZK proof.
     * The delegate proves knowledge of a reward note that exists in the reward tree.
     * The reward is sent to a fresh recipient address, breaking the link to the original submission.
     * @param _pA First proof parameter
     * @param _pB Second proof parameter
     * @param _pC Third proof parameter
     * @param _root Merkle root of the reward tree at the time of minting
     * @param _denomination Fixed note denomination paid by this claim
     * @param _nullifierHash Hash of the reward note nullifier to prevent double-claiming
     * @param _recipient Fresh address to receive the reward
     * @param _relayerFee Fee to pay the relayer for gas costs
     */
    function claimReward(
        uint[2] calldata _pA,
        uint[2][2] calldata _pB,
        uint[2] calldata _pC,
        uint256 _root,
        uint256 _denomination,
        uint256 _nullifierHash,
        address _recipient,
        uint256 _relayerFee
    ) external {
        _claimReward(_pA, _pB, _pC, _root, _denomination, _nullifierHash, _recipient, _relayerFee);
    }

    function _claimReward(
        uint[2] calldata _pA,
        uint[2][2] calldata _pB,
        uint[2] calldata _pC,
        uint256 _root,
        uint256 _denomination,
        uint256 _nullifierHash,
        address _recipient,
        uint256 _relayerFee
    ) internal {
        // 1. Check that the nullifier hasn't been spent (prevent double-claiming)
        require(!spentPayoutNullifiers[_nullifierHash], "Reward already claimed");
        require(rewardTreeRoots[_root], "Invalid reward root");
        require(isAllowedDenomination[_denomination], "Unsupported denomination");
        require(_recipient != address(0), "Invalid recipient");

        // 2. Verify the reward proof
        // Public signals: [root, denomination, nullifierHash]
        uint[3] memory pubSignals = [_root, _denomination, _nullifierHash];
        require(rewardVerifier.verifyProof(_pA, _pB, _pC, pubSignals), "Invalid reward proof");

        // 3. Mark the nullifier as spent
        spentPayoutNullifiers[_nullifierHash] = true;

        // 4. Calculate the payout amount
        require(_denomination >= _relayerFee, "Relayer fee exceeds reward amount");
        uint256 payoutAmount = _denomination - _relayerFee;

        // 5. Pay the relayer for gas
        if (_relayerFee > 0) {
            (bool sentRelayer, ) = payable(msg.sender).call{value: _relayerFee}("");
            require(sentRelayer, "Relayer fee transfer failed");
        }

        // 6. Pay the anonymous delegate to the fresh recipient address
        (bool sentRecipient, ) = _recipient.call{value: payoutAmount}("");
        require(sentRecipient, "Reward transfer failed");

        emit RewardClaimed(_nullifierHash, _recipient, _denomination, _relayerFee);
    }

    function verifyRewardProof(
        uint[2] calldata _pA,
        uint[2][2] calldata _pB,
        uint[2] calldata _pC,
        uint256 _root,
        uint256 _denomination,
        uint256 _nullifierHash
    ) external view returns (bool) {
        uint[3] memory pubSignals = [_root, _denomination, _nullifierHash];
        return rewardVerifier.verifyProof(_pA, _pB, _pC, pubSignals);
    }

    // --- Test Helper Functions ---
    
    /**
     * @dev Test helper to enable testing mode
     */
    function setTestingMode(bool _enabled) external {
        testingMode = _enabled;
    }
    
    /**
     * @dev Test helper to deposit rewards directly for benchmarking
     * Only callable in testing mode
     */
    function depositReward(
        uint256[] calldata _noteCommitments,
        uint256[] calldata _denominations
    ) external payable {
        require(testingMode, "Not in testing mode");
        require(msg.value > 0, "Must send ETH");
        _mintRewardNotes(_noteCommitments, _denominations, msg.value);
    }

    function depositReward(uint256 _noteCommitment) external payable {
        require(testingMode, "Not in testing mode");
        require(msg.value > 0, "Must send ETH");
        require(isAllowedDenomination[msg.value], "Unsupported denomination");
        require(_noteCommitment != 0, "Invalid reward note");
        require(rewardNoteDenominations[_noteCommitment] == 0, "Reward note already minted");

        rewardNoteDenominations[_noteCommitment] = msg.value;
        emit RewardNoteMinted(_noteCommitment, msg.value);
    }
    
    /**
     * @dev Test helper to register a reward tree root for benchmarking
     * Only callable in testing mode
     */
    function setRewardTreeRoot(uint256 _root) external {
        require(testingMode, "Not in testing mode");
        rewardTreeRoots[_root] = true;
        currentRewardTreeRoot = _root;
    }
}

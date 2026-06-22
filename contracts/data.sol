// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// Interface for the IdentityContract
interface IIdentityContract {
    function isRegistered(address _org) external view returns (bool);
    function slashAndReward(address _defendant, address _complainant) external;
    function rewardDefendant(address _defendant, address _complainant) external;
}

/**
 * @title DataContract
 * @dev Manages the CTI sharing (Share Phase) and access (Request-Response Phase).
 * Also handles the democratic dispute resolution process[cite: 298, 482].
 */
contract DataContract {
    IIdentityContract public identityContract;

    // --- Roles & Registration ---
    mapping(address => bool) public isGroupManager;
    address[] public groupManagers;
    uint256 public groupManagerThreshold; // Threshold T for voting [cite: 303, 493]

    // --- CTI Sharing (Share Phase) ---
    struct CtiShare {
        address producer;
        string accessPolicyIpfsCid;   // Off-chain policy [cite: 417]
        string integrityHashesIpfsCid; // Off-chain hashes [cite: 416, 424]
        uint256 royaltyFee;          // Fee R
        uint256 computationCost;     // Fee C [cite: 425]
        address[] initialDelegates;  // List of initial delegates
        mapping(address => uint256) delegateAccessLevel; // Level for each delegate
    }
    mapping(uint256 => CtiShare) public ctiShares;
    uint256 public ctiCounter;

    // --- Access Requests (Request-Response Phase) ---
    enum RequestStatus { Initial, CredentialsProvided, Responded, Disputed }
    struct AccessRequest {
        address consumer;
        uint256 ctiId;
        uint256 accessLevel; // Requested differential sharing level [cite: 430]
        RequestStatus status;
        address allocatedDelegate;
        string credentialsIpfsCid; // Consumer's credentials [cite: 455]
        string responseIpfsCid;    // Delegate's response CTI [cite: 460]
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

    // --- IPFS CID Struct ---
    struct IpfsCid {
        string cid; // The IPFS CID string
    }

    // --- Disputes (Regulation Phase) ---
    struct Dispute {
        address complainant;
        address defendant;
        uint256 accessRequestId;
        DisputeReason reason;       // Dispute reason provided by complainant
        IpfsCid evidence;           // Evidence IPFS CID (e.g., hash mismatch between IPFS data and transferred data)
        bool isOpen;
        mapping(address => bool) hasVoted;
        uint256 votesForGuilty;
        uint256 totalVotes;
    }
    mapping(uint256 => Dispute) public disputes;
    uint256 public disputeCounter;

    // --- Modifiers ---
    modifier onlyRegistered() {
        require(identityContract.isRegistered(msg.sender), "Organisation not registered");
        _;
    }

    modifier onlyManager() {
        require(isGroupManager[msg.sender], "Not a Group Manager");
        _;
    }

    // --- IPFS CID Validation ---
    /**
     * @dev Validates that a string is a legitimate IPFS CID.
     * IPFS CID v0: starts with "Qm" and is 46 characters
     * IPFS CID v1: starts with "b" and follows base32 encoding pattern
     * @param _cid The CID string to validate
     * @return isValid True if the CID appears to be valid
     */
    function isValidIpfsCid(string memory _cid) internal pure returns (bool) {
        bytes memory cidBytes = bytes(_cid);
        uint256 length = cidBytes.length;
        
        // IPFS CID v0: starts with "Qm" and is exactly 46 characters
        if (length == 46 && cidBytes[0] == 'Q' && cidBytes[1] == 'm') {
            // Validate base58 characters (0-9, A-H, J-N, P-Z, a-k, m-z)
            for (uint256 i = 0; i < length; i++) {
                bytes1 char = cidBytes[i];
                if (!((char >= 0x30 && char <= 0x39) || // 0-9
                      (char >= 0x41 && char <= 0x48) || // A-H
                      (char >= 0x4A && char <= 0x4E) || // J-N
                      (char >= 0x50 && char <= 0x5A) || // P-Z
                      (char >= 0x61 && char <= 0x6B) || // a-k
                      (char >= 0x6D && char <= 0x7A))) { // m-z
                    return false;
                }
            }
            return true;
        }
        
        // IPFS CID v1: starts with "b" and has specific format
        // v1 CIDs are typically longer and use base32 encoding
        if (length > 46 && cidBytes[0] == 'b') {
            // Basic validation for v1 CID format
            // v1 CIDs use base32 encoding (a-z, 2-7)
            for (uint256 i = 0; i < length; i++) {
                bytes1 char = cidBytes[i];
                if (!((char >= 0x61 && char <= 0x7A) || // a-z
                      (char >= 0x32 && char <= 0x37))) { // 2-7
                    return false;
                }
            }
            return true;
        }
        
        return false;
    }

    // --- Events ---
    event CtiShared(uint256 indexed ctiId, address indexed producer);
    event RequestCreated(uint256 indexed requestId, address indexed consumer, address indexed allocatedDelegate);
    event CredentialsProvided(uint256 indexed requestId, string credentialsIpfsCid);
    event ResponseProvided(uint256 indexed requestId, string responseIpfsCid);
    event DisputeRaised(uint256 indexed disputeId, address indexed complainant, address indexed defendant);
    event VotedOnDispute(uint256 indexed disputeId, address indexed manager, bool isGuilty);
    event DisputeSettled(uint256 indexed disputeId, bool wasGuilty);


    constructor(address _identityContract, address[] memory _initialManagers, uint256 _threshold) {
        identityContract = IIdentityContract(_identityContract);
        require(_threshold > 0 && _threshold <= _initialManagers.length, "Invalid threshold");
        
        groupManagerThreshold = _threshold;
        for (uint256 i = 0; i < _initialManagers.length; i++) {
            address manager = _initialManagers[i];
            require(manager != address(0), "Invalid manager address");
            require(!isGroupManager[manager], "Duplicate manager");
            isGroupManager[manager] = true;
            groupManagers.push(manager);
        }
    }

    // --- SHARE PHASE [cite: 412] ---

    /**
     * @dev [SHARE PHASE - Step 6] A CTI Producer shares a new CTI.
     * They define fees (R, C), initial delegates, and their access levels [cite: 415-425].
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
            cti.delegateAccessLevel[_initialDelegates[i]] = _delegateLevels[i];
        }

        emit CtiShared(ctiCounter, msg.sender);
    }

    // --- REQUEST-RESPONSE PHASE [cite: 427] ---

    /**
     * @dev [REQUEST PHASE - Step 8 & 9] Consumer requests access to CTI at a specific level.
     * The contract "randomly" allocates a suitable delegate[cite: 431, 452].
     */
    function initialRequest(uint256 _ctiId, uint256 _accessLevel) external onlyRegistered {
        CtiShare storage cti = ctiShares[_ctiId];
        require(cti.producer != address(0), "CTI does not exist");

        // Find available delegates for the requested level
        address[] memory availableDelegates = new address[](cti.initialDelegates.length);
        uint256 count = 0;
        for (uint256 i = 0; i < cti.initialDelegates.length; i++) {
            address delegate = cti.initialDelegates[i];
            // Delegate must have access level >= requested level [cite: 254, 255]
            if (cti.delegateAccessLevel[delegate] >= _accessLevel) {
                availableDelegates[count++] = delegate;
            }
        }
        require(count > 0, "No delegates available for this access level");

        // "Random" allocation [cite: 453]
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
     * and pays the consumption fee (F = 2R + C)[cite: 455, 456].
     */
    function provideCredentials(
        uint256 _requestId,
        string calldata _credentialsIpfsCid
    ) external payable onlyRegistered {
        AccessRequest storage req = accessRequests[_requestId];
        require(req.consumer == msg.sender, "Not your request");
        require(req.status == RequestStatus.Initial, "Invalid request status");

        CtiShare storage cti = ctiShares[req.ctiId];
        uint256 totalFee = (2 * cti.royaltyFee) + cti.computationCost; // F = 2R + C [cite: 273]
        require(msg.value == totalFee, "Incorrect consumption fee");

        req.credentialsIpfsCid = _credentialsIpfsCid;
        req.status = RequestStatus.CredentialsProvided;

        emit CredentialsProvided(_requestId, _credentialsIpfsCid);
    }

    /**
     * @dev [RESPONSE PHASE - Step 12] Delegate provides the CTI response (via IPFS).
     * The contract pays the delegate (R+C) and producer (R)[cite: 267, 460].
     * (Step 11, policy evaluation, happens off-chain) [cite: 458].
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

    // --- REGULATION PHASE [cite: 481] ---

    /**
     * @dev [REGULATION - Step 1] Any registered org can raise a dispute
     * (e.g., Consumer vs. Delegate [cite: 531], Producer vs. Delegate[cite: 480],
     * Consumer vs. Producer [cite: 523]).
     * @param _requestId The access request ID related to the dispute
     * @param _defendant The address of the party being accused
     * @param _reason The reason for the dispute (enum value)
     * @param _evidenceCid IPFS CID of evidence supporting the dispute (e.g., hash mismatch between IPFS data and transferred data)
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
        require(isValidIpfsCid(_evidenceCid), "Invalid IPFS CID format");
        
        req.status = RequestStatus.Disputed;

        disputeCounter++;
        Dispute storage d = disputes[disputeCounter];
        d.complainant = msg.sender;
        d.defendant = _defendant;
        d.accessRequestId = _requestId;
        d.reason = _reason;
        d.evidence = IpfsCid(_evidenceCid);
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
            d.evidence.cid,
            d.isOpen,
            d.votesForGuilty,
            d.totalVotes
        );
    }

    /**
     * @dev [REGULATION - Step 3] A Group Manager votes on an open dispute[cite: 491].
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

        // Check if the vote is decisive
        uint256 notGuiltyVotes = d.totalVotes - d.votesForGuilty;
        
        if (d.votesForGuilty >= groupManagerThreshold) {
            // Outcome A: Guilty. Slash defendant, reward complainant[cite: 493].
            d.isOpen = false;
            identityContract.slashAndReward(d.defendant, d.complainant);
            emit DisputeSettled(_disputeId, true);
        } else if (notGuiltyVotes >= groupManagerThreshold) {
            // Outcome B: Innocent. Slash (false accuser) complainant, reward defendant[cite: 494].
            d.isOpen = false;
            identityContract.rewardDefendant(d.defendant, d.complainant);
            emit DisputeSettled(_disputeId, false);
        }
        // If no threshold is met, the dispute remains open for more votes.
    }
}
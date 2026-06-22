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
}

// Interface for the IdentityContract (non-ZK)
interface IIdentityContract {
    function isRegistered(address _org) external view returns (bool);
    function slashAndReward(address _defendant, address _complainant) external;
    function rewardDefendant(address _defendant, address _complainant) external;
}

/**
 * @title ZKDataContract
 * @dev Manages the CTI sharing (Share Phase) and access (Request-Response Phase) with both ZK and non-ZK support.
 * Also handles the democratic dispute resolution process.
 */
contract ZKDataContract {
    IZKIdentity public zkIdentity;
    IIdentityContract public identityContract;

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
        IpfsCid evidence;           // Evidence IPFS CID
        bool isOpen;
        mapping(address => bool) hasVoted;
        uint256 votesForGuilty;
        uint256 totalVotes;
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

    // --- Modifiers ---
    modifier onlyRegistered() {
        require(identityContract.isRegistered(msg.sender), "Organisation not registered");
        _;
    }

    modifier onlyManager() {
        require(isGroupManager[msg.sender], "Not a Group Manager");
        _;
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

    constructor(
        address _zkIdentity,
        address _identityContract,
        address[] memory _initialManagers,
        uint256 _threshold
    ) {
        zkIdentity = IZKIdentity(_zkIdentity);
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
     * @param input = [root, actionId, nullifierHash]
     * actionId must be the requestId to bind the proof to this task.
     */
    function provideResponseZK(
        uint256 _requestId,
        string calldata _ipfsCid,
        uint256[2] calldata a,
        uint256[2][2] calldata b,
        uint256[2] calldata c,
        uint256[3] calldata input 
    ) external {
        ZKAccessRequest storage req = zkRequests[_requestId];
        require(!req.fulfilled, "Already fulfilled");

        // 1. Validate Input Integrity
        // The actionId in the ZK proof MUST match the requestId
        require(input[1] == _requestId, "Invalid Action ID"); 
        
        // 2. Validate Merkle Root
        require(zkIdentity.roots(input[0]), "Invalid Merkle Root");

        // 3. Verify ZK Proof via Identity Contract
        // "I exist in the tree at Root, and I am performing Action RequestID"
        // Convert uint256 calldata arrays to uint calldata arrays (they're the same type)
        // We need to create memory copies since we can't directly convert calldata types
        uint[2] memory _a = [uint(a[0]), uint(a[1])];
        uint[2][2] memory _b = [[uint(b[0][0]), uint(b[0][1])], [uint(b[1][0]), uint(b[1][1])]];
        uint[2] memory _c = [uint(c[0]), uint(c[1])];
        uint[3] memory _input = [uint(input[0]), uint(input[1]), uint(input[2])];
        require(zkIdentity.verifyProof(_a, _b, _c, _input), "Invalid ZK Proof");

        // 4. Update State
        req.responseIpfsCid = _ipfsCid;
        req.fulfilled = true;
        
        // 5. Payout
        // Transfer rewards to msg.sender (which is a fresh address/relayer, separate from Identity)
        // This breaks the link between Identity (Deposit) and Payout (Wallet).
        payable(msg.sender).transfer(address(this).balance); // Simplified fee logic

        emit ZKResponseProvided(_requestId);
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

        // Check if the vote is decisive
        uint256 notGuiltyVotes = d.totalVotes - d.votesForGuilty;
        
        if (d.votesForGuilty >= groupManagerThreshold) {
            // Outcome A: Guilty. Slash defendant, reward complainant.
            d.isOpen = false;
            identityContract.slashAndReward(d.defendant, d.complainant);
            emit DisputeSettled(_disputeId, true);
        } else if (notGuiltyVotes >= groupManagerThreshold) {
            // Outcome B: Innocent. Slash (false accuser) complainant, reward defendant.
            d.isOpen = false;
            identityContract.rewardDefendant(d.defendant, d.complainant);
            emit DisputeSettled(_disputeId, false);
        }
        // If no threshold is met, the dispute remains open for more votes.
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
     * @param a, b, c ZK proof parameters
     * @param input Public signals: [root, actionId, nullifierHash]
     *              actionId = keccak256(abi.encodePacked(_requestId, uint256(_reason), "DISPUTE"))
     */
    function raiseDisputeZK(
        uint256 _requestId,
        address _defendant,
        DisputeReason _reason,
        string calldata _evidenceCid,
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
        require(isValidIpfsCid(_evidenceCid), "Invalid IPFS CID format");

        // 1. Validate actionId binds proof to this specific dispute
        bytes32 expectedActionId = keccak256(abi.encodePacked(_requestId, uint256(_reason), "DISPUTE"));
        require(input[1] == uint256(expectedActionId), "Invalid Action ID");
        
        // 2. Validate Merkle Root
        require(zkIdentity.roots(input[0]), "Invalid Merkle Root");

        // 3. Verify ZK Proof
        uint[2] memory _a = [uint(a[0]), uint(a[1])];
        uint[2][2] memory _b = [[uint(b[0][0]), uint(b[0][1])], [uint(b[1][0]), uint(b[1][1])]];
        uint[2] memory _c = [uint(c[0]), uint(c[1])];
        uint[3] memory _input = [uint(input[0]), uint(input[1]), uint(input[2])];
        require(zkIdentity.verifyProof(_a, _b, _c, _input), "Invalid ZK Proof");

        // 4. Check nullifier to prevent replay
        bytes32 nullifierHash = bytes32(input[2]);
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
        d.evidence = IpfsCid(_evidenceCid);
        d.isOpen = true;

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
        bytes32 expectedActionId = keccak256(abi.encodePacked(_disputeId, _isGuilty ? uint256(1) : uint256(0), "VOTE"));
        require(input[1] == uint256(expectedActionId), "Invalid Action ID");
        
        // 2. Validate Merkle Root
        require(zkIdentity.roots(input[0]), "Invalid Merkle Root");

        // 3. Verify ZK Proof
        uint[2] memory _a = [uint(a[0]), uint(a[1])];
        uint[2][2] memory _b = [[uint(b[0][0]), uint(b[0][1])], [uint(b[1][0]), uint(b[1][1])]];
        uint[2] memory _c = [uint(c[0]), uint(c[1])];
        uint[3] memory _input = [uint(input[0]), uint(input[1]), uint(input[2])];
        require(zkIdentity.verifyProof(_a, _b, _c, _input), "Invalid ZK Proof");

        // 4. Check nullifier to prevent double voting
        bytes32 nullifierHash = bytes32(input[2]);
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

        // Check if the vote is decisive
        uint256 notGuiltyVotes = d.totalVotes - d.votesForGuilty;
        
        if (d.votesForGuilty >= groupManagerThreshold) {
            // Outcome A: Guilty. Slash defendant, reward complainant.
            d.isOpen = false;
            identityContract.slashAndReward(d.defendant, d.complainant);
            emit DisputeSettled(_disputeId, true);
        } else if (notGuiltyVotes >= groupManagerThreshold) {
            // Outcome B: Innocent. Slash (false accuser) complainant, reward defendant.
            d.isOpen = false;
            identityContract.rewardDefendant(d.defendant, d.complainant);
            emit DisputeSettled(_disputeId, false);
        }
        // If no threshold is met, the dispute remains open for more votes.
    }
}
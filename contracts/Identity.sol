// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./IdentityTree.sol";

/**
 * @title IdentityContract
 * @dev Manages organisation identities, registration, and security deposits (D).
 * This contract acts as the "bank" and registry, holding deposits in escrow.
 * It executes fund transfers (slashing/rewards) when called by the DataContract
 * after a dispute is democratically settled.
 */
contract IdentityContract {
    address public owner;
    address public dataContractAddress;
    IdentityTree public identityTree;

    uint256 public constant REGISTRATION_DEPOSIT = 1 ether;

    struct Organisation {
        bool isRegistered;
        uint256 deposit;
        string identityInfoIpfsCid;
    }

    mapping(address => Organisation) public organisations;

    event OrganisationRegistered(address indexed orgAddress, uint256 deposit);
    event DepositSlashed(address indexed defendant, address indexed complainant, uint256 amount);
    event DepositRewarded(address indexed defendant, address indexed complainant, uint256 amount);

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner can call this");
        _;
    }

    modifier onlyDataContract() {
        require(msg.sender == dataContractAddress, "Only DataContract can call this");
        _;
    }

    constructor() payable {
        owner = msg.sender;
        identityTree = new IdentityTree();
    }

    function setDataContract(address _dataContractAddress) external onlyOwner {
        dataContractAddress = _dataContractAddress;
    }

    function registerOrganisation(string calldata _identityInfoIpfsCid) external payable {
        require(!organisations[msg.sender].isRegistered, "Organisation already registered");
        require(msg.value == REGISTRATION_DEPOSIT, "Incorrect registration deposit");

        organisations[msg.sender] = Organisation(
            true,
            msg.value,
            _identityInfoIpfsCid
        );

        // Insert into IdentityTree using address as leaf (Poseidon-compatible)
        // For non-ZK, we use the address directly as the leaf
        identityTree.insert(uint256(uint160(msg.sender)));

        emit OrganisationRegistered(msg.sender, msg.value);
    }

    function slashAndReward(address _defendant, address _complainant) external onlyDataContract {
        Organisation storage defendantOrg = organisations[_defendant];
        uint256 deposit = defendantOrg.deposit;

        require(deposit > 0, "Defendant has no deposit to slash");

        defendantOrg.deposit = 0;
        defendantOrg.isRegistered = false;

        (bool sent, ) = _complainant.call{value: deposit}("");
        require(sent, "Failed to send deposit to complainant");

        emit DepositSlashed(_defendant, _complainant, deposit);
    }

    function rewardDefendant(address _defendant, address _complainant) external onlyDataContract {
        Organisation storage complainantOrg = organisations[_complainant];
        uint256 deposit = complainantOrg.deposit;

        require(deposit > 0, "Complainant has no deposit to slash");

        complainantOrg.deposit = 0;
        complainantOrg.isRegistered = false;

        (bool sent, ) = _defendant.call{value: deposit}("");
        require(sent, "Failed to send deposit to defendant");

        emit DepositRewarded(_defendant, _complainant, deposit);
    }

    function isRegistered(address _org) external view returns (bool) {
        return organisations[_org].isRegistered;
    }
}

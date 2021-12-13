// SPDX-License-Identifier: GPL-2.0-or-later
// Gearbox. Generalized leverage protocol that allows to take leverage and then use it across other DeFi protocols and platforms in a composable way.
// (c) Gearbox.fi, 2021
pragma solidity ^0.7.4;
pragma abicoder v2;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/EnumerableSet.sol";

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {SafeMath} from "@openzeppelin/contracts/math/SafeMath.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";

import {PercentageMath} from "../libraries/math/PercentageMath.sol";
import {Errors} from "../libraries/helpers/Errors.sol";

import {AddressProvider} from "../core/AddressProvider.sol";
import {ACLTrait} from "../core/ACLTrait.sol";
import {AccountMining} from "../core/AccountMining.sol";
import {GearToken} from "../tokens/GearToken.sol";
import {IGearToken} from "../interfaces/IGearToken.sol";
import {StepVesting} from "../tokens/Vesting.sol";
import {Constants} from "../libraries/helpers/Constants.sol";
import {Errors} from "../libraries/helpers/Errors.sol";



contract TokenDistributor is ACLTrait {
    using SafeMath for uint256;
    using EnumerableSet for EnumerableSet.AddressSet;

    enum VotingPower {
        A, // A-type voting power & A-type vesting parameters
        B, // B-type voting power & B-type vesting parameters
        ZERO_VOTING_POWER // zero voting power & B-type vesting parameters
    }

    struct TokenShare {
        address holder; // address of contributor wallet,
        uint256 amount; // amount in tokens which should be transferred to contributor
        bool isCompany; // flag, which used for contributor B only, If set, the voting contract has zero voting power.
    }

    struct VestingContract {
        address contractAddress; // vesting contract address
        VotingPower votingPower; // enum for voting power(0 means "A", 1 means "B" and 2 means "ZERO VOTING")
    }

    address treasury; // treasury wallet address

    struct TokenDistributionOpts {
        TokenShare[] contributorsA;
        TokenShare[] contributorsB;
        uint256 treasuryAmount; // amount of tokens which should be transferred to Treasury wallet
        address accountMiner;
        uint256 accountsToBeMined; // Quantity of accounts to be mined
        address testersAirdrop;
        uint256 airdropAmount;
    }

    // Steps for StepVestring contract
    uint256 public constant steps = 10_000;

    // GEAR token
    GearToken public gearToken;

    // Address of master contract which will be cloned
    address public masterVestingContract;

    // Mapping contributor => vesting contracts
    mapping(address => VestingContract) public vestingContracts;

    // Contributors set
    EnumerableSet.AddressSet private contributorsSet;

    // Voting weights
    uint256 public weightA;
    uint256 public weightB;

    // Default voting weights
    uint256 public constant defaultWeightA = 25_00;
    uint256 public constant defaultWeightB = 12_50;

    // emits each time when voting power weights were updated
    event NewWeights(uint256 weightA, uint256 weightB);

    // emits each time when new vesting contract is deployed
    event NewVestingContract(
        address indexed holder,
        address indexed vestingContract,
        VotingPower votingPower
    );

    event VestingContractHolderUpdate(
        address indexed vestingContract,
        address indexed prevHolder,
        address indexed newHolder
    );

    /// @param addressProvider address of Address provider
    constructor(AddressProvider addressProvider)
        ACLTrait(address(addressProvider))
    {
        gearToken = GearToken(addressProvider.getGearToken()); // T:[TD-1]
        treasury = addressProvider.getTreasuryContract();
        _updateVotingWeights(defaultWeightA, defaultWeightB); // T:[TD-1]
    }

    /// @dev Deploys vesting contracts and distributes tokens
    /// @param opts - struct which describes token distribution
    function distributeTokens(TokenDistributionOpts calldata opts)
        external
        configuratorOnly // T:[TD-2]
    {
        for (uint256 i = 0; i < opts.contributorsA.length; i++) {
            _deployVestingContract(opts.contributorsA[i], VotingPower.A); // T:[TD-3]
        }

        for (uint256 i = 0; i < opts.contributorsB.length; i++) {
            _deployVestingContract(
                opts.contributorsB[i],
                opts.contributorsB[i].isCompany
                    ? VotingPower.ZERO_VOTING_POWER
                    : VotingPower.B
            ); // T:[TD-3]
        }

        AccountMining am = AccountMining(opts.accountMiner);
        //        accountMining = new AccountMining(
        //            address(gearToken),
        //            opts.merkleRoot,
        //            opts.rewardPerMinedAccount,
        //            addressProvider
        //        ); // T:[GD-1,2]

        gearToken.transfer(treasury, opts.treasuryAmount); // T:[GD-1]
        gearToken.transfer(opts.testersAirdrop, opts.airdropAmount); // T:[GD-1]
        gearToken.transfer(
            opts.accountMiner,
            am.amount() * opts.accountsToBeMined
        ); // T:[GD-1]

        require(
            gearToken.balanceOf(address(this)) == 0,
            Errors.TD_NON_ZERO_BALANCE_AFTER_DISTRIBUTION
        ); // T:[TD-3, 4]
    }

    /// @dev Returns token balance aligned with voting power based on contributor type. It's used for snapshot voting.
    function balanceOf(address holder) external view returns (uint256) {
        uint256 vestingBalanceWeighted; // T:[TD-6]

        VestingContract memory vc = vestingContracts[holder]; // T:[TD-62]
        if (
            vc.contractAddress != address(0) &&
            vc.votingPower != VotingPower.ZERO_VOTING_POWER
        ) {
            address receiver = StepVesting(vc.contractAddress).receiver(); // T:[TD-6]

            if (receiver == holder) {
                vestingBalanceWeighted = gearToken
                .balanceOf(vc.contractAddress)
                .mul(vc.votingPower == VotingPower.A ? weightA : weightB)
                .div(PercentageMath.PERCENTAGE_FACTOR); // T:[TD-6]
            }
        }

        return vestingBalanceWeighted.add(gearToken.balanceOf(holder)); // T:[TD-6]
    }

    function updateContributors() external {
        // Initially we copy contributors set into array, cause it would be changed during the cycle
        address[] memory contributorsArray = new address[](
            contributorsSet.length()
        ); // T:[TD-11]
        for (uint256 i = 0; i < contributorsArray.length; i++) {
            contributorsArray[i] = contributorsSet.at(i); // T:[TD-11]
        }

        for (uint256 i = 0; i < contributorsArray.length; i++) {
            updateVestingHolder(contributorsArray[i]); // T:[TD-11]
        }
    }

    /// @dev Updates vestingContracts map, if receiver was changed in StepVesting contract
    /// @notice balanceOf method would return 0, if receiver was changed and vestingContracts map wasn't updated yet.
    /// use this method to update it, to transfer voting power and make it possible to vote using your vesting contract.
    /// @param prevOwner Previously registered owner
    function updateVestingHolder(address prevOwner) public {
        require(
            contributorsSet.contains(prevOwner),
            Errors.TD_CONTRIBUTOR_IS_NOT_REGISTERED
        ); // T:[TD-9]
        VestingContract memory vc = vestingContracts[prevOwner]; // T:[TD-8, 10, 11]

        address currentOwner = StepVesting(vc.contractAddress).receiver(); // T:[TD-8, 10, 11]

        if (prevOwner != currentOwner) // T:[TD-10]
        {
            require(
                vestingContracts[currentOwner].contractAddress == address(0),
                Errors.TD_WALLET_IS_ALREADY_CONNECTED_TO_VC
            ); // T:[TD-8, 10, 11, 14]

            delete vestingContracts[prevOwner]; // T:[TD-8, 10, 11]
            contributorsSet.remove(prevOwner); // T:[TD-8, 10, 11]

            vestingContracts[currentOwner] = vc; // T:[TD-8, 10, 11]
            contributorsSet.add(currentOwner); // T:[TD-8, 10, 11]

            emit VestingContractHolderUpdate(
                vc.contractAddress,
                prevOwner,
                currentOwner
            ); // T:[TD-8, 10, 11]
        }
    }

    /// @dev Updates voting power for contributor types
    /// @param _weightA - weight for contributors type A in PERCENTAGE format (1 = 10_000)
    /// @param _weightB - weight for contributors type B in PERCENTAGE format (1 = 10_000)
    /// @notice _weightA should be always gte than _weightB and all of them less than 10_000
    function updateVotingWeights(uint256 _weightA, uint256 _weightB)
        external
        configuratorOnly // T:[TD-2]
    {
        _updateVotingWeights(_weightA, _weightB); // T:[TD-12]
    }

    //
    // GETTERS
    //

    /// @return Count of contributors
    function countContributors() external view returns (uint256) {
        return contributorsSet.length(); // T:[TD-3]
    }

    /// @return List of holders
    function contributorsList() external view returns (address[] memory) {
        address[] memory result = new address[](contributorsSet.length()); // T:[TD-3]

        for (uint256 i = 0; i < contributorsSet.length(); i++) {
            result[i] = contributorsSet.at(i); // T:[TD-3]
        }

        return result; // T:[TD-3]
    }

    /// @return List of addresses of vesting contracts
    function vestingContractsList() external view returns (address[] memory) {
        address[] memory result = new address[](contributorsSet.length()); // T:[TD-3]

        for (uint256 i = 0; i < contributorsSet.length(); i++) {
            result[i] = vestingContracts[contributorsSet.at(i)].contractAddress; // T:[TD-3]
        }

        return result; // T:[TD-3]
    }

    //
    // INTERNAL FUNCTIONS
    //

    /// @dev Deploys (clone) new vesting contract
    /// @param tokenShare token holder and amount to be distributed
    /// @param contributorType contributor voting power (vesting parameters depends on it also)
    function _deployVestingContract(
        TokenShare memory tokenShare,
        VotingPower contributorType
    ) internal {
        require(
            !contributorsSet.contains(tokenShare.holder),
            Errors.TD_WALLET_IS_ALREADY_CONNECTED_TO_VC
        ); // T:[TD-5]

        if (masterVestingContract == address(0)) {
            masterVestingContract = address(new StepVesting());
        }

        address vc = contributorsSet.length() == 0
            ? masterVestingContract
            : Clones.clone(address(masterVestingContract)); // T:[TD-3]

        StepVesting(vc).initialize(
            IGearToken(address(gearToken)),
            block.timestamp,
            Constants.SECONDS_PER_YEAR,
            (
                contributorType == VotingPower.A
                    ? Constants.SECONDS_PER_YEAR
                    : Constants.SECONDS_PER_ONE_AND_HALF_YEAR
            ) / steps,
            0,
            tokenShare.amount / steps,
            steps,
            tokenShare.holder
        ); // T:[TD-3]

        contributorsSet.add(tokenShare.holder); // T:[TD-3]

        vestingContracts[tokenShare.holder] = VestingContract(
            vc,
            contributorType
        ); // T:[TD-3]

        gearToken.transfer(vc, tokenShare.amount); // T:[TD-3]
        emit NewVestingContract(tokenShare.holder, vc, contributorType); // T:[TD-3]
    }

    function _updateVotingWeights(uint256 _weightA, uint256 _weightB) internal {
        require(
            _weightA <= PercentageMath.PERCENTAGE_FACTOR &&
                _weightB <= _weightA,
            Errors.TD_INCORRECT_WEIGHTS
        ); // T:[TD-12, 13]
        weightA = _weightA; // T:[TD-12]
        weightB = _weightB; // T:[TD-12]
        emit NewWeights(weightA, weightB); // T:[TD-12]
    }
}

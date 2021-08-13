// SPDX-License-Identifier: BSL-1.1
// Gearbox. Generalized protocol that allows to get leverage and use it across various DeFi protocols
// (c) Gearbox.fi, 2021
pragma solidity ^0.7.4;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import {SafeMath} from "@openzeppelin/contracts/math/SafeMath.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {ACLTrait} from "../configuration/ACLTrait.sol";

import {IAccountMiner} from "../interfaces/IAccountMiner.sol";
import {AddressProvider} from "../configuration/AddressProvider.sol";
import {AbstractAccountMiner} from "./AbstractAccountMiner.sol";
import {GearToken} from "../tokens/GearToken.sol";

import {Constants} from "../libraries/helpers/Constants.sol";
import {Errors} from "../libraries/helpers/Errors.sol";
import "hardhat/console.sol";

/// @title Auction account miner
/// @notice This contract organizes credit account mining auction. Each time, when new credit account
/// needed the contract takes the biggest bid, moves it into treasury and mints GEAR tokens
/// to bid's owner as reward. It also pays gas compensation for user who invokes credit account creation.
contract AccountMinerAuction is
    IAccountMiner,
    AbstractAccountMiner,
    ACLTrait,
    ReentrancyGuard
{
    using SafeMath for uint256;
    using Address for address payable;
    using SafeERC20 for IERC20;

    // Account miner kind
    bytes32 public constant override kind = "auction"; // T:[AMA-23]

    // Address of treasury token
    address payable private immutable _treasuryContract;

    // Gear token address
    address private immutable _gearToken;

    struct DonationBid {
        address prevBid;
        address nextBid;
        uint256 amount;
    }

    // Maps users => bids
    mapping(address => DonationBid) _bidsLinkedList;

    // List tail
    address public tail;

    // Emits each time when bid places
    event BidPlaced(address indexed sponsor, uint256 amount);

    // Emits each time when bid increased
    event BidIncreased(address indexed sponsor, uint256 amount);

    // Emits each time when bid taken
    event BidTaken(address indexed sponsor, uint256 amount);

    // Emits each time when account mined
    event AccountMined(address indexed sponsor);

    /// @dev Reverts if sponsor has no bids
    modifier sponsorHasBid() {
        require(
            _bidsLinkedList[msg.sender].amount > 0,
            Errors.AM_USER_HAS_NO_BIDS
        );
        _;
    }

    constructor(address addressProvider)
        AbstractAccountMiner(addressProvider)
        ACLTrait(addressProvider)
    {
        _treasuryContract = payable(
            AddressProvider(addressProvider).getTreasuryContract()
        );

        _gearToken = AddressProvider(addressProvider).getGearToken();
    }

    /**
     * "Mines" credit account:
     * - choose sponsor with the max bet
     * - pays gas compensation for msg.sender
     * - send remaining funds to treasury contract
     * @param user Address of user who opens new credit account and has to deploy new VA contract
     */
    function mineAccount(address payable user)
        external
        override
        accountFactoryOnly // T:[AMA-13]
    {
        require(tail != address(0), Errors.AM_NO_BIDS_WERE_MADE); // T:[AMA-14]
        emit AccountMined(tail); // T:[AMA-15]

        IERC20(_gearToken).safeTransfer(
            tail,
            Constants.ACCOUNT_CREATION_REWARD
        ); //T:[AMA-16]

        uint256 amountToDAO = _bidsLinkedList[tail].amount.sub(
            Constants.DEPLOYMENT_COST
        ); // T:[AMA-18]

        _removeBid(tail);
        _treasuryContract.sendValue(amountToDAO); // T:[AMA-18]
        _payGasCompensation(user); // T:[AMA-17, 19]
    }

    /// @dev  Places bid to the auction:
    ///   - checks that bid is bigger than max
    ///   - checks that sponsor has only one bid
    ///   - place a bid
    function placeBid()
        external
        payable
        whenNotPaused // T:[AMA-21]
        nonReentrant
    {
        _revertIfBidLessAllowed(msg.value); // T:[AMA-1]
        require(
            _bidsLinkedList[msg.sender].amount == 0,
            Errors.AM_USER_ALREADY_HAS_BID
        ); // T:[AMA-2]

        _bidsLinkedList[msg.sender] = DonationBid({
            prevBid: address(0),
            amount: msg.value,
            nextBid: address(0)
        }); // T:[AMA-3, 4]

        _addBid(msg.value); // T:[AMA-3, 4]

        emit BidPlaced(msg.sender, msg.value); // T:[AMA-3]
    }

    /// @dev Increases donation bid
    function increaseBid()
        external
        payable
        sponsorHasBid // T:[AMA-5]
        whenNotPaused // T:[AMA-21]
        nonReentrant
    {
        uint256 newBidAmount = _bidsLinkedList[msg.sender].amount.add(
            msg.value
        ); // T:[AMA-7, 8]

        _revertIfBidLessAllowed(newBidAmount); // T:[AMA-6]
        _removeBid(msg.sender); // T:[AMA-7, 8]
        _addBid(newBidAmount); // T:[AMA-7, 8]
        emit BidIncreased(msg.sender, msg.value); // T:[AMA-7]
    }

    /// @dev Returns the bid to sponsor
    function takeBid()
        external
        sponsorHasBid // T:[AMA-9]
        whenNotPaused // T:[AMA-21]
        nonReentrant
    {
        // keeps amount to send
        uint256 amount = _bidsLinkedList[msg.sender].amount; // T:[AMA-11]

        // removes bid
        _removeBid(msg.sender); // T:[AMA-11]

        // emits event
        emit BidTaken(msg.sender, amount); // T:[AMA-11]

        // safely send value
        payable(msg.sender).sendValue(amount); // T:[AMA-12]
    }

    // @dev Adds bid to list
    function _addBid(uint256 amount) internal {
        // Check that bid is not the last, to exclude list cycle
        if (tail != address(0)) {
            _bidsLinkedList[tail].nextBid = msg.sender;
        } // T:[AMA-3]

        _bidsLinkedList[msg.sender].prevBid = tail; // T:[AMA-3, 4]
        tail = msg.sender; // T:[AMA-3, 4]

        _bidsLinkedList[tail].amount = amount; // T:[AMA-3, 4]
    }

    /// @dev Removes item from linked list
    function _removeBid(address sponsor) internal {
        address prevItem = _bidsLinkedList[sponsor].prevBid; // T:[AMA-11]
        address nextItem = _bidsLinkedList[sponsor].nextBid; // T:[AMA-11]
        if (prevItem != address(0)) {
            _bidsLinkedList[prevItem].nextBid = nextItem; // T:[AMA-11]
        }

        if (nextItem != address(0)) {
            _bidsLinkedList[nextItem].prevBid = prevItem; // T:[AMA-11]
        }

        if (tail == sponsor) {
            tail = prevItem; // T:[AMA-11]
        }

        delete _bidsLinkedList[sponsor]; // T:[AMA-11]
    }

    /// @dev Checks that amount >= current max bid
    function _revertIfBidLessAllowed(uint256 amount) internal view {
        uint256 minimalBid = tail == address(0)
            ? Constants.DEPLOYMENT_COST
            : _bidsLinkedList[tail].amount;

        require(amount >= minimalBid, Errors.AM_BID_LOWER_THAN_MINIMAL); // T:[AMA-1]
    }

    /// @dev Gets a bid which was donated to the protocol
    /// @param sponsor A person who donates to protocol
    /// @return prevBid Address of previous Bid/Sponsor
    /// @return amount Bid size
    /// @return nextBid Address of next Bid/Sponsor
    function getBid(address sponsor)
        external
        view
        returns (
            address prevBid,
            uint256 amount,
            address nextBid
        )
    {
        prevBid = _bidsLinkedList[sponsor].prevBid;
        amount = _bidsLinkedList[sponsor].amount;
        nextBid = _bidsLinkedList[sponsor].nextBid;
    }

    /// @dev Returns count of existing bids
    function getBidsCount() external view returns (uint256 count) {
        if (tail == address(0)) {
            return 0;
        }   // T:[AMA-20]
        address pointer = tail; // T:[AMA-20]
        count = 1; // T:[AMA-20]
        while (_bidsLinkedList[pointer].prevBid != address(0)) {
            pointer = _bidsLinkedList[pointer].prevBid;
            count++;
        } // T:[AMA-20]
    }
}

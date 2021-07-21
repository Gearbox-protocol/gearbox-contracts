// SPDX-License-Identifier: BUSL-1.1
// Gearbox. Generalized protocol that allows to get leverage and use it across various DeFi protocols
// (c) Gearbox.fi, 2021
pragma solidity ^0.7.4;
import {SafeMath} from "@openzeppelin/contracts/math/SafeMath.sol";

import {IAccountFactory} from "../interfaces/IAccountFactory.sol";
import {IAccountMiner} from "../interfaces/IAccountMiner.sol";
import {ICreditAccount} from "../interfaces/ICreditAccount.sol";

import {AddressProvider} from "../configuration/AddressProvider.sol";
import {ContractsRegister} from "../configuration/ContractsRegister.sol";
import {CreditAccount} from "../credit/CreditAccount.sol";
import {ACLTrait} from "../configuration/ACLTrait.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {Errors} from "../libraries/helpers/Errors.sol";

import "hardhat/console.sol";

/// @title Abstract reusable credit accounts factory
/// @notice Creates, holds & lend credit accounts to pool contract
contract AccountFactory is IAccountFactory, ACLTrait, ReentrancyGuard {
    //
    //     head
    //      ⬇
    //    -------       -------        -------        -------
    //   |  VA1  | ->  |  VA2  |  ->  |  VA3  |  ->  |  VA4  |  ->  address(0)
    //    -------       -------        -------        -------
    //                                                   ⬆
    //                                                  tail
    //

    // Credit accounts connected list
    mapping(address => address) private _nextCreditAccount;

    // Head on connected list
    address public override head;

    // Tail of connected list
    address public override tail;

    // Credit accounts list
    address[] public override creditAccounts;

    AddressProvider private _addressProvider;
    IAccountMiner public accountMiner;
    ContractsRegister private _contractsRegister;

    modifier creditManagerOnly() {
        require(
            _contractsRegister.isCreditManager(msg.sender),
            Errors.CR_ALLOWED_FOR_VIRTUAL_ACCOUNT_MANAGERS_ONLY
        );
        _;
    }

    /**
     * @dev constructor
     * After constructor the list should be as following
     *
     *     head
     *      ⬇
     *    -------
     *   |  VA1  | ->   address(0)
     *    -------
     *      ⬆
     *     tail
     *
     * @param addressProvider Address of address repository
     */
    constructor(address addressProvider) ACLTrait(addressProvider) {
        _addressProvider = AddressProvider(addressProvider);
        _contractsRegister = ContractsRegister(
            _addressProvider.getContractsRegister()
        );

        addCreditAccount(); // T:[AAF-1]
        head = tail; // T:[AAF-1]
    }

    /// @dev Connects miner to account manager. Account miner address is taken from address provider
    /// Miner will be changed after initial account creation to simple one to use less gas
    function connectMiner()
        external
        override
        configuratorOnly // T:[TAF-1]
    {
        address newMiner = _addressProvider.getAccountMiner(); // T:[AAF-6]
        accountMiner = IAccountMiner(newMiner); // T:[AAF-6]
        emit AccountMinerChanged(newMiner); // T:[AAF-6]
    }

    /**
     * @dev Provides a new credit account to the pool. Creates a new one, if needed
     *
     *   Before:
     *  ---------
     *
     *     head
     *      ⬇
     *    -------       -------        -------        -------
     *   |  VA1  | ->  |  VA2  |  ->  |  VA3  |  ->  |  VA4  |  ->  address(0)
     *    -------       -------        -------        -------
     *                                                   ⬆
     *                                                  tail
     *
     *   After:
     *  ---------
     *
     *    head
     *     ⬇
     *   -------        -------        -------
     *  |  VA2  |  ->  |  VA3  |  ->  |  VA4  |  ->  address(0)
     *   -------        -------        -------
     *                                    ⬆
     *                                   tail
     *
     *
     *   -------
     *  |  VA1  |  ->  address(0)
     *   -------
     *
     *  If had points the last credit account, it adds a new one
     *
     *    head
     *     ⬇
     *   -------
     *  |  VA2  |  ->   address(0)     =>    _addNewCreditAccount()
     *   -------
     *     ⬆
     *    tail
     *
     * @param borrower Borrower's address. Used for gas compensation in terms of borrower account creation
     * @return Address of credit account
     */
    function takeCreditAccount(address payable borrower)
        external
        override
        creditManagerOnly // T:[TAF-2]
        returns (address)
    {
        // Create a new credit account if no one in stock
        _checkStock(borrower); // T:[AAF-3]

        address result = head;
        head = _nextCreditAccount[head]; // T:[AAF-2]
        _nextCreditAccount[result] = address(0); // T:[AAF-2]

        // Initalize creditManager
        ICreditAccount(result).initialize(msg.sender); // T:[AAF-11]

        emit InitializeCreditAccount(result, msg.sender); // T:[AAF-5]
        return result;
    }

    /**
     * @dev Takes credit account back and adds it to the stock
     *
     *   Before:
     *  ---------
     *
     *     head
     *      ⬇
     *    -------       -------        -------        -------
     *   |  VA1  | ->  |  VA2  |  ->  |  VA3  |  ->  |  VA4  |  ->  address(0)
     *    -------       -------        -------        -------
     *                                                   ⬆
     *                                                  tail
     *
     *   After:
     *  ---------
     *
     *     head
     *      ⬇
     *    -------       -------        -------        -------       ---------------
     *   |  VA1  | ->  |  VA2  |  ->  |  VA3  |  ->  |  VA4  |  -> |  usedAccount  |  ->  address(0)
     *    -------       -------        -------        -------       ---------------
     *                                                                     ⬆
     *                                                                    tail
     *
     *
     * @param usedAccount Address of used credit account
     */
    function returnCreditAccount(address usedAccount)
        external
        override
        creditManagerOnly // T:[TAF-2]
    {
        require(
            ICreditAccount(usedAccount).since() != block.number,
            Errors.AF_CANT_CLOSE_CREDIT_ACCOUNT_IN_THE_SAME_BLOCK
        ); // ToDo: Check!

        _nextCreditAccount[tail] = usedAccount; // T:[AAF-7]
        tail = usedAccount; // T:[AAF-7]
        emit ReturnCreditAccount(usedAccount); // T:[AAF-8]
    }

    /// @dev Gets next available credit account or address(0) if you are in tail
    function getNext(address creditAccount)
        external
        view
        override
        returns (address)
    {
        return _nextCreditAccount[creditAccount];
    }

    /**
     * @dev Deploys new credit account and adds it to list tail
     *
     *   Before:
     *  ---------
     *
     *     head
     *      ⬇
     *    -------       -------        -------        -------
     *   |  VA1  | ->  |  VA2  |  ->  |  VA3  |  ->  |  VA4  |  ->  address(0)
     *    -------       -------        -------        -------
     *                                                   ⬆
     *                                                  tail
     *
     *   After:
     *  ---------
     *
     *     head
     *      ⬇
     *    -------       -------        -------        -------       --------------
     *   |  VA1  | ->  |  VA2  |  ->  |  VA3  |  ->  |  VA4  |  -> |  newAccount  |  ->  address(0)
     *    -------       -------        -------        -------       --------------
     *                                                                    ⬆
     *                                                                   tail
     *
     *
     */
    function addCreditAccount() public nonReentrant {
        address newCreditAccountAddress = address(new CreditAccount()); // T:[AAF-2]
        _nextCreditAccount[tail] = newCreditAccountAddress; // T:[AAF-2]
        tail = newCreditAccountAddress; // T:[AAF-2]
        creditAccounts.push(newCreditAccountAddress); // T:[AAF-10]
        emit NewCreditAccount(newCreditAccountAddress);
    }

    /**
     * @dev Deploys new credit account if no one available in stock and call miner contract
     * for gas price compensation & mining reward
     *
     *   If:
     *  ---------
     *
     *     head
     *      ⬇
     *    -------
     *   |  VA1  | ->   address(0)
     *    -------
     *      ⬆
     *     tail
     *
     *   Then:
     *  ---------
     *
     *     head
     *      ⬇
     *    -------       --------------
     *   |  VA1  | ->  |  newAccount  |  ->  address(0)
     *    -------       --------------
     *                       ⬆
     *                      tail
     *
     * @param user Address of msg.sender who invokes transaction for paying gas compensation
     */
    function _checkStock(address payable user) internal {
        // T:[AAF-9]
        if (_nextCreditAccount[head] == address(0)) {
            accountMiner.mineAccount(user); // T:[AAF-4]
            addCreditAccount(); // T:[AAF-3]
        }
    }

    /// @dev Counts how many credit accounts are in stock
    function countCreditAccountsInStock()
        public
        view
        override
        returns (uint256)
    {
        uint256 count = 0;
        address pointer = head;
        while (pointer != address(0)) {
            pointer = _nextCreditAccount[pointer];
            count++;
        }
        return count;
    }

    /// @dev Count of deployed credit accounts
    function countCreditAccounts() external view override returns (uint256) {
        return creditAccounts.length; // T:[AAF-10]
    }
}

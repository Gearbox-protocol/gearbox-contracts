// SPDX-License-Identifier: BUSL-1.1
// Gearbox. Generalized leverage protocol that allows to take leverage and then use it across other DeFi protocols and platforms in a composable way.
// (c) Gearbox.fi, 2021
pragma solidity ^0.7.4;
pragma abicoder v2;

import {EnumerableSet} from "@openzeppelin/contracts/utils/EnumerableSet.sol";
import {SafeMath} from "@openzeppelin/contracts/math/SafeMath.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";

import {IAccountFactory} from "../interfaces/IAccountFactory.sol";
import {IAccountMiner} from "../interfaces/IAccountMiner.sol";
import {ICreditAccount} from "../interfaces/ICreditAccount.sol";
import {ICreditManager} from "../interfaces/ICreditManager.sol";

import {AddressProvider} from "./AddressProvider.sol";
import {ContractsRegister} from "./ContractsRegister.sol";
import {CreditAccount} from "../credit/CreditAccount.sol";
import {ACLTrait} from "./ACLTrait.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {DataTypes} from "../libraries/data/Types.sol";
import {Errors} from "../libraries/helpers/Errors.sol";

import "hardhat/console.sol";

/// @title Abstract reusable credit accounts factory
/// @notice Creates, holds & lend credit accounts to pool contract
contract AccountFactory is IAccountFactory, ACLTrait, ReentrancyGuard {
    using EnumerableSet for EnumerableSet.AddressSet;

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

    // Address of master credit account for cloning
    address public masterCreditAccount;

    // Credit accounts list
    EnumerableSet.AddressSet private creditAccountsSet;

    // List of approvals which is needed during account mining campaign
    DataTypes.MiningApproval[] public miningApprovals;

    // Contracts register
    ContractsRegister public _contractsRegister;

    // Flag that there is no mining yet
    bool public isMiningFinished;

    modifier creditManagerOnly() {
        require(
            _contractsRegister.isCreditManager(msg.sender),
            Errors.REGISTERED_CREDIT_ACCOUNT_MANAGERS_ONLY
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
        require(
            addressProvider != address(0),
            Errors.ZERO_ADDRESS_IS_NOT_ALLOWED
        );

        _contractsRegister = ContractsRegister(
            AddressProvider(addressProvider).getContractsRegister()
        ); // T:[AF-1]

        masterCreditAccount = address(new CreditAccount()); // T:[AF-1]
        CreditAccount(masterCreditAccount).initialize(); // T:[AF-1]

        addCreditAccount(); // T:[AF-1]
        head = tail; // T:[AF-1]
        _nextCreditAccount[address(0)] = address(0); // T:[AF-1]
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
     * @return Address of credit account
     */
    function takeCreditAccount(
        uint256 _borrowedAmount,
        uint256 _cumulativeIndexAtOpen
    )
        external
        override
        creditManagerOnly // T:[AF-12]
        returns (address)
    {
        // Create a new credit account if no one in stock
        _checkStock(); // T:[AF-3]

        address result = head;
        head = _nextCreditAccount[head]; // T:[AF-2]
        _nextCreditAccount[result] = address(0); // T:[AF-2]

        // Initialize creditManager
        ICreditAccount(result).connectTo(
            msg.sender,
            _borrowedAmount,
            _cumulativeIndexAtOpen
        ); // T:[AF-11, 14]

        emit InitializeCreditAccount(result, msg.sender); // T:[AF-5]
        return result; // T:[AF-14]
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
        creditManagerOnly // T:[AF-12]
    {
        require(
            creditAccountsSet.contains(usedAccount),
            Errors.AF_EXTERNAL_ACCOUNTS_ARE_FORBIDDEN
        );
        require(
            ICreditAccount(usedAccount).since() != block.number,
            Errors.AF_CANT_CLOSE_CREDIT_ACCOUNT_IN_THE_SAME_BLOCK
        ); // T:[CM-20]

        _nextCreditAccount[tail] = usedAccount; // T:[AF-7]
        tail = usedAccount; // T:[AF-7]
        emit ReturnCreditAccount(usedAccount); // T:[AF-8]
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
    function addCreditAccount() public {
        address clonedAccount = Clones.clone(masterCreditAccount); // T:[AF-2]
        ICreditAccount(clonedAccount).initialize();
        _nextCreditAccount[tail] = clonedAccount; // T:[AF-2]
        tail = clonedAccount; // T:[AF-2]
        creditAccountsSet.add(clonedAccount); // T:[AF-10, 16]
        emit NewCreditAccount(clonedAccount);
    }

    /// @dev Takes unused credit account from list forever and connects it with "to" parameter
    function takeOut(
        address prev,
        address creditAccount,
        address to
    )
        external
        configuratorOnly // T:[AF-13]
    {
        _checkStock();

        if (head == creditAccount) {
            address prevHead = head;
            head = _nextCreditAccount[head]; // T:[AF-21] it exists cause we called _checkStock();
            _nextCreditAccount[prevHead] = address(0); // T:[AF-21]
        } else {
            require(
                _nextCreditAccount[prev] == creditAccount,
                Errors.AF_CREDIT_ACCOUNT_NOT_IN_STOCK
            ); // T:[AF-15]

            // updates tail if we take the last one
            if (creditAccount == tail) {
                tail = prev; // T:[AF-22]
            }

            _nextCreditAccount[prev] = _nextCreditAccount[creditAccount]; // T:[AF-16]
            _nextCreditAccount[creditAccount] = address(0); // T:[AF-16]
        }
        ICreditAccount(creditAccount).connectTo(to, 0, 0); // T:[AF-16, 21]
        creditAccountsSet.remove(creditAccount);  // T:[AF-16]
        emit TakeForever(creditAccount, to); // T:[AF-16, 21]
    }

    ///
    /// MINING
    ///

    /// @dev Adds credit account token to factory and provide approvals
    /// for protocols & tokens which will be offered to accept by DAO
    /// All protocols & tokens in the list should be non-upgradable contracts
    /// Account mining will be finished before deployment any pools & credit managers
    function mineCreditAccount() external nonReentrant {
        require(!isMiningFinished, Errors.AF_MINING_IS_FINISHED); // T:[AF-17]
        addCreditAccount(); // T:[AF-18]
        ICreditAccount(tail).connectTo(address(this), 1, 1); // T:[AF-18]
        for (uint256 i = 0; i < miningApprovals.length; i++) {
            ICreditAccount(tail).approveToken(
                miningApprovals[i].token,
                miningApprovals[i].swapContract
            ); // T:[AF-18]
        }
    }

    /// @dev Adds pair token-contract to initial mining approval list
    /// These pairs will be used during accoutn mining which is designed
    /// to reduce gas prices for the first N reusable credit accounts
    function addMiningApprovals(
        DataTypes.MiningApproval[] calldata _miningApprovals
    )
        external
        configuratorOnly // T:[AF-13]
    {
        require(!isMiningFinished, Errors.AF_MINING_IS_FINISHED); // T:[AF-17]
        for (uint256 i = 0; i < _miningApprovals.length; i++) {
            require(
                _miningApprovals[i].token != address(0) &&
                    _miningApprovals[i].swapContract != address(0),
                Errors.ZERO_ADDRESS_IS_NOT_ALLOWED
            );
            DataTypes.MiningApproval memory item = DataTypes.MiningApproval(
                _miningApprovals[i].token,
                _miningApprovals[i].swapContract
            ); // T:[AF-19]
            miningApprovals.push(item); // T:[AF-19]
        }
    }

    /// @dev Finishes mining activity. Account mining is desinged as one-time
    /// activity and should be finished before deployment pools & credit managers.
    function finishMining()
        external
        configuratorOnly // T:[AF-13]
    {
        isMiningFinished = true; // T:[AF-17]
    }

    /**
     * @dev Checks available accounts in stock and deploys new one if there is the last one
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
     */
    function _checkStock() internal {
        // T:[AF-9]
        if (_nextCreditAccount[head] == address(0)) {
            addCreditAccount(); // T:[AF-3]
        }
    }

    /// @dev Cancels allowance for particular contract
    /// @param account Address of credit account to be cancelled allowance
    /// @param token Address of token for allowance
    /// @param targetContract Address of contract to cancel allowance
    function cancelAllowance(
        address account,
        address token,
        address targetContract
    )
        external
        configuratorOnly // T:[AF-13]
    {
        ICreditAccount(account).cancelAllowance(token, targetContract); // T:[AF-20]
    }

    //
    // GETTERS
    //

    /// @dev Counts how many credit accounts are in stock
    function countCreditAccountsInStock()
        external
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
        return creditAccountsSet.length(); // T:[AF-10]
    }

    function creditAccounts(uint256 id)
        external
        view
        override
        returns (address)
    {
        return creditAccountsSet.at(id);
    }

    function isCreditAccount(address addr) external view returns (bool) {
        return creditAccountsSet.contains(addr); // T:[AF-16]
    }
}

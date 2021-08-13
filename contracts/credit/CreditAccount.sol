// SPDX-License-Identifier: BSL-1.1
// Gearbox. Generalized protocol that allows to get leverage and use it across various DeFi protocols
// (c) Gearbox.fi, 2021
pragma solidity ^0.7.4;

import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import {ICreditAccount} from "../interfaces/ICreditAccount.sol";
import {Constants} from "../libraries/helpers/Constants.sol";
import {Errors} from "../libraries/helpers/Errors.sol";

import "hardhat/console.sol";

/// @title Credit Account
/// @notice Implements generic credit account logic:
///   - Keeps token balances
///   - Stores general parameters: borrowed amount, cumulative index at open and block when it was initialized
///   - Approves tokens for 3rd party contracts
///   - Transfers assets
///   - Execute financial orders
///
///  More: https://dev.gearbox.fi/developers/credit/credit_account
contract CreditAccount is ICreditAccount, Ownable {
    using SafeERC20 for IERC20;
    using Address for address;

    // Keeps address of current credit Manager
    address public override creditManager;

    // Amount borrowed to this account
    uint256 public override borrowedAmount;

    // Cumulative index at credit account opening
    uint256 public override cumulativeIndexAtOpen;

    // Block number when it was initialised last time
    uint256 public override since;

    /// @dev Restricts operation for current credit manager only
    modifier creditManagerOnly {
        require(
            msg.sender == creditManager,
            Errors.CA_CREDIT_MANAGER_ONLY
        );
        _;
    }

    /// @dev Initializes credit account and connect it to credit account address. Restricted to account factory (owner) only
    /// @param _creditManager Credit manager address
    function initialize(address _creditManager)
        external
        override
        onlyOwner // T:[CA-1]
    {
        creditManager = _creditManager; // T:[CA-7]
        since = block.number; // T:[CA-7]
    }

    /// @dev Sets general credit account parameters. Restricted for current credit manager only
    /// @param _borrowedAmount Amount which pool lent to credit account
    /// @param _cumulativeIndexAtOpen Cumulative index at open. Uses for interest calculation
    function setGenericParameters(
        uint256 _borrowedAmount,
        uint256 _cumulativeIndexAtOpen
    )
        external
        override
        creditManagerOnly // T:[CA-2]
    {
        borrowedAmount = _borrowedAmount; // T:[CA-3]
        cumulativeIndexAtOpen = _cumulativeIndexAtOpen; // T:[CA-3]
    }

    /// @dev Updates borrowed amount. Restricted for current credit manager only
    /// @param _borrowedAmount Amount which pool lent to credit account
    function updateBorrowedAmount(uint256 _borrowedAmount)
        external
        override
        creditManagerOnly // T:[CA-2]
    {
        borrowedAmount = _borrowedAmount; // T:[CA-4]
    }

    /// @dev Approves token for 3rd party contract. Restricted for current credit manager only
    /// @param token ERC20 token for allowance
    /// @param swapContract Swap contract address
    function approveToken(address token, address swapContract)
        external
        override
        creditManagerOnly // T:[CA-2]
    {
        IERC20(token).safeApprove(swapContract, 0); // T:[CA-5]
        IERC20(token).safeApprove(swapContract, Constants.MAX_INT); // T:[CA-5]
    }

    /// @dev Transfers tokens from credit account to provided address. Restricted for current credit manager only
    /// @param token Token which should be transferred from credit account
    /// @param to Address of recipient
    /// @param amount Amount to be transferred
    function transfer(
        address token,
        address to,
        uint256 amount
    )
        external
        override
        creditManagerOnly // T:[CA-2]
    {
        IERC20(token).safeTransfer(to, amount); // T:[CA-6]
    }

    /// @dev Executes financial order on 3rd party service. Restricted for current credit manager only
    /// @param destination Contract address which should be called
    /// @param data Call data which should be sent
    function execute(address destination, bytes memory data)
        external
        override
        creditManagerOnly
        returns (bytes memory)
    {
        return destination.functionCall(data); // ToDo: Check
    }
}

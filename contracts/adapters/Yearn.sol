// SPDX-License-Identifier: MIT
// Gearbox. Generalized leverage protocol that allows to take leverage and then use it across other DeFi protocols and platforms in a composable way.
// (c) Gearbox.fi, 2021
pragma solidity ^0.7.4;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Proxy} from "@openzeppelin/contracts/proxy/Proxy.sol";
import {SafeMath} from "@openzeppelin/contracts/math/SafeMath.sol";

import {ICreditFilter} from "../interfaces/ICreditFilter.sol";
import {ICreditManager} from "../interfaces/ICreditManager.sol";
import {IYVault} from "../integrations/yearn/IYVault.sol";

import {CreditAccount} from "../credit/CreditAccount.sol";
import {CreditManager} from "../credit/CreditManager.sol";

import {Constants} from "../libraries/helpers/Constants.sol";
import {Errors} from "../libraries/helpers/Errors.sol";

import "hardhat/console.sol";

/// @title Yearn adapter
contract YearnAdapter is Proxy {
    using SafeMath for uint256;

    // Default swap contracts - uses for automatic close / liquidation process
    address public yVault; //
    address public yToken;

    // Curve pool token indexes mapping
    //    mapping(address => int128) public tokenIndexes;

    ICreditManager public creditManager;
    ICreditFilter public creditFilter;

    /// @dev Constructor
    /// @param _creditManager Address Credit manager
    /// @param _yVault Address of yVault
    constructor(address _creditManager, address _yVault) {
        creditManager = ICreditManager(_creditManager);
        creditFilter = ICreditFilter(creditManager.creditFilter());

        yVault = _yVault;

        // Check that we have token connected with this yearn pool
        yToken = IYVault(yVault).token();
        creditFilter.revertIfTokenNotAllowed(yToken);
    }

    function _implementation() internal view override returns (address) {
        return yVault;
    }

    /// @dev Deposit credit account tokens to Yearn
    /// @param _amount in tokens
    function deposit(uint256 _amount) external {
        address creditAccount = creditManager.getCreditAccountOrRevert(
            msg.sender
        );
        _deposit(creditAccount, _amount);
    }

    function depositAll() external {
        address creditAccount = creditManager.getCreditAccountOrRevert(
            msg.sender
        );
        uint256 amount = ERC20(yToken).balanceOf(creditAccount);

        console.log("amt");
        console.log(amount);

        _deposit(creditAccount, amount);
    }

    function _deposit(address creditAccount, uint256 amount) internal {
        creditManager.provideCreditAccountAllowance(
            creditAccount,
            yVault,
            yToken
        );

        console.log(yToken);
        // bytes4(0xb6b55f25) = deposit
        bytes memory data = abi.encodeWithSelector(bytes4(0xb6b55f25), amount);

        uint256 balanceBefore = ERC20(yVault).balanceOf(creditAccount);

        creditManager.executeOrder(msg.sender, yVault, data);

        creditFilter.checkCollateralChange(
            creditAccount,
            yToken,
            yVault,
            amount,
            ERC20(yVault).balanceOf(creditAccount).sub(balanceBefore)
        );
    }

    /// @dev Withdraw yVaults from credit account
    /// @param _shares shares in vault
    function withdraw(uint256 _shares) external {
        address creditAccount = creditManager.getCreditAccountOrRevert(
            msg.sender
        );
        _withdraw(creditAccount, _shares);
    }

    function withdrawAll() external {
        address creditAccount = creditManager.getCreditAccountOrRevert(
            msg.sender
        );
        uint256 amount = ERC20(yVault).balanceOf(creditAccount);
        _withdraw(creditAccount, amount);
    }

    function _withdraw(address creditAccount, uint256 _shares) internal {

        creditManager.provideCreditAccountAllowance(
            creditAccount,
            yVault,
            yToken
        );

        bytes memory data = abi.encodeWithSignature(
            "withdraw(uint256)",
            _shares
        );

        uint256 balance = ERC20(yToken).balanceOf(creditAccount);

        creditManager.executeOrder(msg.sender, yVault, data);

        creditFilter.checkCollateralChange(
            creditAccount,
            yVault,
            yToken,
            _shares,
            ERC20(yToken).balanceOf(creditAccount).sub(balance)
        );
    }
}

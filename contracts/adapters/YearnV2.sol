// SPDX-License-Identifier: MIT
// Gearbox. Generalized leverage protocol that allows to take leverage and then use it across other DeFi protocols and platforms in a composable way.
// (c) Gearbox.fi, 2021
pragma solidity ^0.7.4;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {SafeMath} from "@openzeppelin/contracts/math/SafeMath.sol";

import {ICreditFilter} from "../interfaces/ICreditFilter.sol";
import {ICreditManager} from "../interfaces/ICreditManager.sol";
import {IYVault} from "../integrations/yearn/IYVault.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {CreditAccount} from "../credit/CreditAccount.sol";
import {CreditManager} from "../credit/CreditManager.sol";

import {Constants} from "../libraries/helpers/Constants.sol";
import {Errors} from "../libraries/helpers/Errors.sol";

import "hardhat/console.sol";

/// @title Yearn adapter
contract YearnAdapter is IYVault {
    using SafeMath for uint256;

    address public yVault;
    address public override token;

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
        token = IYVault(yVault).token();
        creditFilter.revertIfTokenNotAllowed(token);
    }

    /// @dev Deposit credit account tokens to Yearn
    function deposit() external override returns (uint256) {
        // bytes4(0xd0e30db0) = deposit()
        return _deposit(abi.encodeWithSelector(bytes4(0xd0e30db0))); // M:[YA-1]
    }

    /// @dev Deposit credit account tokens to Yearn
    /// @param amount in tokens
    function deposit(uint256 amount) external override returns (uint256) {
        // bytes4(0xb6b55f25) = deposit
        return _deposit(abi.encodeWithSelector(bytes4(0xb6b55f25), amount)); // M:[YA-2]
    }

    /// @dev Deposit credit account tokens to Yearn
    /// @param amount in tokens
    function deposit(uint256 amount, address)
        external
        override
        returns (uint256)
    {
        // bytes4(0xb6b55f25) = deposit
        return _deposit(abi.encodeWithSelector(bytes4(0xb6b55f25), amount)); // M:[YA-2]
    }

    function _deposit(bytes memory data) internal returns (uint256 shares) {
        address creditAccount = creditManager.getCreditAccountOrRevert(
            msg.sender
        ); // M:[YA-1,2]

        creditManager.provideCreditAccountAllowance(
            creditAccount,
            yVault,
            token
        ); // M:[YA-1,2]

        uint256 balanceInBefore = IERC20(token).balanceOf(creditAccount); // M:[YA-1,2]
        uint256 balanceOutBefore = IERC20(yVault).balanceOf(creditAccount); // M:[YA-1,2]

        shares = abi.decode(
            creditManager.executeOrder(msg.sender, yVault, data),
            (uint256)
        ); // M:[YA-1,2]

        creditFilter.checkCollateralChange(
            creditAccount,
            token,
            yVault,
            balanceInBefore.sub(IERC20(token).balanceOf(creditAccount)),
            IERC20(yVault).balanceOf(creditAccount).sub(balanceOutBefore)
        ); // M:[YA-1,2]
    }

    function withdraw() external override returns (uint256) {
        // bytes4(0x3ccfd60b) = withdraw()
        return _withdraw(abi.encodeWithSelector(bytes4(0x3ccfd60b))); // M:[YA-3]
    }

    function withdraw(uint256 maxShares) external override returns (uint256) {
        // bytes4(0x2e1a7d4d) = withdraw(uint256)
        return _withdraw(abi.encodeWithSelector(bytes4(0x2e1a7d4d), maxShares));
    }

    function withdraw(uint256 maxShares, address recipient)
        external
        override
        returns (uint256)
    {
        // Call the function with MaxShares only, cause recepient doesn't make sense here
        // bytes4(0x2e1a7d4d) = withdraw(uint256)
        return _withdraw(abi.encodeWithSelector(bytes4(0x2e1a7d4d), maxShares));
    }

    /// @dev Withdraw yVaults from credit account
    /// @param maxShares How many shares to try and redeem for tokens, defaults to all.
    //  @param recipient The address to issue the shares in this Vault to. Defaults to the caller's address.
    //  @param maxLoss The maximum acceptable loss to sustain on withdrawal. Defaults to 0.01%.
    //                 If a loss is specified, up to that amount of shares may be burnt to cover losses on withdrawal.
    //  @return The quantity of tokens redeemed for `_shares`.
    function withdraw(
        uint256 maxShares,
        address,
        uint256 maxLoss
    ) public override returns (uint256 shares) {
        address creditAccount = creditManager.getCreditAccountOrRevert(
            msg.sender
        ); // M:[YA-3]
        return
            _withdraw(
                abi.encodeWithSelector(
                    bytes4(0xe63697c8), //"withdraw(uint256,address,uint256)",
                    maxShares,
                    creditAccount,
                    maxLoss
                )
            ); // M:[YA-3])
    }

    function _withdraw(bytes memory data) internal returns (uint256 shares) {
        address creditAccount = creditManager.getCreditAccountOrRevert(
            msg.sender
        ); // M:[YA-3]

        creditManager.provideCreditAccountAllowance(
            creditAccount,
            yVault,
            token
        ); // M:[YA-3]

        uint256 balanceInBefore = IERC20(yVault).balanceOf(creditAccount); // M:[YA-3]
        uint256 balanceOutBefore = IERC20(token).balanceOf(creditAccount); // M:[YA-3]

        shares = abi.decode(
            creditManager.executeOrder(msg.sender, yVault, data),
            (uint256)
        ); // M:[YA-3]

        creditFilter.checkCollateralChange(
            creditAccount,
            yVault,
            token,
            balanceInBefore.sub(IERC20(yVault).balanceOf(creditAccount)),
            IERC20(token).balanceOf(creditAccount).sub(balanceOutBefore)
        ); // M:[YA-3]
    }

    function pricePerShare() external view override returns (uint256) {
        return IYVault(yVault).pricePerShare();
    }

    function name() external view override returns (string memory) {
        return IYVault(yVault).name();
    }

    function symbol() external view override returns (string memory) {
        return IYVault(yVault).symbol();
    }

    function decimals() external view override returns (uint8) {
        return IYVault(yVault).decimals();
    }

    function allowance(address owner, address spender)
        external
        view
        override
        returns (uint256)
    {
        return IYVault(yVault).allowance(owner, spender);
    }

    function approve(address, uint256) external pure override returns (bool) {
        return true;
    }

    function balanceOf(address account)
        external
        view
        override
        returns (uint256)
    {
        return IYVault(yVault).balanceOf(account);
    }

    function totalSupply() external view override returns (uint256) {
        return IYVault(yVault).totalSupply();
    }

    function transfer(address, uint256) external pure override returns (bool) {
        revert(Errors.NOT_IMPLEMENTED);
    }

    function transferFrom(
        address,
        address,
        uint256
    ) external pure override returns (bool) {
        revert(Errors.NOT_IMPLEMENTED);
    }
}

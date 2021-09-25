// SPDX-License-Identifier: MIT
// Gearbox. Generalized leverage protocol that allows to take leverage and then use it across other DeFi protocols and platforms in a composable way.
// (c) Gearbox.fi, 2021
pragma solidity ^0.7.4;

import {SafeMath} from "@openzeppelin/contracts/math/SafeMath.sol";

import {ICreditFilter} from "../interfaces/ICreditFilter.sol";
import {ICreditManager} from "../interfaces/ICreditManager.sol";
import {ICurvePool} from "../integrations/curve/ICurvePool.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {CreditAccount} from "../credit/CreditAccount.sol";
import {CreditManager} from "../credit/CreditManager.sol";

import {Constants} from "../libraries/helpers/Constants.sol";
import {Errors} from "../libraries/helpers/Errors.sol";

import "hardhat/console.sol";

/// @title CurveV1 adapter
contract CurveV1Adapter is ICurvePool {
    using SafeMath for uint256;

    // Original pool contract
    ICurvePool public curvePool;
    ICreditManager public creditManager;
    ICreditFilter public creditFilter;

    /// @dev Constructor
    /// @param _creditManager Address Credit manager
    /// @param _curvePool Address of curve-compatible pool
    constructor(address _creditManager, address _curvePool) {
        creditManager = ICreditManager(_creditManager);
        creditFilter = ICreditFilter(creditManager.creditFilter());
        curvePool = ICurvePool(_curvePool);
    }

    function coins(uint256 i) external view override returns (address) {
        return ICurvePool(curvePool).coins(i);
    }

    /// @dev Exchanges two assets on Curve-compatible pools. Restricted for pool calls only
    /// @param i Index value for the coin to send
    /// @param j Index value of the coin to receive
    /// @param dx Amount of i being exchanged
    /// @param min_dy Minimum amount of j to receive
    function exchange(
        int128 i,
        int128 j,
        uint256 dx,
        uint256 min_dy
    ) external override {
        address creditAccount = creditManager.getCreditAccountOrRevert(
            msg.sender
        ); // M:[CVA-1]

        address tokenIn = curvePool.coins(uint256(i)); // M:[CVA-1]
        address tokenOut = curvePool.coins(uint256(j)); // M:[CVA-1]

        creditManager.provideCreditAccountAllowance(
            creditAccount,
            address(curvePool),
            tokenIn
        ); // M:[CVA-1]

        uint256 balanceInBefore = IERC20(tokenIn).balanceOf(creditAccount); // M:[CVA-1]
        uint256 balanceOutBefore = IERC20(tokenOut).balanceOf(creditAccount); // M:[CVA-1]

        bytes memory data = abi.encodeWithSelector(
            bytes4(0x3df02124), // "exchange(int128,int128,uint256,uint256)",
            i,
            j,
            dx,
            min_dy
        ); // M:[CVA-1]

        creditManager.executeOrder(msg.sender, address(curvePool), data); // M:[CVA-1]

        creditFilter.checkCollateralChange(
            creditAccount,
            tokenIn,
            tokenOut,
            balanceInBefore.sub(IERC20(tokenIn).balanceOf(creditAccount)),
            balanceOutBefore.add(IERC20(tokenOut).balanceOf(creditAccount))
        ); // M:[CVA-1]
    }

    function exchange_underlying(
        int128 i,
        int128 j,
        uint256 dx,
        uint256 min_dy
    ) external override {
        revert(Errors.NOT_IMPLEMENTED);
    }

    function get_dx_underlying(
        int128 i,
        int128 j,
        uint256 dy
    ) external view override returns (uint256) {
        return curvePool.get_dx_underlying(i, j, dy);
    }

    function get_dy_underlying(
        int128 i,
        int128 j,
        uint256 dx
    ) external view override returns (uint256) {
        return curvePool.get_dy_underlying(i, j, dx);
    }

    function get_dx(
        int128 i,
        int128 j,
        uint256 dy
    ) external view override returns (uint256) {
        return curvePool.get_dx(i, j, dy);
    }

    function get_dy(
        int128 i,
        int128 j,
        uint256 dx
    ) external view override returns (uint256) {
        return curvePool.get_dy(i, j, dx);
    }

    function get_virtual_price() external view override returns (uint256) {
        return curvePool.get_virtual_price();
    }
}

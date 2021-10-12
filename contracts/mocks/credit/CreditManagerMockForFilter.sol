// SPDX-License-Identifier: UNLICENSED
// Gearbox. Undercollateralized protocol for margin trading & yield farming focused on gas efficiency.
// (c) Gearbox.fi, 2021
pragma solidity ^0.7.4;

import {CreditManager} from "../../credit/CreditManager.sol";
import {IAccountFactory} from "../../interfaces/IAccountFactory.sol";
import {IWETHGateway} from "../../interfaces/IWETHGateway.sol";
import {ICreditFilter} from "../../interfaces/ICreditFilter.sol";

import "hardhat/console.sol";

/**
 * @title Credit Manager Mock for testing CreditManager Filter
 * @author Gearbox
 */
contract CreditManagerMockForFilter {
    address public underlyingToken;
    uint256 cumIndex;
    uint256 public healthFactor;
    ICreditFilter creditFilter;
    uint256 public feeSuccess;
    uint256 public feeInterest;
    uint256 public feeLiquidation;
    uint256 public liquidationDiscount;
    uint256 public maxLeverageFactor;
    uint256 public minHealthFactor;

    function connectFilter(
        address _creditFilterAddress,
        address _underlyingToken
    ) external {
        underlyingToken = _underlyingToken;
        creditFilter = ICreditFilter(_creditFilterAddress);
        feeSuccess = 1000;
        feeInterest = 1000;
        feeLiquidation = 1000;
        liquidationDiscount = 1000;
        minHealthFactor = 11600;
    }

    function setLinearCumulative(uint256 newValue) external {
        cumIndex = newValue;
    }

    function calcLinearCumulative_RAY() external view returns (uint256) {
        return cumIndex;
    }

    function poolService() external view returns (address) {
        return address(this);
    }

    function initEnabledTokens(address creditAccount) external {
        creditFilter.initEnabledTokens(creditAccount);
    }

    function checkCollateralChange(
        address creditAccount,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOut
    ) external {
        creditFilter.checkCollateralChange(
            creditAccount,
            tokenIn,
            tokenOut,
            amountIn,
            amountOut
        );
    }

    function checkAndEnableToken(address creditAccount, address token)
        external
    {
        creditFilter.checkAndEnableToken(creditAccount, token);
    }

    function setFeeLiquidation(uint256 _value) external {
        feeLiquidation = _value;
    }

    function setLiquidationDiscount(uint256 _value) external {
        liquidationDiscount = _value;
    }

    function setMaxLeverageFactor(uint256 _value) external {
        maxLeverageFactor = _value;
    }

    function updateUnderlyingTokenLiquidationThreshold() external {
        creditFilter.updateUnderlyingTokenLiquidationThreshold();
    }
}

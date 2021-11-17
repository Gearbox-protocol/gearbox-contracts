// SPDX-License-Identifier: MIT
// Gearbox. Generalized leverage protocol that allows to take leverage and then use it across other DeFi protocols and platforms in a composable way.
// (c) Gearbox.fi, 2021
pragma solidity ^0.7.4;

import {SafeMath} from "@openzeppelin/contracts/math/SafeMath.sol";
import {AggregatorV3Interface} from "@chainlink/contracts/src/v0.6/interfaces/AggregatorV3Interface.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {SafeMath} from "@openzeppelin/contracts/math/SafeMath.sol";
import {IYVault} from "../integrations/yearn/IYVault.sol";
import {Constants} from "../libraries/helpers/Constants.sol";
import {Errors} from "../libraries/helpers/Errors.sol";
import {ACLTrait} from "../core/ACLTrait.sol";
import {PercentageMath} from "../libraries/math/PercentageMath.sol";

import "hardhat/console.sol";

/// @title Yearn Chainlink pricefeed adapter
contract YearnPriceFeed is AggregatorV3Interface, ACLTrait {
    using SafeMath for uint256;
    AggregatorV3Interface public priceFeed;
    IYVault public yVault;
    uint256 public decimalsDivider;
    uint256 public lowerBound;
    uint256 public maxExpectedAPY;
    uint256 public timestampLimiter;

    constructor(
        address addressProvider,
        address _yVault,
        address _priceFeed
    ) ACLTrait(addressProvider) {
        require(
            _yVault != address(0) && _priceFeed != address(0),
            Errors.ZERO_ADDRESS_IS_NOT_ALLOWED
        );
        yVault = IYVault(_yVault);
        priceFeed = AggregatorV3Interface(_priceFeed);
        decimalsDivider = 10**yVault.decimals();
    }

    function decimals() external view override returns (uint8) {
        return priceFeed.decimals();
    }

    function description() external view override returns (string memory) {
        return priceFeed.description();
    }

    function version() external view override returns (uint256) {
        return priceFeed.version();
    }

    function getRoundData(uint80 _roundId)
        external
        view
        override
        returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        )
    {
        revert("Function is not supported");
    }

    function latestRoundData()
        external
        view
        override
        returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        )
    {
        (roundId, answer, startedAt, updatedAt, answeredInRound) = priceFeed
        .latestRoundData();

        uint256 pricePerShare = yVault.pricePerShare();

        uint256 upperBound = (lowerBound *
            (PercentageMath.PERCENTAGE_FACTOR +
                (maxExpectedAPY * (block.timestamp - timestampLimiter)) /
                Constants.SECONDS_PER_YEAR)) / PercentageMath.PERCENTAGE_FACTOR;

        require(
            pricePerShare >= lowerBound && pricePerShare <= upperBound,
            Errors.YPF_PRICE_PER_SHARE_OUT_OF_RANGE
        );
        answer = int256(
            pricePerShare.mul(uint256(answer)).div(decimalsDivider)
        );
    }

    function setLimiter(uint256 _lowerBound, uint256 _maxExpectedAPY)
        external
        configuratorOnly
    {
        lowerBound = _lowerBound;
        maxExpectedAPY = _maxExpectedAPY;
        timestampLimiter = block.timestamp;
    }
}

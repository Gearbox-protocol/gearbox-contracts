// SPDX-License-Identifier: GPL-2.0-or-later
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



/// @title Yearn Chainlink pricefeed adapter
contract YearnPriceFeed is AggregatorV3Interface, ACLTrait {
    using SafeMath for uint256;
    AggregatorV3Interface public priceFeed;
    IYVault public yVault;
    uint256 public decimalsDivider;
    uint256 public lowerBound;
    uint256 public upperBound;
    uint256 public timestampLimiter;

    event NewLimiterParams(uint256 lowerBound, uint256 upperBound);

    constructor(
        address addressProvider,
        address _yVault,
        address _priceFeed,
        uint256 _lowerBound,
        uint256 _upperBound
    ) ACLTrait(addressProvider) {
        require(
            _yVault != address(0) && _priceFeed != address(0),
            Errors.ZERO_ADDRESS_IS_NOT_ALLOWED
        );
        yVault = IYVault(_yVault);
        priceFeed = AggregatorV3Interface(_priceFeed);
        decimalsDivider = 10**yVault.decimals();
        _setLimiter(_lowerBound, _upperBound);
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

    function getRoundData(uint80)
        external
        pure
        override
        returns (
            uint80, // roundId,
            int256, // answer,
            uint256, // startedAt,
            uint256, // updatedAt,
            uint80 // answeredInRound
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

    
        require(
            pricePerShare >= lowerBound && pricePerShare <= upperBound,
            Errors.YPF_PRICE_PER_SHARE_OUT_OF_RANGE
        );
        answer = int256(
            pricePerShare.mul(uint256(answer)).div(decimalsDivider)
        );
    }

    function setLimiter(uint256 _lowerBound, uint256 _upperBound)
        external
        configuratorOnly
    {
        _setLimiter(_lowerBound, _upperBound);
    }

    function _setLimiter(uint256 _lowerBound, uint256 _upperBound)
        internal
    {
        require(
            _lowerBound > 0 && _upperBound > _lowerBound,
            Errors.YPF_INCORRECT_LIMITER_PARAMETERS
        );
        lowerBound = _lowerBound;
        upperBound = _upperBound;
        emit NewLimiterParams(lowerBound, upperBound);
    }
}

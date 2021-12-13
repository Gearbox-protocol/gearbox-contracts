// SPDX-License-Identifier: UNLICENSED
// Gearbox. Undercollateralized protocol for margin trading & yield farming focused on gas efficiency.
// (c) Gearbox.fi, 2021
pragma solidity ^0.7.4;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeMath} from "@openzeppelin/contracts/math/SafeMath.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

import {IPriceOracle} from "../../interfaces/IPriceOracle.sol";
import {IPoolService} from "../../interfaces/IPoolService.sol";
import {ICurvePool} from "../../integrations/curve/ICurvePool.sol";

import {ACLTrait} from "../../core/ACLTrait.sol";
import {PoolService} from "../../pool/PoolService.sol";
import {DieselToken} from "../../tokens/DieselToken.sol";
import {CreditAccount} from "../../credit/CreditAccount.sol";
import {Errors} from "../../libraries/helpers/Errors.sol";



/**
 * @title Pool Service Test implementation
 * @notice Used for testing Pool Service. Implements some functions to set internal parameters
 * @author Gearbox
 */
contract TestPoolService is IPoolService, PoolService {
    using SafeMath for uint256;

    /**
     * @dev Constructor
     * @param addressProvider Address Repository for upgradable contract model
     * @param _underlyingToken Address of underlying token
     * @param _dieselAddress Address of diesel (LP) token
     * @param interestRateModelAddress Address of interest rate model
     */
    constructor(
        address addressProvider,
        address _underlyingToken,
        address _dieselAddress,
        address interestRateModelAddress,
        uint256 _expectedLiquidityLimit
    )
        PoolService(
            addressProvider,
            _underlyingToken,
            _dieselAddress,
            interestRateModelAddress,
            _expectedLiquidityLimit
        )
    {}

    /**
     * @dev Mock function to set _totalLiquidity manually
     * used for test purposes only
     */

    function setExpectedLiquidity(uint256 newExpectedLiquidity) external {
        _expectedLiquidityLU = newExpectedLiquidity;
    }

    function getCumulativeIndex_RAY() external view returns (uint256) {
        return _cumulativeIndex_RAY;
    }

    function getTimestampLU() external view returns (uint256) {
        return _timestampLU;
    }

    function getExpectedLU() external view returns (uint256) {
        return _expectedLiquidityLU;
    }

    function updateBorrowRate() external {
        _updateBorrowRate(0);
    }
}

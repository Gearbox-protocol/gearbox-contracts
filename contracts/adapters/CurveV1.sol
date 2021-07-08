// SPDX-License-Identifier: BUSL-1.1
// Gearbox. Generalized protocol that allows to get leverage and use it across various DeFi protocols
// (c) Gearbox.fi, 2021
pragma solidity ^0.7.4;

import {Proxy} from "@openzeppelin/contracts/proxy/Proxy.sol";
import {SafeMath} from "@openzeppelin/contracts/math/SafeMath.sol";

import {ICreditFilter} from "../interfaces/ICreditFilter.sol";
import {ICreditManager} from "../interfaces/ICreditManager.sol";
import {ICurvePool} from "../integrations/curve/ICurvePool.sol";

import {CreditAccount} from "../credit/CreditAccount.sol";
import {CreditManager} from "../credit/CreditManager.sol";

import {Constants} from "../libraries/helpers/Constants.sol";
import {Errors} from "../libraries/helpers/Errors.sol";

import "hardhat/console.sol";

/// @title CurveV1 adapter
/// More: https://dev.gearbox.fi/developers/credit/traderpoolservice
contract CurveV1Adapter is Proxy {
    using SafeMath for uint256;

    // Default swap contracts - uses for automatic close / liquidation process
    address public curvePoolAddress; //

    // Curve pool token indexes mapping
//    mapping(address => int128) public tokenIndexes;

    ICreditManager public creditManager;
    ICreditFilter public creditFilter;

    /// @dev Constructor
    /// @param _creditManager Address Credit manager
    /// @param _curvePool Address of curve-compatible pool
    /// @param _nCoins N_COINS constant in Curve pool
    constructor(
        address _creditManager,
        address _curvePool,
        uint256 _nCoins
    ) {
        creditManager = ICreditManager(_creditManager);
        creditFilter = ICreditFilter(creditManager.creditFilter());

        curvePoolAddress = _curvePool;
        bool hasUnderlying = false;

        address underlyingToken = creditManager.underlyingToken();

        for (uint256 i = 0; i < _nCoins; i++) {
            address coinAddress = ICurvePool(curvePoolAddress).coins(i); // T:[CVA-4]

            if (coinAddress == underlyingToken) {
                hasUnderlying = true; // T:[CVA-4]
            }

        }

        require(
            hasUnderlying,
            Errors.CM_UNDERLYING_IS_NOT_IN_STABLE_POOL
        ); // T:[CVA-4]
    }

    function _implementation() internal view override returns (address) {
        return curvePoolAddress;
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
    )
        external
    {
        address creditAccount = creditManager.getCreditAccountOrRevert(msg.sender);

        address tokenIn = ICurvePool(curvePoolAddress).coins(uint256(i));
        address tokenOut= ICurvePool(curvePoolAddress).coins(uint256(j));

        creditFilter.checkCollateralChange(
            creditAccount,
            tokenIn,
            tokenOut,
            dx,
            min_dy
        ); // T:[CVA-2]

        creditManager.provideCreditAccountAllowance(
            creditAccount,
            curvePoolAddress,
            tokenIn
        ); // T:[CVA-3]

        bytes memory data =
            abi.encodeWithSignature(
                "exchange(int128,int128,uint256,uint256)",
                i,
                j,
                dx,
                min_dy
            ); // T:[CVA-3]

        creditManager.executeOrder(msg.sender, curvePoolAddress, data); // T:[CVA-3]
    }
}

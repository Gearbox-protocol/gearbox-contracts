// SPDX-License-Identifier: BSL-1.1
// Gearbox. Generalized leverage protocol that allows to take leverage and then use it across other DeFi protocols and platforms in a composable way.
// (c) Gearbox.fi, 2021
pragma solidity ^0.7.4;
pragma experimental ABIEncoderV2;

import {SafeMath} from "@openzeppelin/contracts/math/SafeMath.sol";
import {ISwapRouter} from "../integrations/uniswap/IUniswapV3.sol";
import {IUniswapV2Router02} from "../integrations/uniswap/IUniswapV2Router02.sol";
import {BytesLib} from "../integrations/uniswap/BytesLib.sol";
import {ICurvePool} from "../integrations/curve/ICurvePool.sol";
import {Constants} from "../libraries/helpers/Constants.sol";
import {Errors} from "../libraries/helpers/Errors.sol";
import {IQuoter} from "../integrations/uniswap/IQuoter.sol";
import {AddressProvider} from "../core/AddressProvider.sol";
import {ContractsRegister} from "../core/ContractsRegister.sol";
import {ICreditManager} from "../interfaces/ICreditManager.sol";
import {ICreditFilter} from "../interfaces/ICreditFilter.sol";

import "hardhat/console.sol";

contract PathFinder {
    using SafeMath for uint256;
    using BytesLib for bytes;
    AddressProvider public addressProvider;
    ContractsRegister public immutable contractsRegister;

    struct TradePath {
        address[] path;
        uint256 rate;
        uint256 expectedAmount;
    }

    /// @dev Allows provide data for registered credit managers only to eliminated usage for non-gearbox contracts
    modifier registeredCreditManagerOnly(address creditManager) {
        // Could be optimised by adding internal list of creditManagers
        require(
            contractsRegister.isCreditManager(creditManager),
            Errors.REGISTERED_CREDIT_ACCOUNT_MANAGERS_ONLY
        ); // T:[WG-3]

        _;
    }

    constructor(address _addressProvider) {
        addressProvider = AddressProvider(_addressProvider);
        contractsRegister = ContractsRegister(
            addressProvider.getContractsRegister()
        );
    }

    function bestUniPath(
        uint256 swapInterface,
        address router,
        uint256 swapType,
        address from,
        address to,
        uint256 amount,
        address[] memory tokens
    ) public returns (TradePath memory) {
        if (amount == 0) {
            return
                TradePath({path: new address[](3), rate: 0, expectedAmount: 0});
        }

        // Checking path[2]:  [from,to]
        address[] memory path = new address[](2);

        path[0] = from;
        path[1] = to;

        (uint256 bestAmount, bool best) = _getAmountsUni(
            swapInterface,
            router,
            swapType,
            path,
            amount,
            swapType == Constants.EXACT_INPUT ? 0 : Constants.MAX_INT
        );

        address[] memory bestPath;
        uint256 expectedAmount;

        if (best) {
            bestPath = path;
        }

        // Checking path[3]: [from, <connector>, to]
        for (uint256 i = 0; i < tokens.length; i++) {
            path = new address[](3);
            path[0] = from;
            path[2] = to;

            if (tokens[i] != from && tokens[i] != to) {
                path[1] = tokens[i];
                (expectedAmount, best) = _getAmountsUni(
                    swapInterface,
                    router,
                    swapType,
                    path,
                    amount,
                    bestAmount
                );
                if (best) {
                    bestAmount = expectedAmount;
                    bestPath = path;
                }
            }
        }

        uint256 bestRate = 0;

        if (bestAmount == Constants.MAX_INT) {
            bestAmount = 0;
        }

        if (bestAmount != 0 && amount != 0) {
            bestRate = swapType == Constants.EXACT_INPUT
                ? Constants.WAD.mul(amount).div(bestAmount)
                : Constants.WAD.mul(bestAmount).div(amount);
        }

        return
            TradePath({
                rate: bestRate,
                path: bestPath,
                expectedAmount: bestAmount
            });
    }

    function _getAmountsUni(
        uint256 swapInterface,
        address router,
        uint256 swapType,
        address[] memory path,
        uint256 amount,
        uint256 bestAmount
    ) internal returns (uint256, bool) {
        return
            swapInterface == Constants.UNISWAP_V2
                ? _getAmountsV2(
                    IUniswapV2Router02(router),
                    swapType,
                    path,
                    amount,
                    bestAmount
                )
                : _getAmountsV3(
                    IQuoter(router),
                    swapType,
                    path,
                    amount,
                    bestAmount
                );
    }

    function _getAmountsV2(
        IUniswapV2Router02 router,
        uint256 swapType,
        address[] memory path,
        uint256 amount,
        uint256 bestAmount
    ) internal view returns (uint256, bool) {
        uint256 expectedAmount;

        if (swapType == Constants.EXACT_INPUT) {
            try router.getAmountsOut(amount, path) returns (
                uint256[] memory amountsOut
            ) {
                expectedAmount = amountsOut[path.length - 1];
            } catch {
                return (bestAmount, false);
            }
        } else if (swapType == Constants.EXACT_OUTPUT) {
            try router.getAmountsIn(amount, path) returns (
                uint256[] memory amountsIn
            ) {
                expectedAmount = amountsIn[0];
            } catch {
                return (bestAmount, false);
            }
        } else {
            revert("Unknown swap type");
        }

        if (
            (swapType == Constants.EXACT_INPUT &&
                expectedAmount > bestAmount) ||
            (swapType == Constants.EXACT_OUTPUT && expectedAmount < bestAmount)
        ) {
            return (expectedAmount, true);
        }

        return (bestAmount, false);
    }

    function _getAmountsV3(
        IQuoter quoter,
        uint256 swapType,
        address[] memory path,
        uint256 amount,
        uint256 bestAmount
    ) internal returns (uint256, bool) {
        uint256 expectedAmount;

        if (swapType == Constants.EXACT_INPUT) {
            try
                quoter.quoteExactInput(
                    convertPathToPathV3(path, swapType),
                    amount
                )
            returns (uint256 amountOut) {
                expectedAmount = amountOut;
            } catch {
                return (bestAmount, false);
            }
        } else if (swapType == Constants.EXACT_OUTPUT) {
            try
                quoter.quoteExactOutput(
                    convertPathToPathV3(path, swapType),
                    amount
                )
            returns (uint256 amountIn) {
                expectedAmount = amountIn;
            } catch {
                return (bestAmount, false);
            }
        } else {
            revert("Unknown swap type");
        }

        if (
            (swapType == Constants.EXACT_INPUT &&
                expectedAmount > bestAmount) ||
            (swapType == Constants.EXACT_OUTPUT && expectedAmount < bestAmount)
        ) {
            return (expectedAmount, true);
        }

        return (bestAmount, false);
    }

    function convertPathToPathV3(address[] memory path, uint256 swapType)
        public
        pure
        returns (bytes memory result)
    {
        uint24 fee = 3000;

        if (swapType == Constants.EXACT_INPUT) {
            for (uint256 i = 0; i < path.length.sub(1); i++) {
                result = result.concat(abi.encodePacked(path[i], fee));
            }
            result = result.concat(abi.encodePacked(path[path.length - 1]));
        } else {
            for (uint256 i = path.length.sub(1); i > 0; i--) {
                result = result.concat(abi.encodePacked(path[i], fee));
            }
            result = result.concat(abi.encodePacked(path[0]));
        }
    }

    function getClosurePaths(
        address router,
        address _creditManager,
        address borrower,
        address[] memory connectorTokens
    )
        external
        registeredCreditManagerOnly(_creditManager)
        returns (TradePath[] memory result)
    {
        ICreditFilter creditFilter = ICreditFilter(
            ICreditManager(_creditManager).creditFilter()
        );
        result = new TradePath[](creditFilter.allowedTokensCount());

        address creditAccount = ICreditManager(_creditManager)
        .getCreditAccountOrRevert(borrower);
        address underlyingToken = creditFilter.underlyingToken();

        for (uint256 i = 0; i < creditFilter.allowedTokensCount(); i++) {
            (address token, uint256 balance, , ) = creditFilter
            .getCreditAccountTokenById(creditAccount, i);

            if (i == 0) {
                result[0] = TradePath({
                    path: new address[](3),
                    rate: Constants.WAD,
                    expectedAmount: balance
                });
            } else {
                result[i] = bestUniPath(
                    Constants.UNISWAP_V2,
                    router,
                    Constants.EXACT_INPUT,
                    token,
                    underlyingToken,
                    balance,
                    connectorTokens
                );
            }
        }
    }
}

// SPDX-License-Identifier: MIT
// Gearbox. Generalized protocol that allows to get leverage and use it across various DeFi protocols
// (c) Gearbox.fi, 2021
pragma solidity ^0.7.4;

import {ICreditFilter} from "../interfaces/ICreditFilter.sol";
import {ICreditManager} from "../interfaces/ICreditManager.sol";
import {CreditManager} from "../credit/CreditManager.sol";
import {Constants} from "../libraries/helpers/Constants.sol";
import {Errors} from "../libraries/helpers/Errors.sol";
import {Proxy} from "@openzeppelin/contracts/proxy/Proxy.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeMath} from "@openzeppelin/contracts/math/SafeMath.sol";

import "hardhat/console.sol";

/// @title UniswapV2 Router adapter
contract UniswapV2Adapter is Proxy {
    ICreditManager public creditManager;
    ICreditFilter public creditFilter;
    using SafeMath for uint256;
    address public swapContract;

    /// @dev Constructor
    /// @param _creditManager Address Credit manager
    /// @param _swapContract Address of swap contract
    constructor(address _creditManager, address _swapContract) {
        creditManager = ICreditManager(_creditManager);
        creditFilter = ICreditFilter(creditManager.creditFilter());
        swapContract = _swapContract;
    }

    function _implementation() internal view override returns (address) {
        return swapContract;
    }

    /**
     * @dev Swap tokens to exact tokens using Uniswap-compatible protocol
     * - checks that swap contract is allowed
     * - checks that in/out tokens are in allowed list
     * - checks that required allowance is enough, if not - set it to MAX_INT
     * - call swap function on credit account contracts
     * @param amountOut The amount of output tokens to receive.
     * @param amountInMax The maximum amount of input tokens that can be required before the transaction reverts.
     * @param path An array of token addresses. path.length must be >= 2. Pools for each consecutive pair of
     *        addresses must exist and have liquidity.
     * @param deadline Unix timestamp after which the transaction will revert.
     * for more information check uniswap documentation: https://uniswap.org/docs/v2/smart-contracts/router02/
     */
    function swapTokensForExactTokens(
        uint256 amountOut,
        uint256 amountInMax,
        address[] calldata path,
        address,
        uint256 deadline
    ) external {
        address tokenIn = path[0]; // T:[UV2A-6]
        address tokenOut = path[path.length - 1]; // T:[UV2A-6]

        address creditAccount = creditManager.getCreditAccountOrRevert(
            msg.sender
        );

        uint256 amountIn = IERC20(tokenIn).balanceOf(creditAccount);

        creditManager.provideCreditAccountAllowance(
            creditAccount,
            swapContract,
            tokenIn
        );

        {
            bytes memory data = abi.encodeWithSelector(
                bytes4(0x8803dbee), // "swapTokensForExactTokens(uint256,uint256,address[],address,uint256)",
                amountOut,
                amountInMax,
                path,
                creditAccount,
                deadline
            );

            creditManager.executeOrder(msg.sender, swapContract, data);
        }

        amountIn = amountIn.sub(IERC20(tokenIn).balanceOf(creditAccount));

        creditFilter.checkCollateralChange(
            creditAccount,
            tokenIn,
            tokenOut,
            amountIn,
            amountOut
        ); // ToDo: CHECK(!)
    }

    /**
     * Swaps exact tokens to tokens on Uniswap compatible protocols
     * - checks that swap contract is allowed
     * - checks that in/out tokens are in allowed list
     * - checks that required allowance is enough, if not - set it to MAX_INT
     * - call swap function on credit account contracts
     * @param amountIn The amount of input tokens to send.
     * @param amountOutMin The minimum amount of output tokens that must be received for the transaction not to revert.
     * @param path An array of token addresses. path.length must be >= 2. Pools for each consecutive pair of
     *        addresses must exist and have liquidity.
     * deadline Unix timestamp after which the transaction will revert.
     * for more information check uniswap documentation: https://uniswap.org/docs/v2/smart-contracts/router02/
     */

    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address,
        uint256 deadline
    ) external {
        address tokenIn = path[0]; // T:[UV2A-5]
        address tokenOut = path[path.length - 1]; // T:[UV2A-5]

        address creditAccount = creditManager.getCreditAccountOrRevert(
            msg.sender
        );

        uint256 amountOut = IERC20(tokenOut).balanceOf(creditAccount);

        creditManager.provideCreditAccountAllowance(
            creditAccount,
            swapContract,
            tokenIn
        );

        bytes memory data = abi.encodeWithSelector(
            bytes4(0x38ed1739), // "swapExactTokensForTokens(uint256,uint256,address[],address,uint256)",
            amountIn,
            amountOutMin,
            path,
            creditAccount,
            deadline
        );

        creditManager.executeOrder(msg.sender, swapContract, data);

        // Calc delta
        amountOut = (IERC20(tokenOut).balanceOf(creditAccount)).sub(amountOut);

        creditFilter.checkCollateralChange(
            creditAccount,
            tokenIn,
            tokenOut,
            amountIn,
            amountOut
        ); // ToDo: CHECK(!)
    }
}

// SPDX-License-Identifier: MIT
// Gearbox. Generalized leverage protocol that allows to take leverage and then use it across other DeFi protocols and platforms in a composable way.
// (c) Gearbox.fi, 2021
pragma solidity ^0.7.4;
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IUniswapV2Router02} from "../integrations/uniswap/IUniswapV2Router02.sol";
import {ICreditFilter} from "../interfaces/ICreditFilter.sol";
import {ICreditManager} from "../interfaces/ICreditManager.sol";
import {CreditManager} from "../credit/CreditManager.sol";
import {Constants} from "../libraries/helpers/Constants.sol";
import {Errors} from "../libraries/helpers/Errors.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeMath} from "@openzeppelin/contracts/math/SafeMath.sol";

import "hardhat/console.sol";

/// @title UniswapV2 Router adapter
contract UniswapV2Adapter is IUniswapV2Router02, ReentrancyGuard {
    using SafeMath for uint256;

    ICreditManager public creditManager;
    ICreditFilter public creditFilter;
    address public router;

    /// @dev Constructor
    /// @param _creditManager Address Credit manager
    /// @param _router Address of IUniswapV2Router02
    constructor(address _creditManager, address _router) {
        require(
            _creditManager != address(0) && _router != address(0),
            Errors.ZERO_ADDRESS_IS_NOT_ALLOWED
        );
        creditManager = ICreditManager(_creditManager);
        creditFilter = ICreditFilter(creditManager.creditFilter());
        router = _router;
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
    ) external override nonReentrant returns (uint256[] memory amounts) {
        address creditAccount = creditManager.getCreditAccountOrRevert(
            msg.sender
        );

        address tokenIn = path[0];
        address tokenOut = path[path.length - 1];

        creditManager.provideCreditAccountAllowance(
            creditAccount,
            router,
            tokenIn
        );

        uint256 balanceInBefore = IERC20(tokenIn).balanceOf(creditAccount); // M:[CVA-1]
        uint256 balanceOutBefore = IERC20(tokenOut).balanceOf(creditAccount); // M:[CVA-1]

        bytes memory data = abi.encodeWithSelector(
            bytes4(0x8803dbee), // "swapTokensForExactTokens(uint256,uint256,address[],address,uint256)",
            amountOut,
            amountInMax,
            path,
            creditAccount,
            deadline
        );

        amounts = abi.decode(
            creditManager.executeOrder(msg.sender, router, data),
            (uint256[])
        );

        creditFilter.checkCollateralChange(
            creditAccount,
            tokenIn,
            tokenOut,
            balanceInBefore.sub(IERC20(tokenIn).balanceOf(creditAccount)),
            IERC20(tokenOut).balanceOf(creditAccount).sub(balanceOutBefore)
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
    ) external override nonReentrant returns (uint256[] memory amounts) {
        address creditAccount = creditManager.getCreditAccountOrRevert(
            msg.sender
        );

        address tokenIn = path[0];
        address tokenOut = path[path.length - 1];

        creditManager.provideCreditAccountAllowance(
            creditAccount,
            router,
            tokenIn
        );

        uint256 balanceInBefore = IERC20(tokenIn).balanceOf(creditAccount); // M:
        uint256 balanceOutBefore = IERC20(tokenOut).balanceOf(creditAccount); // M:

        bytes memory data = abi.encodeWithSelector(
            bytes4(0x38ed1739), // "swapExactTokensForTokens(uint256,uint256,address[],address,uint256)",
            amountIn,
            amountOutMin,
            path,
            creditAccount,
            deadline
        );

        amounts = abi.decode(
            creditManager.executeOrder(msg.sender, router, data),
            (uint256[])
        );

        creditFilter.checkCollateralChange(
            creditAccount,
            tokenIn,
            tokenOut,
            balanceInBefore.sub(IERC20(tokenIn).balanceOf(creditAccount)),
            IERC20(tokenOut).balanceOf(creditAccount).sub(balanceOutBefore)
        ); // ToDo: CHECK(!)
    }

    function removeLiquidityETHSupportingFeeOnTransferTokens(
        address token,
        uint256 liquidity,
        uint256 amountTokenMin,
        uint256 amountETHMin,
        address to,
        uint256 deadline
    ) external override returns (uint256 amountETH) {
        revert(Errors.NOT_IMPLEMENTED);
    }

    function removeLiquidityETHWithPermitSupportingFeeOnTransferTokens(
        address token,
        uint256 liquidity,
        uint256 amountTokenMin,
        uint256 amountETHMin,
        address to,
        uint256 deadline,
        bool approveMax,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external override returns (uint256 amountETH) {
        revert(Errors.NOT_IMPLEMENTED);
    }

    function swapExactTokensForTokensSupportingFeeOnTransferTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external override {
        revert(Errors.NOT_IMPLEMENTED);
    }

    function swapExactETHForTokensSupportingFeeOnTransferTokens(
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external payable override {
        revert(Errors.NOT_IMPLEMENTED);
    }

    function swapExactTokensForETHSupportingFeeOnTransferTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external override {
        revert(Errors.NOT_IMPLEMENTED);
    }

    function factory() external view override returns (address) {
        return IUniswapV2Router02(router).factory();
    }

    function WETH() external view override returns (address) {
        return IUniswapV2Router02(router).WETH();
    }

    function addLiquidity(
        address tokenA,
        address tokenB,
        uint256 amountADesired,
        uint256 amountBDesired,
        uint256 amountAMin,
        uint256 amountBMin,
        address to,
        uint256 deadline
    )
        external
        override
        returns (
            uint256 amountA,
            uint256 amountB,
            uint256 liquidity
        )
    {
        revert(Errors.NOT_IMPLEMENTED);
    }

    function addLiquidityETH(
        address token,
        uint256 amountTokenDesired,
        uint256 amountTokenMin,
        uint256 amountETHMin,
        address to,
        uint256 deadline
    )
        external
        payable
        override
        returns (
            uint256 amountToken,
            uint256 amountETH,
            uint256 liquidity
        )
    {
        revert(Errors.NOT_IMPLEMENTED);
    }

    function removeLiquidity(
        address tokenA,
        address tokenB,
        uint256 liquidity,
        uint256 amountAMin,
        uint256 amountBMin,
        address to,
        uint256 deadline
    ) external override returns (uint256 amountA, uint256 amountB) {
        revert(Errors.NOT_IMPLEMENTED);
    }

    function removeLiquidityETH(
        address token,
        uint256 liquidity,
        uint256 amountTokenMin,
        uint256 amountETHMin,
        address to,
        uint256 deadline
    ) external override returns (uint256 amountToken, uint256 amountETH) {
        revert(Errors.NOT_IMPLEMENTED);
    }

    function removeLiquidityWithPermit(
        address tokenA,
        address tokenB,
        uint256 liquidity,
        uint256 amountAMin,
        uint256 amountBMin,
        address to,
        uint256 deadline,
        bool approveMax,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external override returns (uint256 amountA, uint256 amountB) {
        revert(Errors.NOT_IMPLEMENTED);
    }

    function removeLiquidityETHWithPermit(
        address token,
        uint256 liquidity,
        uint256 amountTokenMin,
        uint256 amountETHMin,
        address to,
        uint256 deadline,
        bool approveMax,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external override returns (uint256 amountToken, uint256 amountETH) {
        revert(Errors.NOT_IMPLEMENTED);
    }

    function swapExactETHForTokens(
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external payable override returns (uint256[] memory amounts) {
        revert(Errors.NOT_IMPLEMENTED);
    }

    function swapTokensForExactETH(
        uint256 amountOut,
        uint256 amountInMax,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external override returns (uint256[] memory amounts) {
        revert(Errors.NOT_IMPLEMENTED);
    }

    function swapExactTokensForETH(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external override returns (uint256[] memory amounts) {
        revert(Errors.NOT_IMPLEMENTED);
    }

    function swapETHForExactTokens(
        uint256 amountOut,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external payable override returns (uint256[] memory amounts) {
        revert(Errors.NOT_IMPLEMENTED);
    }

    function quote(
        uint256 amountA,
        uint256 reserveA,
        uint256 reserveB
    ) external view override returns (uint256 amountB) {
        return IUniswapV2Router02(router).quote(amountA, reserveA, reserveB);
    }

    function getAmountOut(
        uint256 amountIn,
        uint256 reserveIn,
        uint256 reserveOut
    ) external view override returns (uint256 amountOut) {
        return
            IUniswapV2Router02(router).getAmountOut(
                amountIn,
                reserveIn,
                reserveOut
            );
    }

    function getAmountIn(
        uint256 amountOut,
        uint256 reserveIn,
        uint256 reserveOut
    ) external view override returns (uint256 amountIn) {
        return
            IUniswapV2Router02(router).getAmountIn(
                amountOut,
                reserveIn,
                reserveOut
            );
    }

    function getAmountsOut(uint256 amountIn, address[] calldata path)
        external
        view
        override
        returns (uint256[] memory amounts)
    {
        return IUniswapV2Router02(router).getAmountsOut(amountIn, path);
    }

    function getAmountsIn(uint256 amountOut, address[] calldata path)
        external
        view
        override
        returns (uint256[] memory amounts)
    {
        return IUniswapV2Router02(router).getAmountsIn(amountOut, path);
    }
}

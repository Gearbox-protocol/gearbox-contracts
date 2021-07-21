// SPDX-License-Identifier: MIT
// Gearbox. Generalized protocol that allows to get leverage and use it across various DeFi protocols
// (c) Gearbox.fi, 2021
pragma solidity ^0.7.4;
pragma abicoder v2;

import {ISwapRouter} from "../integrations/uniswap/IUniswapV3.sol";
import {BytesLib} from "../integrations/uniswap/BytesLib.sol";
import {Proxy} from "@openzeppelin/contracts/proxy/Proxy.sol";

import {ICreditFilter} from "../interfaces/ICreditFilter.sol";
import {ICreditManager} from "../interfaces/ICreditManager.sol";
import {CreditManager} from "../credit/CreditManager.sol";

import "hardhat/console.sol";

/// @title UniswapV3 Router adapter
contract UniswapV3Adapter is ISwapRouter, Proxy {
    using BytesLib for bytes;

    ICreditManager public creditManager;
    ICreditFilter public creditFilter;
    address public swapContract;

    /// @dev The length of the bytes encoded address
    uint256 private constant ADDR_SIZE = 20;

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

    /// @notice Swaps `amountIn` of one token for as much as possible of another token
    /// @param params The parameters necessary for the swap, encoded as `ExactInputSingleParams` in calldata
    /// @return amountOut The amount of the received token
    function exactInputSingle(ExactInputSingleParams calldata params)
        external
        payable
        override
        returns (uint256 amountOut)
    {
        address creditAccount = creditManager.getCreditAccountOrRevert(
            msg.sender
        );

        creditManager.provideCreditAccountAllowance(
            creditAccount,
            swapContract,
            params.tokenIn
        );

        ExactInputSingleParams memory paramsUpdate = params;
        paramsUpdate.recipient = creditAccount;

        // 0x414bf389 = exactInputSingle((address,address,uint24,address,uint256,uint256,uint256,uint160))
        bytes memory data = abi.encodeWithSelector(
            bytes4(0x414bf389), // +
            paramsUpdate
        );

        bytes memory result = creditManager.executeOrder(
            msg.sender,
            swapContract,
            data
        );
        (amountOut) = abi.decode(result, (uint256));

        creditFilter.checkCollateralChange(
            creditAccount,
            params.tokenIn,
            params.tokenOut,
            params.amountIn,
            amountOut
        );
    }

    /// @notice Swaps `amountIn` of one token for as much as possible of another along the specified path
    /// @param params The parameters necessary for the multi-hop swap, encoded as `ExactInputParams` in calldata
    /// @return amountOut The amount of the received token
    function exactInput(ExactInputParams calldata params)
        external
        payable
        override
        returns (uint256 amountOut)
    {
        address creditAccount = creditManager.getCreditAccountOrRevert(
            msg.sender
        );

        (address tokenIn, address tokenOut) = extractTokens(params.path);

        creditManager.provideCreditAccountAllowance(
            creditAccount,
            swapContract,
            tokenIn
        );

        ExactInputParams memory paramsUpdate = params;
        paramsUpdate.recipient = creditAccount;

        // 0xc04b8d59 = exactInput((bytes,address,uint256,uint256,uint256))
        bytes memory data = abi.encodeWithSelector(
            bytes4(0xc04b8d59), // +
            paramsUpdate
        );

        bytes memory result = creditManager.executeOrder(
            msg.sender,
            swapContract,
            data
        );
        (amountOut) = abi.decode(result, (uint256));

        creditFilter.checkCollateralChange(
            creditAccount,
            tokenIn,
            tokenOut,
            params.amountIn,
            amountOut
        );
    }

    /// @notice Swaps as little as possible of one token for `amountOut` of another token
    /// @param params The parameters necessary for the swap, encoded as `ExactOutputSingleParams` in calldata
    /// @return amountIn The amount of the input token
    function exactOutputSingle(ExactOutputSingleParams calldata params)
        external
        payable
        override
        returns (uint256 amountIn)
    {
        address creditAccount = creditManager.getCreditAccountOrRevert(
            msg.sender
        );

        creditManager.provideCreditAccountAllowance(
            creditAccount,
            swapContract,
            params.tokenIn
        );

        ExactOutputSingleParams memory paramsUpdate = params;
        paramsUpdate.recipient = creditAccount;

        //
        bytes memory data = abi.encodeWithSelector(
            bytes4(0xdb3e2198), //+
            paramsUpdate
        );

        bytes memory result = creditManager.executeOrder(
            msg.sender,
            swapContract,
            data
        );
        (amountIn) = abi.decode(result, (uint256));

        creditFilter.checkCollateralChange(
            creditAccount,
            params.tokenIn,
            params.tokenOut,
            amountIn,
            params.amountOut
        );
    }

    /// @notice Swaps as little as possible of one token for `amountOut` of another along the specified path (reversed)
    /// @param params The parameters necessary for the multi-hop swap, encoded as `ExactOutputParams` in calldata
    /// @return amountIn The amount of the input token
    function exactOutput(ExactOutputParams calldata params)
        external
        payable
        override
        returns (uint256 amountIn)
    {
        address creditAccount = creditManager.getCreditAccountOrRevert(
            msg.sender
        );

        (address tokenIn, address tokenOut) = extractTokens(params.path);

        creditManager.provideCreditAccountAllowance(
            creditAccount,
            swapContract,
            tokenIn
        );

        ExactOutputParams memory paramsUpdate = params;
        paramsUpdate.recipient = creditAccount;

        //                "swapTokensForExactTokens(uint256,uint256,address[],address,uint256)",
        bytes memory data = abi.encodeWithSelector(
            bytes4(0xf28c0498), //+
            paramsUpdate
        );

        bytes memory result = creditManager.executeOrder(
            msg.sender,
            swapContract,
            data
        );
        (amountIn) = abi.decode(result, (uint256));

        creditFilter.checkCollateralChange(
            creditAccount,
            tokenIn,
            tokenOut,
            amountIn,
            params.amountOut
        );
    }

    function extractTokens(bytes memory path)
        internal
        pure
        returns (address tokenA, address tokenB)
    {
        tokenA = path.toAddress(0);
        tokenB = path.toAddress(path.length - ADDR_SIZE);
    }
}

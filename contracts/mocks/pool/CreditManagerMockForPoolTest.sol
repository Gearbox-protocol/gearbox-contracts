// SPDX-License-Identifier: UNLICENSED
// Gearbox Protocol. Generalized leverage for DeFi protocols
// (c) Gearbox Holdings, 2021
pragma solidity ^0.7.4;

import {IPoolService} from "../../interfaces/IPoolService.sol";

contract CreditManagerMockForPoolTest {
    address public poolService;
    address public underlyingToken;

    constructor(address _poolService) {
        poolService = _poolService;
    }

    /**
     * @dev Transfers money from the pool to credit account
     * and updates the pool parameters
     * @param borrowedAmount Borrowed amount for credit account
     * @param creditAccount Credit account address
     */
    function lendCreditAccount(uint256 borrowedAmount, address creditAccount)
        external
    {
        IPoolService(poolService).lendCreditAccount(
            borrowedAmount,
            creditAccount
        );
    }

    /**
     * @dev Recalculates total borrowed & borrowRate
     * mints/burns diesel tokens
     */
    function repayCreditAccount(
        uint256 borrowedAmount,
        uint256 profit,
        uint256 loss
    ) external {
        IPoolService(poolService).repayCreditAccount(
            borrowedAmount,
            profit,
            loss
        );
    }
}

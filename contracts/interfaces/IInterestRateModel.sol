// SPDX-License-Identifier: GPL-2.0-or-later
// Gearbox Protocol. Generalized leverage for DeFi protocols
// (c) Gearbox Holdings, 2021
pragma solidity ^0.7.4;


/// @title IInterestRateModel interface
/// @dev Interface for the calculation of the interest rates
interface IInterestRateModel {

    /// @dev Calculated borrow rate based on expectedLiquidity and availableLiquidity
    /// @param expectedLiquidity Expected liquidity in the pool
    /// @param availableLiquidity Available liquidity in the pool
    function calcBorrowRate(uint256 expectedLiquidity, uint256 availableLiquidity)
        external
        view
        returns (uint256);
}

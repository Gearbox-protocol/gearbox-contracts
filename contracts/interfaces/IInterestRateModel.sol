// SPDX-License-Identifier: BUSL-1.1
// Gearbox. Generalized protocol that allows to get leverage and use it across various DeFi protocols
// (c) Gearbox.fi, 2021
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

// SPDX-License-Identifier: GPL-2.0-or-later
// Gearbox. Generalized leverage protocol that allows to take leverage and then use it across other DeFi protocols and platforms in a composable way.
// (c) Gearbox.fi, 2021
pragma solidity ^0.7.4;

/// @title POptimised for front-end Pool Service Interface
interface IAppPoolService {

    function addLiquidity(
        uint256 amount,
        address onBehalfOf,
        uint256 referralCode
    ) external;

    function removeLiquidity(uint256 amount, address to) external returns(uint256);

}

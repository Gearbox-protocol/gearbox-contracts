// SPDX-License-Identifier: BUSL-1.1
// Gearbox. Generalized protocol that allows to get leverage and use it across various DeFi protocols
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

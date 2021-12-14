// SPDX-License-Identifier: UNLICENSED
// Gearbox Protocol. Generalized leverage for DeFi protocols
// (c) Gearbox Holdings, 2021
pragma solidity ^0.7.4;

import {ACLTrait} from "../../core/ACLTrait.sol";

/**
 * @title Pausable Trait Test
 * @notice this contract is used to test how poolOnly modifier works
 */
contract ACLTraitTest is ACLTrait {
    constructor(address addressProvider) ACLTrait(addressProvider) {}

    function accessWhenNotPaused() external view whenNotPaused {}

    function accessWhenPaused() external view whenPaused {}

    function accessConfiguratorOnly() external view configuratorOnly {}
}

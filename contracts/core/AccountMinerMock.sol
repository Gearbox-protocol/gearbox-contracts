// SPDX-License-Identifier: BSL-1.1
// Gearbox. Generalized protocol that allows to get leverage and use it across various DeFi protocols
// (c) Gearbox.fi, 2021
pragma solidity ^0.7.4;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {
    ReentrancyGuard
} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {IAccountMiner} from "../interfaces/IAccountMiner.sol";
import {AbstractAccountMiner} from "./AbstractAccountMiner.sol";

/// @title Credit account miner which do not cover user expenditures
contract AccountMinerMock is
    IAccountMiner,
    AbstractAccountMiner,
    Ownable,
    Pausable,
    ReentrancyGuard
{

    // Account miner kind
    bytes32 public constant override kind = "mock";

    constructor(address addressProvider) AbstractAccountMiner(addressProvider) {}

    /**
     * Pays gas compensation for user who opens position
     * This contract will be funded from treasury as crucial part
     * operational processes, when miner auction ends
     */
    function mineAccount(address payable trader)
        external
        view
        override
        accountFactoryOnly // T:[AMM-5]
    {
        // T:[AMM-6]
    }
}

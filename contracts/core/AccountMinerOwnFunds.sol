// SPDX-License-Identifier: BUSL-1.1
// Gearbox. Generalized protocol that allows to get leverage and use it across various DeFi protocols
// (c) Gearbox.fi, 2021
pragma solidity ^0.7.4;

import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {
    ReentrancyGuard
} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {ACLTrait} from "../configuration/ACLTrait.sol";
import {IAccountMiner} from "../interfaces/IAccountMiner.sol";
import {AbstractAccountMiner} from "./AbstractAccountMiner.sol";

/// @title Credit account miner which pays gas compensation from its own funds
/// @notice This AccountMiner will replace AccountMinerAuction when DAO treasury
/// will have enough money to deploy contracts on it's own.
/// There is no automation here, DAO is responsible to transfer budget for deployment compensation.
contract AccountMinerOwnFunds is
    IAccountMiner,
    AbstractAccountMiner,
    ACLTrait,
    ReentrancyGuard
{
    // Account miner kind
    bytes32 public constant override kind = "own"; // T:[AMOF-5]

    // Emits each time when owner fulfill the balance
    event BalanceAdded(address indexed sponsor, uint256 amount);

    constructor(address addressProvider)
        AbstractAccountMiner(addressProvider)
        ACLTrait(addressProvider)
    {}

    /// @dev Pays gas compensation for the user who opens a credit account. This contract will be funded
    /// from treasury as crucial part operational processes, when miner auction ends
    function mineAccount(address payable trader)
        external
        override
        accountFactoryOnly // T:[AMOF-1]
        nonReentrant
    {
        _payGasCompensation(trader);
    }

    /// @dev Emits balance update event when getting money
    receive() external payable whenNotPaused nonReentrant {
        emit BalanceAdded(msg.sender, msg.value); // T:[AMOF-2]
    }
}

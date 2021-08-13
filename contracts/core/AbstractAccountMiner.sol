// SPDX-License-Identifier: BSL-1.1
// Gearbox. Generalized protocol that allows to get leverage and use it across various DeFi protocols
// (c) Gearbox.fi, 2021
pragma solidity ^0.7.4;
import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {SafeMath} from "@openzeppelin/contracts/math/SafeMath.sol";
import {IAccountMiner} from "../interfaces/IAccountMiner.sol";
import {AddressProvider} from "../configuration/AddressProvider.sol";

import {Constants} from "../libraries/helpers/Constants.sol";
import {Errors} from "../libraries/helpers/Errors.sol";

/// @title Abstract account miner which pays gas compensation from its own funds
abstract contract AbstractAccountMiner is IAccountMiner {
    using SafeMath for uint256;
    using Address for address payable;

    // Account factory address, which set up during creation time
    address public immutable accountFactory;

    constructor(address addressProvider) {
        accountFactory = AddressProvider(addressProvider).getAccountFactory();
    }

    /// @dev Checks that pay compensation was called from account miner contract
    modifier accountFactoryOnly() {
        require(msg.sender == accountFactory, Errors.AM_ACCOUNT_FACTORY_ONLY);
        _;
    }

    /// @dev Pays gas compensation for the user who opens a credit account and deploys a new contract
    function _payGasCompensation(address payable trader) internal {
        trader.sendValue(Constants.DEPLOYMENT_COST); // T: [AMA-19]
    }
}

// SPDX-License-Identifier: UNLICENSED
// Gearbox Protocol. Generalized leverage for DeFi protocols
// (c) Gearbox Holdings, 2021
pragma solidity ^0.7.4;

import {CreditFilter} from "../../credit/CreditFilter.sol";


/// @title Credit Filter Mock for testing CreditFilter
/// @notice provide extra setters for unit-testing
contract CreditFilterMock is CreditFilter {

    constructor(address _addressProvider, address _underlyingToken)
        CreditFilter(_addressProvider, _underlyingToken)
    {}

    function setEnabledTokens(address creditAccount, uint256 tokenMask)
        external
    {
        enabledTokens[creditAccount] = tokenMask;
    }

    function setFastCheckBlock(address creditAccount, uint256 blockNum)
        external
    {
        fastCheckCounter[creditAccount] = blockNum;
    }
}

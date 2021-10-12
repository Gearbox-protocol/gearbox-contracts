// SPDX-License-Identifier: UNLICENSED
// Gearbox. Undercollateralized protocol for margin trading & yield farming focused on gas efficiency.
// (c) Gearbox.fi, 2021
pragma solidity ^0.7.4;

contract ExecutorMock {
    address public calledBy;
    uint256 public value;

    constructor() {
        value = 0;
    }

    function setValue(uint256 _value) external returns (uint256) {
        calledBy = msg.sender;
        value = _value;
        return _value + 1;
    }
}

// SPDX-License-Identifier: UNLICENSED
// Gearbox. Undercollateralized protocol for margin trading & yield farming focused on gas efficiency.
// (c) Gearbox.fi, 2021
pragma solidity ^0.7.4;

/**
 * @title TreasuryMock
 * @notice Just keeps money, used for test purpodes only
 * @author Gearbox
 */
contract TreasuryMock {
    // emits each time when money come
    event NewDonation(uint256 amount);

    receive() external payable {
        emit NewDonation(msg.value);
    }
}

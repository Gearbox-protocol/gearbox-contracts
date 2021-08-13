// SPDX-License-Identifier: BSL-1.1
// Gearbox. Generalized protocol that allows to get leverage and use it across various DeFi protocols
// (c) Gearbox.fi, 2021
pragma solidity ^0.7.4;

interface IAccountMiner {
    /// @dev Pays gas compensation for user
    function mineAccount(address payable user) external;

    /// @dev Returns account miner type
    function kind() external pure returns (bytes32);
}

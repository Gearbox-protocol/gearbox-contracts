// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.7.4;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract GearToken is ERC20, Ownable {
    constructor() ERC20("GEAR", "Gearbox token") {}

    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }
}

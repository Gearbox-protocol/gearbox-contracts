// SPDX-License-Identifier: UNLICENSED
// Gearbox Protocol. Generalized leverage for DeFi protocols
// (c) Gearbox Holdings, 2021
pragma solidity ^0.7.4;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";


contract TokenMock is ERC20, Ownable {
    constructor(string memory name_,
        string memory symbol_) ERC20(name_, symbol_) {
        _mint(msg.sender, 1e24);

    }

    function mint(address to, uint256 amount ) external onlyOwner {
        _mint(to, amount);
    }

}

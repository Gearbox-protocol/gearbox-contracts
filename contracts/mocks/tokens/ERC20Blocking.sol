// SPDX-License-Identifier: UNLICENSED
// Gearbox. Undercollateralized protocol for margin trading & yield farming focused on gas efficiency.
pragma solidity ^0.7.4;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

import "hardhat/console.sol";


contract ERC20BlockingMock is ERC20, Ownable {
    bool public isBlocked;

    constructor(string memory name_, string memory symbol_)
        ERC20(name_, symbol_)
    {
        _mint(msg.sender, 1e24);
        isBlocked = false;
    }

    function blockToken() external {
        isBlocked = true;
    }

    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    function transfer(address recipient, uint256 amount) public  override returns(bool) {
        _transfer(_msgSender(), recipient, amount);
        return !isBlocked;
    }

}

// SPDX-License-Identifier: UNLICENSED
// Gearbox. Undercollateralized protocol for margin trading & yield farming focused on gas efficiency.
pragma solidity ^0.7.4;

import {SafeMath} from "@openzeppelin/contracts/math/SafeMath.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {PercentageMath} from "../../libraries/math/PercentageMath.sol";


contract TokenFeeMock is ERC20, Ownable {
    using SafeMath for uint256;
    uint256 public fee;

    constructor(
        string memory name_,
        string memory symbol_,
        uint256 fee_
    ) ERC20(name_, symbol_) {
        _mint(msg.sender, 1e24);
        fee = fee_;
        require(fee < PercentageMath.PERCENTAGE_FACTOR, "Incorrect fee");
    }

    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    function transfer(address recipient, uint256 amount)
        public
        virtual
        override
        returns (bool)
    {
        _transfer(
            _msgSender(),
            recipient,
            amount.mul(PercentageMath.PERCENTAGE_FACTOR - fee).div(
                PercentageMath.PERCENTAGE_FACTOR
            )
        );
        return true;
    }

    function transferFrom(
        address sender,
        address recipient,
        uint256 amount
    ) public virtual override returns (bool) {
        amount = amount.mul(PercentageMath.PERCENTAGE_FACTOR - fee).div(
            PercentageMath.PERCENTAGE_FACTOR
        );

        return ERC20.transferFrom(sender, recipient, amount);
    }
}

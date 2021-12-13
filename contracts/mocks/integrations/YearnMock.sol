// SPDX-License-Identifier: UNLICENSED
// Gearbox. Undercollateralized protocol for margin trading & yield farming focused on gas efficiency.
// (c) Gearbox.fi, 2021
pragma solidity ^0.7.4;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {SafeMath} from "@openzeppelin/contracts/math/SafeMath.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";

import {IYVault} from "../../integrations/yearn/IYVault.sol";
import {WadRayMath} from "../../libraries/math/WadRayMath.sol";



contract YearnMock is IYVault, ERC20, Ownable {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;
    address public override token;
    uint256 public override pricePerShare;

    mapping(address => bool) public updaters;

    uint256 decimalsMul;

    constructor(address _token)
        ERC20(
            string(abi.encodePacked("yearn ", ERC20(_token).name())),
            string(abi.encodePacked("yv", ERC20(_token).symbol()))
        )
    {
        _setupDecimals(ERC20(_token).decimals());
        token = _token;
        decimalsMul = 10**ERC20.decimals();
        pricePerShare = decimalsMul;
    }

    function addUpdater(address updater) external {
        updaters[updater] = true;
    }

    function deposit() public override returns (uint256) {
        return deposit(IERC20(token).balanceOf(msg.sender));
    }

    function deposit(uint256 _amount) public override returns (uint256) {
        return deposit(_amount, msg.sender);
    }

    function deposit(uint256 _amount, address recipient)
        public
        override
        returns (uint256 shares)
    {
        IERC20(token).safeTransferFrom(msg.sender, address(this), _amount);
        shares = _amount.mul(decimalsMul).div(pricePerShare);
        _mint(recipient, shares);
    }

    function withdraw() external override returns (uint256) {
        return withdraw(balanceOf(msg.sender));
    }

    function withdraw(uint256 maxShares) public override returns (uint256) {
        return withdraw(maxShares, msg.sender);
    }

    function withdraw(uint256 maxShares, address recipient)
        public
        override
        returns (uint256)
    {
        return withdraw(maxShares, recipient, 1);
    }

    function withdraw(
        uint256 maxShares,
        address, // recipient,
        uint256 // maxLoss
    ) public override returns (uint256 amount) {
        _burn(msg.sender, maxShares);
        amount = maxShares.mul(pricePerShare).div(decimalsMul);
        IERC20(token).safeTransfer(msg.sender, amount);
    }

    function setPricePerShare(uint256 newPrice) public {
        require(updaters[msg.sender], "for updaters only");
        pricePerShare = newPrice;
    }

    function name()
        public
        view
        override(IYVault, ERC20)
        returns (string memory)
    {
        return ERC20.name();
    }

    function symbol()
        public
        view
        override(IYVault, ERC20)
        returns (string memory)
    {
        return ERC20.symbol();
    }

    function decimals() public view override(IYVault, ERC20) returns (uint8) {
        return ERC20.decimals();
    }
}

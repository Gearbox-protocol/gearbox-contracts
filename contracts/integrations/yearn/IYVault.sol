pragma solidity ^0.7.4;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IYVault is IERC20 {
    function token() external view returns (address);

    function deposit(uint256 _amount) external;

    function withdraw(uint256 _amount) external;

    function pricePerShare() external view returns (uint256);

    function decimals() external view returns (uint256);
}

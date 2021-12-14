// SPDX-License-Identifier: UNLICENSED
// Gearbox Protocol. Generalized leverage for DeFi protocols
// (c) Gearbox Holdings, 2021
pragma solidity ^0.7.4;

import {SafeMath} from "@openzeppelin/contracts/math/SafeMath.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import {WadRayMath} from "../../libraries/math/WadRayMath.sol";
import {Errors} from "../../libraries/helpers/Errors.sol";

import {ICurvePool} from "../../integrations/curve/ICurvePool.sol";


contract CurveMock is ICurvePool {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;
    address[] public override coins;
    mapping(uint256 => mapping(uint256 => uint256)) rates;

    constructor(address[] memory _coins) {
        coins = _coins;
    }

    function exchange(
        int128 i,
        int128 j,
        uint256 dx,
        uint256 min_dy
    ) external override {
        uint256 dy = get_dy(i, j, dx);

        require(dy >= min_dy, "CurveMock: INSUFFICIENT_OUTPUT_AMOUNT");

        IERC20(coins[uint256(i)]).safeTransferFrom(
            msg.sender,
            address(this),
            dx
        );
        IERC20(coins[uint256(j)]).safeTransfer(msg.sender, dy);
    }

    function exchange_underlying(
        int128, //i,
        int128, //j,
        uint256, // dx,
        uint256 // min_dy
    ) external pure override {
        revert(Errors.NOT_IMPLEMENTED);
    }

    function get_dy_underlying(
        int128, //i,
        int128, //j,
        uint256 //dx
    ) external pure override returns (uint256) {
        revert(Errors.NOT_IMPLEMENTED);
    }

    function get_dy(
        int128 i,
        int128 j,
        uint256 dx
    ) public view override returns (uint256) {
        return rates[uint256(i)][uint256(j)].mul(dx);
    }

    function get_virtual_price() external pure override returns (uint256) {
        revert(Errors.NOT_IMPLEMENTED);
    }
}

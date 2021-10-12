// SPDX-License-Identifier: UNLICENSED
// Gearbox. Undercollateralized protocol for margin trading & yield farming focused on gas efficiency.
// (c) Gearbox.fi, 2021
pragma solidity ^0.7.4;

import {WadRayMath} from "../../libraries/math/WadRayMath.sol";

/**
 * @title WadRayMathTest
 * @dev Helper for testing WadRayMath library
 * @author Gearbox
 */

contract WadRayMathTest {
    using WadRayMath for uint256;
    uint256 constant test = 5;

    /**
     * @return One ray, 1e27
     */
    function ray() external pure returns (uint256) {
        return WadRayMath.ray();
    }

    /**
     * @return One wad, 1e18
     */

    function wad() external pure returns (uint256) {
        return WadRayMath.wad();
    }

    /**
     * @return Half ray, 1e27/2
     */
    function halfRay() external pure returns (uint256) {
        return WadRayMath.halfRay();
    }

    /**
     * @return Half ray, 1e18/2
     */
    function halfWad() external pure returns (uint256) {
        return WadRayMath.halfWad();
    }

    /**
     * @dev Multiplies two wad, rounding half up to the nearest wad
     * @param a Wad
     * @param b Wad
     * @return The result of a*b, in wad
     */
    function wadMul(uint256 a, uint256 b) external pure returns (uint256) {
        return a.wadMul(b);
    }

    /**
     * @dev Divides two wad, rounding half up to the nearest wad
     * @param a Wad
     * @param b Wad
     * @return The result of a/b, in wad
     */
    function wadDiv(uint256 a, uint256 b) external pure returns (uint256) {
        return a.wadDiv(b);
    }

    /**
     * @dev Multiplies two ray, rounding half up to the nearest ray
     * @param a Ray
     * @param b Ray
     * @return The result of a*b, in ray
     */
    function rayMul(uint256 a, uint256 b) external pure returns (uint256) {
        return a.rayMul(b);
    }

    /**
     * @dev Divides two ray, rounding half up to the nearest ray
     * @param a Ray
     * @param b Ray
     * @return The result of a/b, in ray
     */
    function rayDiv(uint256 a, uint256 b) external pure returns (uint256) {
        return a.rayDiv(b);
    }

    /**
     * @dev Casts ray down to wad
     * @param a Ray
     * @return a casted to wad, rounded half up to the nearest wad
     */
    function rayToWad(uint256 a) external pure returns (uint256) {
        return a.rayToWad();
    }

    /**
     * @dev Converts wad up to ray
     * @param a Wad
     * @return a converted in ray
     */
    function wadToRay(uint256 a) external pure returns (uint256) {
        return a.wadToRay();
    }
}

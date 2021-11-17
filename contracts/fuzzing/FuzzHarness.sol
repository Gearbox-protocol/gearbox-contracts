pragma solidity ^0.7.4;
pragma abicoder v2;
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {UniswapRouterMock} from "../mocks/integrations/UniswapMock.sol";
import {WadRayMath} from "../libraries/math/WadRayMath.sol";
import {SafeMath} from "@openzeppelin/contracts/math/SafeMath.sol";

contract FuzzHarness {
    address[] tokens;
    UniswapRouterMock uniswapMock;

    using SafeMath for uint256;
    using WadRayMath for uint256;

    constructor(
        address[] memory _tokens,
        UniswapRouterMock _uniswapMock
    ) {
        for (uint i = 0; i < _tokens.length; i++) {
            tokens.push(_tokens[i]);
        }

        uniswapMock = _uniswapMock;
    }

    function setRate(uint fromTokenIdx, uint toTokenIdx, uint newRatePercent) external {
        fromTokenIdx = fromTokenIdx % tokens.length;
        toTokenIdx = toTokenIdx % tokens.length;

        address from = (tokens[fromTokenIdx]);
        address to = (tokens[toTokenIdx]);

        require (0 <= newRatePercent && newRatePercent <= 200);
        uniswapMock.setRate(from, to, WadRayMath.ray().mul(newRatePercent).div(100));
    }

}
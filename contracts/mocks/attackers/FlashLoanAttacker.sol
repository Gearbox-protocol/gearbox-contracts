// SPDX-License-Identifier: UNLICENSED
// Gearbox Protocol. Generalized leverage for DeFi protocols
// (c) Gearbox Holdings, 2021
pragma solidity ^0.7.4;
pragma abicoder v2;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {CreditManager} from "../../credit/CreditManager.sol";
import {Constants} from "../../libraries/helpers/Constants.sol";
import {DataTypes} from "../../libraries/data/Types.sol";


/**
 * @title Flash Loan Attacker
 * @notice emulates flashloan attack for open / close position in one block
 * Used for testing purposes only
 * @author Gearbox
 */
contract FlashLoanAttacker {
    CreditManager private _creditManager;

    constructor(address creditManager) {
        _creditManager = CreditManager(creditManager);
    }

    /**
     * @dev Tries to open and close credit account in one block
     * @param amount Amount of own funds
     * @param leverage Desired leverage
     */
    function attackClose(
        uint256 amount,
        uint256 leverage,
        DataTypes.Exchange[] calldata paths
    ) external {
        // Approve pool service for operations
        address underlyingToken = _creditManager.underlyingToken();
        IERC20(underlyingToken).approve(
            address(_creditManager),
            Constants.MAX_INT
        );

        _creditManager.openCreditAccount(
            amount,
            payable(address(this)),
            leverage,
            0
        );

        _creditManager.closeCreditAccount(address(this), paths);
    }

    /**
     * @dev Tries to open and close credit account in one block
     * @param amount Amount of own funds
     * @param leverage Desired leverage
     */
    function attackRepay(uint256 amount, uint256 leverage) external {
        // Approve pool service for operations
        address underlyingToken = _creditManager.underlyingToken();
        IERC20(underlyingToken).approve(
            address(_creditManager),
            Constants.MAX_INT
        );

        _creditManager.openCreditAccount(
            amount,
            payable(address(this)),
            leverage,
            0
        );
        _creditManager.repayCreditAccount(address(this));
    }
}

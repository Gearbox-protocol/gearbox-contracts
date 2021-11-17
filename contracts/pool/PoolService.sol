// SPDX-License-Identifier: BSL-1.1
// Gearbox. Generalized leverage protocol that allows to take leverage and then use it across other DeFi protocols and platforms in a composable way.
// (c) Gearbox.fi, 2021
pragma solidity ^0.7.4;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ACLTrait} from "../core/ACLTrait.sol";

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/math/Math.sol";
import {SafeMath} from "@openzeppelin/contracts/math/SafeMath.sol";
import {WadRayMath} from "../libraries/math/WadRayMath.sol";
import {PercentageMath} from "../libraries/math/PercentageMath.sol";

import {IInterestRateModel} from "../interfaces/IInterestRateModel.sol";
import {IPoolService} from "../interfaces/IPoolService.sol";
import {ICreditFilter} from "../interfaces/ICreditFilter.sol";
import {ICreditManager} from "../interfaces/ICreditManager.sol";

import {AddressProvider} from "../core/AddressProvider.sol";
import {DieselToken} from "../tokens/DieselToken.sol";
import {Constants} from "../libraries/helpers/Constants.sol";
import {Errors} from "../libraries/helpers/Errors.sol";

import "hardhat/console.sol";

/// @title Pool Service
/// @notice Encapsulates business logic for:
///  - Adding/removing pool liquidity
///  - Managing diesel tokens & diesel rates
///  - Lend funds to credit manager
///
/// #define currentBorrowRate() uint =
///     let expLiq := expectedLiquidity() in
///     let availLiq := availableLiquidity() in
///         interestRateModel.calcBorrowRate(expLiq, availLiq);
///
/// More: https://dev.gearbox.fi/developers/pools/pool-service
contract PoolService is IPoolService, ACLTrait, ReentrancyGuard {
    using SafeMath for uint256;
    using WadRayMath for uint256;
    using SafeERC20 for IERC20;
    using PercentageMath for uint256;

    // Expected liquidity at last update (LU)
    uint256 public _expectedLiquidityLU;

    // Expected liquidity limit
    uint256 public override expectedLiquidityLimit;

    // Total borrowed amount: https://dev.gearbox.fi/developers/pools/economy/total-borrowed
    uint256 public override totalBorrowed;

    // Address repository
    AddressProvider public addressProvider;

    // Interest rate model
    IInterestRateModel public interestRateModel;

    // Underlying token address
    address public override underlyingToken;

    // Diesel(LP) token address
    address public override dieselToken;

    // Credit managers mapping with permission to borrow / repay
    mapping(address => bool) public override creditManagersCanBorrow;
    mapping(address => bool) public creditManagersCanRepay;

    // Credif managers
    address[] public override creditManagers;

    // Treasury address for tokens
    address public treasuryAddress;

    // Cumulative index in RAY
    uint256 public override _cumulativeIndex_RAY;

    // Current borrow rate in RAY: https://dev.gearbox.fi/developers/pools/economy#borrow-apy
    uint256 public override borrowAPY_RAY;

    // Timestamp of last update
    uint256 public override _timestampLU;

    // Withdraw fee in PERCENTAGE FORMAT
    uint256 public override withdrawFee;

    //
    // CONSTRUCTOR
    //

    /// @dev Constructor
    /// @param _addressProvider Address Repository for upgradable contract model
    /// @param _underlyingToken Address of underlying token
    /// @param _dieselAddress Address of diesel (LP) token
    /// @param _interestRateModelAddress Address of interest rate model
    constructor(
        address _addressProvider,
        address _underlyingToken,
        address _dieselAddress,
        address _interestRateModelAddress,
        uint256 _expectedLiquidityLimit
    ) ACLTrait(_addressProvider) {
        require(
            _addressProvider != address(0) &&
                _underlyingToken != address(0) &&
                _dieselAddress != address(0) &&
                _interestRateModelAddress != address(0),
            Errors.ZERO_ADDRESS_IS_NOT_ALLOWED
        );

        addressProvider = AddressProvider(_addressProvider);

        underlyingToken = _underlyingToken;
        dieselToken = _dieselAddress;
        treasuryAddress = addressProvider.getTreasuryContract();

        _cumulativeIndex_RAY = WadRayMath.RAY; // T:[PS-5]
        updateInterestRateModel(_interestRateModelAddress);
        expectedLiquidityLimit = _expectedLiquidityLimit;
    }

    //
    // LIQUIDITY MANAGEMENT
    //

    /**
     * @dev Adds liquidity to pool
     * - Transfers underlying asset to pool
     * - Mints diesel (LP) token with current diesel rate
     * - Updates expected liquidity
     * - Updates borrow rate
     *
     * More: https://dev.gearbox.fi/developers/pools/pool-service#addliquidity
     *
     * @param amount Amount of tokens to be transfer
     * @param onBehalfOf The address that will receive the diesel tokens, same as msg.sender if the user
     *   wants to receive them on his own wallet, or a different address if the beneficiary of diesel
     * tokens is a different wallet
     * @param referralCode Code used to register the integrator originating the operation, for potential rewards.
     *   0 if the action is executed directly by the user, without any middle-man
     *
     * #if_succeeds {:msg "After addLiquidity() the pool gets the correct amoung of underlyingToken(s)"}
     *      IERC20(underlyingToken).balanceOf(address(this)) == old(IERC20(underlyingToken).balanceOf(address(this))) + amount;
     * #if_succeeds {:msg "After addLiquidity() onBehalfOf gets the right amount of dieselTokens"}
     *      IERC20(dieselToken).balanceOf(onBehalfOf) == old(IERC20(dieselToken).balanceOf(onBehalfOf)) + old(toDiesel(amount));
     * #if_succeeds {:msg "After addLiquidity() borrow rate decreases"}
     *      amount > 0 ==> borrowAPY_RAY <= old(currentBorrowRate());
     * #limit {:msg "Not more than 1 day since last borrow rate update"} block.timestamp <= _timestampLU + 3600 * 24;
     */
    function addLiquidity(
        uint256 amount,
        address onBehalfOf,
        uint256 referralCode
    )
        external
        override
        whenNotPaused // T:[PS-4]
        nonReentrant
    {
        require(onBehalfOf != address(0), Errors.ZERO_ADDRESS_IS_NOT_ALLOWED);

        require(
            expectedLiquidity().add(amount) <= expectedLiquidityLimit,
            Errors.POOL_MORE_THAN_EXPECTED_LIQUIDITY_LIMIT
        ); // T:[PS-31]

        uint256 balanceBefore = IERC20(underlyingToken).balanceOf(
            address(this)
        );

        IERC20(underlyingToken).safeTransferFrom(
            msg.sender,
            address(this),
            amount
        ); // T:[PS-2, 7]

        amount = IERC20(underlyingToken).balanceOf(address(this)).sub(
            balanceBefore
        ); // T:[FT-1]

        DieselToken(dieselToken).mint(onBehalfOf, toDiesel(amount)); // T:[PS-2, 7]

        _expectedLiquidityLU = _expectedLiquidityLU.add(amount); // T:[PS-2, 7]
        _updateBorrowRate(); // T:[PS-2, 7]

        emit AddLiquidity(msg.sender, onBehalfOf, amount, referralCode); // T:[PS-2, 7]
    }

    /**
     * @dev Removes liquidity from pool
     * - Transfers to LP underlying account = amount * diesel rate
     * - Burns diesel tokens
     * - Decreases underlying amount from total_liquidity
     * - Updates borrow rate
     *
     * More: https://dev.gearbox.fi/developers/pools/pool-service#removeliquidity
     *
     * @param amount Amount of tokens to be transfer
     * @param to Address to transfer liquidity
     *
     * #if_succeeds {:msg "For removeLiquidity() sender must have sufficient diesel"}
     *      old(DieselToken(dieselToken).balanceOf(msg.sender)) >= amount;
     * #if_succeeds {:msg "After removeLiquidity() `to` gets the liquidity in underlyingToken(s)"}
     *      (to != address(this) && to != treasuryAddress) ==>
     *          IERC20(underlyingToken).balanceOf(to) == old(IERC20(underlyingToken).balanceOf(to) + (let t:= fromDiesel(amount) in t.sub(t.percentMul(withdrawFee))));
     * #if_succeeds {:msg "After removeLiquidity() treasury gets the withdraw fee in underlyingToken(s)"}
     *      (to != address(this) && to != treasuryAddress) ==>
     *          IERC20(underlyingToken).balanceOf(treasuryAddress) == old(IERC20(underlyingToken).balanceOf(treasuryAddress) + fromDiesel(amount).percentMul(withdrawFee));
     * #if_succeeds {:msg "After removeLiquidity() borrow rate increases"}
     *      (to != address(this) && amount > 0) ==> borrowAPY_RAY >= old(currentBorrowRate());
     * #limit {:msg "Not more than 1 day since last borrow rate update"} block.timestamp <= _timestampLU + 3600 * 24;
     */
    function removeLiquidity(uint256 amount, address to)
        external
        override
        whenNotPaused // T:[PS-4]
        nonReentrant
        returns (uint256)
    {
        require(to != address(0), Errors.ZERO_ADDRESS_IS_NOT_ALLOWED);

        uint256 underlyingTokensAmount = fromDiesel(amount); // T:[PS-3, 8]

        uint256 amountTreasury = underlyingTokensAmount.percentMul(withdrawFee);
        uint256 amountSent = underlyingTokensAmount.sub(amountTreasury);

        IERC20(underlyingToken).safeTransfer(to, amountSent); // T:[PS-3, 34]

        if (amountTreasury > 0) {
            IERC20(underlyingToken).safeTransfer(
                treasuryAddress,
                amountTreasury
            );
        } // T:[PS-3, 34]

        DieselToken(dieselToken).burn(msg.sender, amount); // T:[PS-3, 8]

        _expectedLiquidityLU = _expectedLiquidityLU.sub(underlyingTokensAmount); // T:[PS-3, 8]
        _updateBorrowRate(); // T:[PS-3,8 ]

        emit RemoveLiquidity(msg.sender, to, amount); // T:[PS-3, 8]

        return amountSent;
    }

    /// @dev Returns expected liquidity - the amount of money should be in the pool
    /// if all users close their Credit accounts and return debt
    ///
    /// More: https://dev.gearbox.fi/developers/pools/economy#expected-liquidity
    function expectedLiquidity() public view override returns (uint256) {
        // timeDifference = blockTime - previous timeStamp
        uint256 timeDifference = block.timestamp.sub(uint256(_timestampLU));

        //                                    currentBorrowRate * timeDifference
        //  interestAccrued = totalBorrow *  ------------------------------------
        //                                             SECONDS_PER_YEAR
        //
        uint256 interestAccrued = totalBorrowed
        .mul(borrowAPY_RAY)
        .mul(timeDifference)
        .div(Constants.RAY)
        .div(Constants.SECONDS_PER_YEAR); // T:[PS-29]

        return _expectedLiquidityLU.add(interestAccrued); // T:[PS-29]
    }

    /// @dev Returns available liquidity in the pool (pool balance)
    /// More: https://dev.gearbox.fi/developers/
    function availableLiquidity() public view override returns (uint256) {
        return IERC20(underlyingToken).balanceOf(address(this));
    }

    //
    // CREDIT ACCOUNT LENDING
    //

    /// @dev Lends funds to credit manager and updates the pool parameters
    /// More: https://dev.gearbox.fi/developers/pools/pool-service#lendcreditAccount
    ///
    /// @param borrowedAmount Borrowed amount for credit account
    /// @param creditAccount Credit account address
    ///
    /// #if_succeeds {:msg "After lendCreditAccount() borrow rate increases"}
    ///      borrowedAmount > 0 ==> borrowAPY_RAY >= old(currentBorrowRate());
    /// #limit {:msg "Not more than 1 day since last borrow rate update"} block.timestamp <= _timestampLU + 3600 * 24;
    function lendCreditAccount(uint256 borrowedAmount, address creditAccount)
        external
        override
        whenNotPaused // T:[PS-4]
    {
        require(
            creditManagersCanBorrow[msg.sender],
            Errors.POOL_CONNECTED_CREDIT_MANAGERS_ONLY
        ); // T:[PS-12, 13]

        // Transfer funds to credit account
        IERC20(underlyingToken).safeTransfer(creditAccount, borrowedAmount); // T:[PS-14]

        // Update borrow Rate
        _updateBorrowRate(); // T:[PS-17]

        // Increase total borrowed amount
        totalBorrowed = totalBorrowed.add(borrowedAmount); // T:[PS-16]

        emit Borrow(msg.sender, creditAccount, borrowedAmount); // T:[PS-15]
    }

    /// @dev It's called after credit account funds transfer back to pool and updates corretly parameters.
    /// More: https://dev.gearbox.fi/developers/pools/pool-service#repaycreditAccount
    ///
    /// @param borrowedAmount Borrowed amount (without interest accrued)
    /// @param profit Represents PnL value if PnL > 0
    /// @param loss Represents PnL value if PnL <0
    ///
    /// #if_succeeds {:msg "Cant have both profit and loss"} !(profit > 0 && loss > 0);
    /// #if_succeeds {:msg "After repayCreditAccount() if we are profitabe, or treasury can cover the losses, diesel rate doesn't decrease"}
    ///      (profit > 0 || toDiesel(loss) >= DieselToken(dieselToken).balanceOf(treasuryAddress)) ==> getDieselRate_RAY() >= old(getDieselRate_RAY());
    /// #limit {:msg "Not more than 1 day since last borrow rate update"} block.timestamp <= _timestampLU + 3600 * 24;
    function repayCreditAccount(
        uint256 borrowedAmount,
        uint256 profit,
        uint256 loss
    )
        external
        override
        whenNotPaused // T:[PS-4]
    {
        require(
            creditManagersCanRepay[msg.sender],
            Errors.POOL_CONNECTED_CREDIT_MANAGERS_ONLY
        ); // T:[PS-12]

        // For fee surplus we mint tokens for treasury
        if (profit > 0) {
            // T:[PS-22] provess that diesel rate will be the same within the margin of error
            DieselToken(dieselToken).mint(treasuryAddress, toDiesel(profit)); // T:[PS-21, 22]
            _expectedLiquidityLU = _expectedLiquidityLU.add(profit); // T:[PS-21, 22]
        }
        // If returned money < borrowed amount + interest accrued
        // it tries to compensate loss by burning diesel (LP) tokens
        // from treasury fund
        else {
            uint256 amountToBurn = toDiesel(loss); // T:[PS-19,20]

            uint256 treasuryBalance = DieselToken(dieselToken).balanceOf(
                treasuryAddress
            ); // T:[PS-19,20]

            if (treasuryBalance < amountToBurn) {
                amountToBurn = treasuryBalance;
                emit UncoveredLoss(
                    msg.sender,
                    loss.sub(fromDiesel(treasuryBalance))
                ); // T:[PS-23]
            }

            // If treasury has enough funds, it just burns needed amount
            // to keep diesel rate on the same level
            DieselToken(dieselToken).burn(treasuryAddress, amountToBurn); // T:[PS-19. 20]

            _expectedLiquidityLU = _expectedLiquidityLU.sub(loss); //T:[PS-19,20]
        }

        // Update available liquidity
        _updateBorrowRate(); // T:[PS-19, 20, 21]

        // Reduce total borrowed. Should be after _updateBorrowRate() for correct calculations
        totalBorrowed = totalBorrowed.sub(borrowedAmount); // T:[PS-19, 20]

        emit Repay(msg.sender, borrowedAmount, profit, loss); // T:[PS-18]
    }

    //
    // INTEREST RATE MANAGEMENT
    //

    /**
     * @dev Calculates interest accrued from the last update using the linear model
     *
     *                                    /     currentBorrowRate * timeDifference \
     *  newCumIndex  = currentCumIndex * | 1 + ------------------------------------ |
     *                                    \              SECONDS_PER_YEAR          /
     *
     * @return current cumulative index in RAY
     */
    function calcLinearCumulative_RAY() public view override returns (uint256) {
        //solium-disable-next-line
        uint256 timeDifference = block.timestamp.sub(uint256(_timestampLU)); // T:[PS-28]

        return
            calcLinearIndex_RAY(
                _cumulativeIndex_RAY,
                borrowAPY_RAY,
                timeDifference
            ); // T:[PS-28]
    }

    /// @dev Calculate linear index
    /// @param cumulativeIndex_RAY Current cumulative index in RAY
    /// @param currentBorrowRate_RAY Current borrow rate in RAY
    /// @param timeDifference Duration in seconds
    /// @return newCumulativeIndex Cumulative index accrued duration in Rays
    function calcLinearIndex_RAY(
        uint256 cumulativeIndex_RAY,
        uint256 currentBorrowRate_RAY,
        uint256 timeDifference
    ) public pure returns (uint256) {
        //                                    /     currentBorrowRate * timeDifference \
        //  newCumIndex  = currentCumIndex * | 1 + ------------------------------------ |
        //                                    \              SECONDS_PER_YEAR          /
        //
        uint256 linearAccumulated_RAY = WadRayMath.RAY.add(
            currentBorrowRate_RAY.mul(timeDifference).div(
                Constants.SECONDS_PER_YEAR
            )
        ); // T:[GM-2]

        return cumulativeIndex_RAY.rayMul(linearAccumulated_RAY); // T:[GM-2]
    }

    /// @dev Updates Cumulative index when liquidity parameters are changed
    ///  - compute how much interest were accrued from last update
    ///  - compute new cumulative index based on updated liquidity parameters
    ///  - stores new cumulative index and timestamp when it was updated
    function _updateBorrowRate() internal {
        // Update total _expectedLiquidityLU

        _expectedLiquidityLU = expectedLiquidity(); // T:[PS-27]

        // Update cumulativeIndex
        _cumulativeIndex_RAY = calcLinearCumulative_RAY(); // T:[PS-27]

        // update borrow APY
        borrowAPY_RAY = interestRateModel.calcBorrowRate(
            _expectedLiquidityLU,
            availableLiquidity()
        ); // T:[PS-27]
        _timestampLU = block.timestamp; // T:[PS-27]
    }

    //
    // DIESEL TOKEN MGMT
    //

    /// @dev Returns current diesel rate in RAY format
    /// More info: https://dev.gearbox.fi/developers/pools/economy#diesel-rate
    function getDieselRate_RAY() public view override returns (uint256) {
        uint256 dieselSupply = IERC20(dieselToken).totalSupply();
        if (dieselSupply == 0) return WadRayMath.RAY; // T:[PS-1]
        return expectedLiquidity().mul(Constants.RAY).div(dieselSupply); // T:[PS-6]
    }

    /// @dev Converts amount into diesel tokens
    /// @param amount Amount in underlying tokens to be converted to diesel tokens
    function toDiesel(uint256 amount) public view override returns (uint256) {
        return amount.mul(Constants.RAY).div(getDieselRate_RAY()); // T:[PS-24]
    }

    /// @dev Converts amount from diesel tokens to undelying token
    /// @param amount Amount in diesel tokens to be converted to diesel tokens
    function fromDiesel(uint256 amount) public view override returns (uint256) {
        return amount.mul(getDieselRate_RAY()).div(Constants.RAY); // T:[PS-24]
    }

    //
    // CONFIGURATION
    //

    /// @dev Connects new Credif manager to pool
    /// @param _creditManager Address of credif manager
    function connectCreditManager(address _creditManager)
        external
        configuratorOnly // T:[PS-9]
    {
        require(
            address(this) == ICreditManager(_creditManager).poolService(),
            Errors.POOL_INCOMPATIBLE_CREDIT_ACCOUNT_MANAGER
        ); // T:[PS-10]

        require(
            !creditManagersCanRepay[_creditManager],
            Errors.POOL_CANT_ADD_CREDIT_MANAGER_TWICE
        ); // T:[PS-35]

        creditManagersCanBorrow[_creditManager] = true; // T:[PS-11]
        creditManagersCanRepay[_creditManager] = true; // T:[PS-11]
        creditManagers.push(_creditManager); // T:[PS-11]
        emit NewCreditManagerConnected(_creditManager); // T:[PS-11]
    }

    /// @dev Forbid to borrow for particulat credif manager
    /// @param _creditManager Address of credif manager
    function forbidCreditManagerToBorrow(address _creditManager)
        external
        configuratorOnly // T:[PS-9]
    {
        creditManagersCanBorrow[_creditManager] = false; // T:[PS-13]
        emit BorrowForbidden(_creditManager); // T:[PS-13]
    }

    /// @dev Sets the new interest rate model for pool
    /// @param _interestRateModel Address of new interest rate model contract
    /// #limit {:msg "Disallow updating the interest rate model after the constructor"} address(interestRateModel) == address(0x0);
    function updateInterestRateModel(address _interestRateModel)
        public
        configuratorOnly // T:[PS-9]
    {
        require(
            _interestRateModel != address(0),
            Errors.ZERO_ADDRESS_IS_NOT_ALLOWED
        );
        interestRateModel = IInterestRateModel(_interestRateModel); // T:[PS-25]
        _updateBorrowRate(); // T:[PS-26]
        emit NewInterestRateModel(_interestRateModel); // T:[PS-25]
    }

    /// @dev Sets expected liquidity limit
    /// @param newLimit New expected liquidity limit
    function setExpectedLiquidityLimit(uint256 newLimit)
        external
        configuratorOnly // T:[PS-9]
    {
        expectedLiquidityLimit = newLimit; // T:[PS-30]
        emit NewExpectedLiquidityLimit(newLimit); // T:[PS-30]
    }

    /// @dev Sets withdraw fee
    function setWithdrawFee(uint256 fee)
        public
        configuratorOnly // T:[PS-9]
    {
        require(
            fee < Constants.MAX_WITHDRAW_FEE,
            Errors.POOL_INCORRECT_WITHDRAW_FEE
        ); // T:[PS-32]
        withdrawFee = fee; // T:[PS-33]
        emit NewWithdrawFee(fee); // T:[PS-33]
    }

    /// @dev Returns quantity of connected credit accounts managers
    function creditManagersCount() external view override returns (uint256) {
        return creditManagers.length; // T:[PS-11]
    }

    function calcCumulativeIndexAtBorrowMore(
        uint256 amount,
        uint256 dAmount,
        uint256 cumulativeIndexAtOpen
    ) external view override returns (uint256) {
        return
            calcLinearCumulative_RAY()
                .mul(cumulativeIndexAtOpen)
                .mul(amount.add(dAmount))
                .div(
                calcLinearCumulative_RAY().mul(amount).add(
                    dAmount.mul(cumulativeIndexAtOpen)
                )
            );
    }
}

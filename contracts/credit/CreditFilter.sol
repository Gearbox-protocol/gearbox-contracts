// SPDX-License-Identifier: BSL-1.1
// Gearbox. Generalized protocol that allows to get leverage and use it across various DeFi protocols
// (c) Gearbox.fi, 2021
pragma solidity ^0.7.4;

import {SafeMath} from "@openzeppelin/contracts/math/SafeMath.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {PercentageMath} from "../libraries/math/PercentageMath.sol";

import {ICreditManager} from "../interfaces/ICreditManager.sol";
import {ICreditAccount} from "../interfaces/ICreditAccount.sol";
import {IPriceOracle} from "../interfaces/IPriceOracle.sol";
import {ICreditFilter} from "../interfaces/ICreditFilter.sol";
import {IPoolService} from "../interfaces/IPoolService.sol";

import {AddressProvider} from "../configuration/AddressProvider.sol";
import {ACLTrait} from "../configuration/ACLTrait.sol";
import {Constants} from "../libraries/helpers/Constants.sol";
import {Errors} from "../libraries/helpers/Errors.sol";

import "hardhat/console.sol";

/// @title CreditFilter
/// @notice Implements filter logic for allowed tokens & contract-adapters
///   - Sets/Gets tokens for allowed tokens list
///   - Sets/Gets adapters & allowed contracts
///   - Calculates total value for credit account
///   - Calculates threshold weighted value for credit account
///   - Keeps enabled tokens for credit accounts
///
/// More: https://dev.gearbox.fi/developers/credit/credit-filter
contract CreditFilter is ICreditFilter, ACLTrait {
    using PercentageMath for uint256;
    using SafeMath for uint256;

    // Address of credit Manager
    address public creditManager;

    // Allowed tokens list
    mapping(address => bool) public _allowedTokensMap;

    // Allowed tokens array
    address[] public override allowedTokens;

    // Allowed contracts list
    mapping(address => uint256) public tokenLiquidationThresholds;

    // map token address to its mask
    mapping(address => uint256) public tokenMasksMap;

    // credit account token enables mask. each bit (in order as tokens stored in allowedTokens array) set 1 if token was enable
    mapping(address => uint256) public override enabledTokens;

    // keeps last block we use fast check. Fast check is not allowed to use more than one time in block
    mapping(address => uint256) public fastCheckBlock;

    // Allowed contracts array
    address[] public override allowedContracts;

    // Allowed adapters list
    mapping(address => bool) public allowedAdapters;

    // Mapping from protocols to adapters
    mapping(address => address) public override contractToAdapter;

    // Price oracle - uses in evaluation credit account
    IPriceOracle public immutable _priceOracle;

    // Underlying token address
    address public override underlyingToken;

    // Pooll Service address
    address public poolService;

    // Address of WETH token
    address public wethAddress;

    uint256 public chiThreshold;

    uint256 public fastCheckDelay;

    /// Checks that sender is connected credit manager
    modifier creditManagerOnly {
        require(msg.sender == creditManager, Errors.CF_CREDIT_MANAGERS_ONLY); // T:[CF-20]
        _;
    }

    /// Checks that sender is adapter
    modifier adapterOnly {
        require(allowedAdapters[msg.sender], Errors.CF_ADAPTERS_ONLY); // T:[CF-20]
        _;
    }

    /// Restring any operations after setup is finalised
    modifier duringConfigOnly() {
        require(
            creditManager == address(0),
            Errors.IMMUTABLE_CONFIG_CHANGES_FORBIDDEN
        ); // T:[CF-9,13]
        _;
    }

    constructor(address _addressProvider, address _underlyingToken)
        ACLTrait(_addressProvider)
    {
        _priceOracle = IPriceOracle(
            AddressProvider(_addressProvider).getPriceOracle()
        );

        wethAddress = AddressProvider(_addressProvider).getWethToken(); // T:[CF-21]

        underlyingToken = _underlyingToken; // T:[CF-21]

        allowToken(
            underlyingToken,
            Constants.UNDERLYING_TOKEN_LIQUIDATION_THRESHOLD
        ); // T:[CF-8]

        chiThreshold = Constants.CHI_THRESHOLD; // ToDo: Check
    }

    //
    // STATE-CHANGING FUNCTIONS
    //

    /// @dev Adds token to the list of allowed tokens
    /// @param token Address of allowed token
    /// @param liquidationThreshold The credit Manager constant showing the maximum allowable ratio of Loan-To-Value for the i-th asset.
    function allowToken(address token, uint256 liquidationThreshold)
        public
        override
        configuratorOnly // T:[CF-1]
    {
        require(token != address(0), Errors.ZERO_ADDRESS_IS_NOT_ALLOWED); // T:[CF-2]

        require(
            liquidationThreshold > 0 &&
                liquidationThreshold <=
                Constants.UNDERLYING_TOKEN_LIQUIDATION_THRESHOLD,
            Errors.CF_INCORRECT_LIQUIDATION_THRESHOLD
        ); // T:[CF-3]

        require(allowedTokens.length < 256, Errors.CF_TOO_MUCH_ALLOWED_TOKENS); // T:[CF-5]

        // we add allowed tokens to array if it wasn't added before
        // T:[CF-6] controls that
        if (!_allowedTokensMap[token]) {
            _allowedTokensMap[token] = true; // T:[CF-4]

            tokenMasksMap[token] = 1 << allowedTokens.length; // T:[CF-4]
            allowedTokens.push(token); // T:[CF-4]
        }

        tokenLiquidationThresholds[token] = liquidationThreshold; // T:[CF-4, 6]

        emit TokenAllowed(token, liquidationThreshold); // T:[CF-4]
    }

    /// @dev Adds contract to the list of allowed contracts
    /// @param allowedContract Address of allowed contract
    /// @param adapter Adapter contract address
    function allowContract(address allowedContract, address adapter)
        public
        override
        configuratorOnly // T:[CF-1]
    {
        require(
            allowedContract != address(0),
            Errors.ZERO_ADDRESS_IS_NOT_ALLOWED
        ); // T:[CF-2]

        require(adapter != address(0), Errors.ZERO_ADDRESS_IS_NOT_ALLOWED);

        if (contractToAdapter[allowedContract] == address(0)) {
            allowedContracts.push(allowedContract); // T:[CF-9]
        } else {
            // Remove previous adapter from allowed list
            allowedAdapters[contractToAdapter[allowedContract]] = false; // T:[CF-10]
        }

        allowedAdapters[adapter] = true; // T:[CF-9, 10]
        contractToAdapter[allowedContract] = adapter; // T:[CF-9, 10]

        emit ContractAllowed(allowedContract, adapter); // T:[CF-12]
    }

    /// @dev Connects credit managaer, checks that all needed price feeds exists and finalize config
    function connectCreditManager(address _poolService)
        external
        override
        duringConfigOnly // T:[CF-13]
    {
        creditManager = msg.sender; // T:[CF-14]
        poolService = _poolService; //  T:[CF-14]

        require(
            IPoolService(poolService).underlyingToken() == underlyingToken,
            Errors.CF_UNDERLYING_TOKEN_FILTER_CONFLICT
        ); // T:[CF-16]

        // Check that each token pair has _priceOracle entry
        for (uint256 i = 0; i < allowedTokensCount(); i++) {
            address token = allowedTokens[i];
            _priceOracle.getLastPrice(token, underlyingToken); // T:[CF-15]
        }
    }

    /// @dev Checks the financial order and reverts if tokens aren't in list or collateral protection alerts
    /// @param creditAccount Address of credit account
    /// @param tokenIn Address of token In in swap operation
    /// @param tokenOut Address of token Out in swap operation
    /// @param amountIn Amount of tokens in
    /// @param amountOut Amount of tokens out
    function checkCollateralChange(
        address creditAccount,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOut
    )
        public
        override
        adapterOnly // T:[CF-20]
    {
        _checkAndEnableToken(creditAccount, tokenOut); // T:[CF-22]

        // Convert to WETH is more gas efficient and doesn't make difference for ratio
        uint256 amountInCollateral = _priceOracle.convert(
            amountIn,
            tokenIn,
            wethAddress
        ); // T:[CF-24]

        // Convert to WETH is more gas efficient and doesn't make difference for ratio
        uint256 amountOutCollateral = _priceOracle.convert(
            amountOut,
            tokenOut,
            wethAddress
        ); // T:[CF-24]

        if (
            amountOutCollateral.mul(PercentageMath.PERCENTAGE_FACTOR).div(
                amountInCollateral
            ) >
            chiThreshold &&
            fastCheckBlock[creditAccount] < block.number
        ) {
            fastCheckBlock[creditAccount] = block.number + fastCheckDelay; // T:[CF-24]
        } else {
            // Require Hf > 1
            require(
                calcCreditAccountHealthFactor(creditAccount) >=
                    PercentageMath.PERCENTAGE_FACTOR,
                Errors.CF_OPERATION_LOW_HEALTH_FACTOR
            ); // ToDo: T:[CF-25]
        }
    }

    /// @dev Initializes enabled tokens
    function initEnabledTokens(address creditAccount)
        external
        override
        creditManagerOnly // T:[CF-20]
    {
        // at opening account underlying token is enabled only
        enabledTokens[creditAccount] = 1; // T:[CF-19]
    }

    function checkAndEnableToken(address creditAccount, address token)
        external
        override
        creditManagerOnly // [CF-20]
    {
        _checkAndEnableToken(creditAccount, token); // T:[CF-22, 23]
    }

    function _checkAndEnableToken(address creditAccount, address token)
        internal
    {
        revertIfTokenNotAllowed(token); //T:[CF-22]

        if (enabledTokens[creditAccount] & tokenMasksMap[token] == 0) {
            enabledTokens[creditAccount] =
                enabledTokens[creditAccount] |
                tokenMasksMap[token];
        } // T:[CF-23]
    }

    function setupFastCheckParameters(
        uint256 _chiThreshold,
        uint256 _fastCheckDelay
    )
        external
        configuratorOnly // T:[CF-1]
    {
        require(
            _chiThreshold >= Constants.CHI_THRESHOLD_MIN,
            Errors.CF_INCORRECT_CHI_THRESHOLD
        ); // T:[CF-29]

        require(
            _fastCheckDelay >= Constants.FAST_CHECK_DELAY_MIN,
            Errors.CF_INCORRECT_FAST_CHECK
        ); // ToDo: add check

        chiThreshold = _chiThreshold; // T:[CF-30]
        fastCheckDelay = _fastCheckDelay; // T:[CF-30]
        emit NewFastCheckParameters(_chiThreshold, _fastCheckDelay); // T:[CF-30]
    }

    //
    // GETTERS
    //

    /// @dev Calculates total value for provided address
    /// More: https://dev.gearbox.fi/developers/credit/economy#total-value
    ///
    /// @param creditAccount Token creditAccount address
    function calcTotalValue(address creditAccount)
        external
        view
        override
        returns (uint256 total)
    {
        total = 0; // T:[CF-17]

        uint256 tokenMask;
        for (uint256 i = 0; i < allowedTokensCount(); i++) {
            tokenMask = 1 << i; // T:[CF-17]
            if (enabledTokens[creditAccount] & tokenMask > 0) {
                (, , uint256 tv, ) = getCreditAccountTokenById(
                    creditAccount,
                    i
                );
                total = total.add(tv);
            } // T:[CF-17]
        }
    }

    /// @dev Calculates Threshold Weighted Total Value
    /// More: https://dev.gearbox.fi/developers/credit/economy#threshold-weighted-value
    ///
    /// @param creditAccount Credit account address
    function calcThresholdWeightedValue(address creditAccount)
        public
        view
        override
        returns (uint256 total)
    {
        total = 0;
        uint256 tokenMask;
        for (uint256 i = 0; i < allowedTokensCount(); i++) {
            tokenMask = 1 << i; // T:[CF-18]
            if (enabledTokens[creditAccount] & tokenMask > 0) {
                (, , , uint256 twv) = getCreditAccountTokenById(
                    creditAccount,
                    i
                );
                total = total.add(twv);
            }
        } // T:[CF-18]
        return total.div(PercentageMath.PERCENTAGE_FACTOR); // T:[CF-18]
    }

    /// @dev Returns quantity of tokens in allowed list
    function allowedTokensCount() public view override returns (uint256) {
        return allowedTokens.length; // T:[CF-4, 6]
    }

    /// @dev Returns true if token is in allowed list otherwise false
    function isTokenAllowed(address token) public view override returns (bool) {
        return _allowedTokensMap[token]; // T:[CF-4, 6]
    }

    /// @dev Reverts if token isn't in token allowed list
    function revertIfTokenNotAllowed(address token) public view override {
        require(isTokenAllowed(token), Errors.CF_TOKEN_IS_NOT_ALLOWED); // T:[CF-7]
    }

    /// @dev Returns quantity of contracts in allowed list
    function allowedContractsCount() public view override returns (uint256) {
        return allowedContracts.length; // T:[CF-9]
    }

    /// @dev Reverts if adapter isn't in allowed contract list
    function revertIfAdapterNotAllowed(address adapter) public view override {
        require(allowedAdapters[adapter], Errors.CF_ADAPTERS_ONLY); // T:[CF-11]
    }

    /// @dev Returns address & balance of token by the id of allowed token in the list
    /// @param creditAccount Credit account address
    /// @param id Id of token in allowed list
    /// @return token Address of token
    /// @return balance Token balance
    /// @return tv Balance converted to undelying asset using price oracle
    /// @return tvw Balance converted to undelying asset using price oracle multipled with liquidation threshold
    function getCreditAccountTokenById(address creditAccount, uint256 id)
        public
        view
        override
        returns (
            address token,
            uint256 balance,
            uint256 tv,
            uint256 tvw
        )
    {
        token = allowedTokens[id]; // T:[CF-28]
        balance = IERC20(token).balanceOf(creditAccount); // T:[CF-28]

        // balance ==0 : T: [CF-28]
        if (balance > 1) {
            tv = _priceOracle.convert(balance, token, underlyingToken); // T:[CF-28]
            tvw = tv.mul(tokenLiquidationThresholds[token]); // T:[CF-28]
        }
    }

    /// @dev Calculates credit account interest accrued
    /// More: https://dev.gearbox.fi/developers/credit/economy#interest-rate-accrued
    ///
    /// @param creditAccount Credit account address
    function calcCreditAccountAccruedInterest(address creditAccount)
        public
        view
        override
        returns (uint256)
    {
        uint256 borrowedAmount = ICreditAccount(creditAccount).borrowedAmount(); // T: [CF-26]

        return
            borrowedAmount
                .mul(IPoolService(poolService).calcLinearCumulative_RAY())
                .div(ICreditAccount(creditAccount).cumulativeIndexAtOpen()); // T: [CF-26]
    }

    /**
     * @dev Calculates health factor for the credit account
     *
     *         sum(asset[i] * liquidation threshold[i])
     *   Hf = --------------------------------------------
     *             borrowed amount + interest accrued
     *
     *
     * More info: https://dev.gearbox.fi/developers/credit/economy#health-factor
     *
     * @param creditAccount Credit account address
     * @return Health factor in percents (see PERCENTAGE FACTOR in PercentageMath.sol)
     */
    function calcCreditAccountHealthFactor(address creditAccount)
        public
        view
        override
        returns (uint256)
    {
        return
            calcThresholdWeightedValue(creditAccount)
                .mul(PercentageMath.PERCENTAGE_FACTOR)
                .div(calcCreditAccountAccruedInterest(creditAccount)); // T:[CF-27]
    }
}

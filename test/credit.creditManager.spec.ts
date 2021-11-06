// @ts-ignore
import { ethers, waffle } from "hardhat";
import { expect } from "../utils/expect";

import {
  CreditFilter,
  CreditFilter__factory,
  CreditFilterMock,
  CreditManager,
  CreditManager__factory,
  DieselToken,
  Errors,
  ICreditAccount__factory,
  MockPoolService,
  TokenMock,
} from "../types/ethers-v5";
import { CoreDeployer } from "../deployer/coreDeployer";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { PoolDeployer } from "../deployer/poolDeployer";
import { IntegrationsDeployer } from "../deployer/integrationsDeployer";
import { TestDeployer } from "../deployer/testDeployer";
import {
  DEFAULT_CREDIT_MANAGER,
  DUMB_ADDRESS,
  FEE_INTEREST,
  FEE_LIQUIDATION,
  LIQUIDATION_DISCOUNTED_SUM,
  PAUSABLE_REVERT_MSG,
  UNDERLYING_TOKEN_LIQUIDATION_THRESHOLD,
} from "../core/constants";
import { BigNumber } from "ethers";
import { PoolTestSuite } from "../deployer/poolTestSuite";
import { CreditManagerTestSuite } from "../deployer/creditManagerTestSuite";
import {
  ADDRESS_0x0,
  LEVERAGE_DECIMALS,
  MAX_INT,
  PERCENTAGE_FACTOR,
  percentMul,
  RAY,
  WAD,
} from "@diesellabs/gearbox-sdk";
import { UniswapModel } from "../model/uniswapModel";
import { PoolServiceModel } from "../model/poolService";

const { userInitBalance, addLiquidity } = PoolTestSuite;

const {
  uniswapInitBalance,
  swapAmountA,
  amount,
  leverageFactor,
  borrowedAmount,
  maxLeverage,
  referral,
  closeSlippage,
} = CreditManagerTestSuite;

describe("CreditManager", function () {
  let ts: CreditManagerTestSuite;

  let deployer: SignerWithAddress;
  let coreDeployer: CoreDeployer;
  let integrationsDeployer: IntegrationsDeployer;
  let poolDeployer: PoolDeployer;
  let testDeployer: TestDeployer;

  let poolService: MockPoolService;
  let creditManager: CreditManager;
  let creditFilter: CreditFilterMock;

  let liquidityProvider: SignerWithAddress;
  let user: SignerWithAddress;
  let liquidator: SignerWithAddress;
  let friend: SignerWithAddress;

  let dieselToken: DieselToken;
  let underlyingToken: TokenMock;
  let tokenA: TokenMock;
  let errors: Errors;

  beforeEach(async () => {
    ts = new CreditManagerTestSuite();
    await ts.getSuite();
    await ts.usePoolMockForCreditManager();
    await ts.setupCreditManager();

    deployer = ts.deployer;
    coreDeployer = ts.coreDeployer;
    integrationsDeployer = ts.integrationsDeployer;
    poolDeployer = ts.poolDeployer;
    testDeployer = ts.testDeployer;

    poolService = ts.mockPoolService;
    creditManager = ts.creditManager;
    creditFilter = ts.creditFilter as unknown as CreditFilterMock;

    liquidityProvider = ts.liquidityProvider;
    user = ts.user;
    liquidator = ts.liquidator;
    friend = ts.friend;

    dieselToken = ts.dieselToken;
    underlyingToken = ts.underlyingToken;
    tokenA = ts.tokenA;
    errors = ts.errors;

    // Send my to be able for lending
    await underlyingToken
      .connect(liquidityProvider)
      .transfer(poolService.address, addLiquidity);
  });

  it("[CM-1]: constructor set parameters correctly", async () => {
    const [poolContract, cfContract, wtContract, wgContract, dsContract] =
      await Promise.all([
        creditManager.poolService(),
        creditManager.creditFilter(),
        creditManager.wethAddress(),
        creditManager.wethGateway(),
        creditManager.defaultSwapContract(),
      ]);

    const poolExpected = poolService.address;
    expect(poolContract, "PoolService").to.be.eq(poolExpected);

    const cfExpected = creditFilter.address;
    expect(cfContract, "CreditFilter").to.be.eq(cfExpected);

    const wtExpectted = await coreDeployer.getWethTokenAddress();
    expect(wtContract, "WETHToken").to.be.eq(wtExpectted);

    const wgExpected = await coreDeployer.getWETHGateway();
    expect(wgContract, "WETHGateway").to.be.eq(wgExpected.address);

    const dsExpected = await ts.integrationsDeployer.getUniswapMock();
    expect(dsContract, "DefaultSwap").to.be.eq(dsExpected.address);

    const [
      maxLeverageFactor,
      minHeathFactor,
      minAmount,
      maxAmount,
      feeInterest,
      feeLiquidation,
      liquidationDiscount,
    ] = await Promise.all([
      creditManager.maxLeverageFactor(),
      creditManager.minHealthFactor(),
      creditManager.minAmount(),
      creditManager.maxAmount(),
      creditManager.feeInterest(),
      creditManager.feeLiquidation(),
      creditManager.liquidationDiscount(),
    ]);

    expect(maxLeverageFactor, "MaxLeverageFactor").to.be.eq(maxLeverage);

    const mhfExpected = Math.floor(
      (UNDERLYING_TOKEN_LIQUIDATION_THRESHOLD * (maxLeverage + 100)) /
        maxLeverage
    );

    expect(minHeathFactor, "minHealthFactor").to.be.eq(mhfExpected);
    expect(minAmount, "minAmount").to.be.eq(DEFAULT_CREDIT_MANAGER.minAmount);
    expect(maxAmount, "maxAmount").to.be.eq(DEFAULT_CREDIT_MANAGER.maxAmount);
    expect(feeInterest.toNumber(), "FEE_INTEREST").to.be.eq(FEE_INTEREST);
    expect(feeLiquidation.toNumber(), "FEE_LIQUIDATION").to.be.eq(
      FEE_LIQUIDATION
    );

    expect(
      liquidationDiscount.toNumber(),
      "LIQUIDATION_DISCOUNTED_SUM"
    ).to.be.eq(LIQUIDATION_DISCOUNTED_SUM);
  });

  it("[CM-2]: openCreditAccount reverts if amount < minAmount or amount > maxAmount", async () => {
    const revertMsg = await errors.CM_INCORRECT_PARAMS();
    // Adding liquidity
    const minAmount = await creditManager.minAmount();
    // Open trader account
    await expect(
      creditManager
        .connect(user)
        .openCreditAccount(
          minAmount.sub(1),
          user.address,
          LEVERAGE_DECIMALS * (maxLeverage - 1),
          referral
        )
    ).to.be.revertedWith(revertMsg);

    const maxAmount = await creditManager.maxAmount();
    // Open trader account
    await expect(
      creditManager
        .connect(user)
        .openCreditAccount(
          maxAmount.add(1),
          user.address,
          LEVERAGE_DECIMALS * (maxLeverage - 1),
          referral
        )
    ).to.be.revertedWith(revertMsg);

    // Open trader account
    await expect(
      creditManager
        .connect(user)
        .openCreditAccount(
          maxAmount.add(1),
          user.address,
          LEVERAGE_DECIMALS * (maxLeverage + 1),
          referral
        )
    ).to.be.revertedWith(revertMsg);
  });

  it("[CM-3]: openCreditAccount reverts if user has already opened account or provide zero addreess as onBelafOn", async () => {
    const revertMsg =
      await errors.CM_ZERO_ADDRESS_OR_USER_HAVE_ALREADY_OPEN_CREDIT_ACCOUNT();

    // Open trader account
    await creditManager
      .connect(user)
      .openCreditAccount(amount, user.address, leverageFactor, referral);

    await expect(
      creditManager
        .connect(user)
        .openCreditAccount(amount, user.address, leverageFactor, referral)
    ).to.be.revertedWith(revertMsg);

    await expect(
      creditManager
        .connect(user)
        .openCreditAccount(amount, ADDRESS_0x0, leverageFactor, referral)
    ).to.be.revertedWith(revertMsg);
  });

  it("[CM-4]: openCreditAccount reverts if leverage > maxLeverage or leverage = 0", async () => {
    const revertMsg = await errors.CM_INCORRECT_PARAMS();

    // Open trader account
    await expect(
      creditManager
        .connect(user)
        .openCreditAccount(
          amount,
          user.address,
          LEVERAGE_DECIMALS * (maxLeverage + 1),
          referral
        )
    ).to.be.revertedWith(revertMsg);

    // Open trader account
    await expect(
      creditManager
        .connect(user)
        .openCreditAccount(amount, user.address, 0, referral)
    ).to.be.revertedWith(revertMsg);
  });

  it("[CM-5]: openCreditAccount sets correct general credit account parameters and enable tokens", async () => {
    // Open trader account
    const receipt = await creditManager
      .connect(user)
      .openCreditAccount(amount, user.address, leverageFactor, referral);

    await testDeployer.getCreditAccount(
      await creditManager.creditAccounts(user.address)
    );

    const [borrowedAmountReal, ciAtOpen, since] =
      await ts.getCreditAccountParameters(user.address);

    expect(borrowedAmountReal, "borrowedAmount").to.be.eq(borrowedAmount);
    expect(ciAtOpen, "cumulativeIndexAtOpen").to.be.eq(
      await poolService.calcLinearCumulative_RAY({
        blockTag: receipt.blockNumber,
      })
    );
    expect(since, "since").to.be.eq(receipt.blockNumber); // last block

    const caAddress = await creditManager.getCreditAccountOrRevert(
      user.address
    );
    const enabledTokens = await creditFilter.enabledTokens(caAddress);

    expect(enabledTokens, "enabledTokens").to.be.eq(1);
  });

  it("[CM-6]: openCreditAccount transfers correct amount of user tokens to new credit account", async () => {
    const smallAmount = 1e6;

    // Open trader account
    const openTx = () =>
      creditManager
        .connect(user)
        .openCreditAccount(smallAmount, user.address, leverageFactor, referral);

    await expect(openTx).to.changeTokenBalance(
      underlyingToken,
      user,
      -smallAmount
    );

    expect(await underlyingToken.balanceOf(user.address)).to.be.eq(
      userInitBalance.sub(smallAmount)
    );
  });

  it("[CM-7]: openCreditAccount transfers correct amount of pool tokens to new credit account", async () => {
    const smallAmount = 1e6;
    const smallBorrowedAmount =
      (smallAmount * leverageFactor) / LEVERAGE_DECIMALS;

    // Open trader account
    await creditManager
      .connect(user)
      .openCreditAccount(smallAmount, user.address, leverageFactor, referral);

    const creditAccountAddress = await creditManager.creditAccounts(
      user.address
    );
    expect(await poolService.lendAmount()).to.be.eq(smallBorrowedAmount);
    expect(await poolService.lendAccount()).to.be.eq(creditAccountAddress);
  });

  it("[CM-8]: openCreditAccount emits correct OpenCreditAccount", async () => {
    const accountFactory = await coreDeployer.getAccountFactory();

    // it should be next container which'll be taken
    const nextVA = await accountFactory.head();

    // Open trader account
    await expect(
      creditManager
        .connect(user)
        .openCreditAccount(amount, user.address, leverageFactor, referral)
    )
      .to.emit(creditManager, "OpenCreditAccount")
      .withArgs(
        user.address,
        user.address,
        nextVA,
        amount,
        borrowedAmount,
        referral
      );
  });

  it("[CM-9]: getCreditAccountOrRevert, closeCreditAccount, addCollateral, increaseBorrowAmount, liquidateAccount reverts for user who has no opened credit account", async () => {
    const revertMsg = await errors.CM_NO_OPEN_ACCOUNT();

    await expect(
      creditManager.connect(user).getCreditAccountOrRevert(user.address)
    ).to.revertedWith(revertMsg);

    await expect(
      creditManager.connect(user).closeCreditAccount(user.address, [])
    ).to.revertedWith(revertMsg);

    await expect(
      creditManager.connect(user).addCollateral(user.address, DUMB_ADDRESS, 0)
    ).to.revertedWith(revertMsg);

    await expect(
      creditManager.connect(user).increaseBorrowedAmount(10)
    ).to.revertedWith(revertMsg);

    await expect(
      creditManager
        .connect(deployer)
        .liquidateCreditAccount(user.address, friend.address, false)
    ).to.revertedWith(revertMsg);

    await creditFilter
      .connect(deployer)
      .allowContract(DUMB_ADDRESS, deployer.address);

    await expect(
      creditManager
        .connect(deployer)
        .executeOrder(DUMB_ADDRESS, DUMB_ADDRESS, DUMB_ADDRESS)
    ).to.revertedWith(revertMsg);
  });

  // CLOSE ACCOUNT

  it("[CM-10]: closeCreditAccount emits CloseCreditAccount correctly", async () => {
    // Open default credit account
    await ts.openDefaultCreditAccount();

    const [, ciAtOpen] = await ts.getCreditAccountParameters(user.address);

    const ciAtClose = RAY.mul(102).div(100);
    await poolService.setCumulative_RAY(ciAtClose);

    const borrowedAmountWithInterest =
      PoolServiceModel.getBorrowedAmountWithInterest(
        borrowedAmount,
        ciAtClose,
        ciAtOpen
      );

    // user balance = amount + borrowed amount
    const fee = percentMul(
      borrowedAmountWithInterest.sub(borrowedAmount),
      FEE_INTEREST
    );

    const remainingFunds = amount
      .add(borrowedAmount)
      .sub(borrowedAmountWithInterest)
      .sub(fee)
      .sub(1); // 1 for Michael Egorov gas efficiency trick

    const closePath = await ts.getClosePath(user.address, 0);

    await expect(
      creditManager.connect(user).closeCreditAccount(friend.address, closePath)
    )
      .to.emit(creditManager, "CloseCreditAccount")
      .withArgs(user.address, friend.address, remainingFunds);
  });

  it("[CM-11]: closeCreditAccount repay pool & transfer remaining funds to borrower account correctly", async () => {
    await ts.openDefaultCreditAccount();

    const poolBalanceBefore = await poolService.availableLiquidity();

    const [, ciAtOpen] = await ts.getCreditAccountParameters(user.address);

    const ciAtClose = RAY.mul(102).div(100);
    await poolService.setCumulative_RAY(ciAtClose);

    const closePath = await ts.getClosePath(user.address, closeSlippage);

    await creditManager
      .connect(user)
      .closeCreditAccount(friend.address, closePath);

    const borrowedAmountWithInterest =
      PoolServiceModel.getBorrowedAmountWithInterest(
        borrowedAmount,
        ciAtClose,
        ciAtOpen
      );

    const fee = percentMul(
      borrowedAmountWithInterest.sub(borrowedAmount),
      FEE_INTEREST
    );

    const remainingFunds = amount
      .add(borrowedAmount)
      .sub(borrowedAmountWithInterest)
      .sub(fee);

    expect(await poolService.repayAmount(), "Incorrect repay amount").to.be.eq(
      borrowedAmount
    );
    expect(await poolService.repayProfit(), "Incorrectly profit").to.be.eq(fee);
    expect(await poolService.repayLoss(), "Incorrect loss").to.be.eq(0);

    expect(
      await poolService.availableLiquidity(),
      "Pool balance updated incorrectly"
    ).to.be.eq(poolBalanceBefore.add(borrowedAmountWithInterest).add(fee));

    expect(
      await underlyingToken.balanceOf(friend.address),
      "Remaining funds sent incorrectly"
    ).to.be.eq(
      remainingFunds.sub(1) // Michael Egorov efficiency trick
    );
  });

  // LIQUIDATE ACCOUNT

  it("[CM-12]: liquidateCreditAccount reverts for borrower who has no opened credit account", async () => {
    const revertMsg = await errors.CM_NO_OPEN_ACCOUNT();
    await expect(
      creditManager
        .connect(friend)
        .liquidateCreditAccount(user.address, friend.address, false)
    ).to.revertedWith(revertMsg);
  });

  it("[CM-13]: liquidateCreditAccount works with health factor <1 and emits correct event", async () => {
    const borrowedAmountWithInterest = await ts.liquidationSetup();

    const totalFunds = amount
      .add(borrowedAmount)
      .mul(LIQUIDATION_DISCOUNTED_SUM)
      .div(PERCENTAGE_FACTOR);

    const fee = percentMul(totalFunds, FEE_LIQUIDATION);

    // Minus liquidation Premium(!)
    const remainingFunds = totalFunds
      .sub(borrowedAmountWithInterest)
      .sub(fee)
      .sub(1); // Michael Egorov gas optimisation

    await expect(
      creditManager
        .connect(liquidator)
        .liquidateCreditAccount(user.address, friend.address, false)
    )
      .to.emit(creditManager, "LiquidateCreditAccount")
      .withArgs(user.address, liquidator.address, remainingFunds);
  });

  it("[CM-14]: liquidateCreditAccount takes amountToPool from and transfers all tokens to liquidator", async () => {
    // Send my to be able for lending

    for (const pnl of [false, true]) {
      const borrowedAmountWithInterest = await ts.liquidationSetup(pnl);

      const initLiquidatorBalance = await underlyingToken.balanceOf(
        liquidator.address
      );
      const initFriendBalance = await underlyingToken.balanceOf(friend.address);

      const receipt = await creditManager
        .connect(liquidator)
        .liquidateCreditAccount(user.address, friend.address, false);

      await receipt.wait();

      const expectedLiquidationAmount = amount
        .add(borrowedAmount)
        .mul(LIQUIDATION_DISCOUNTED_SUM)
        .div(PERCENTAGE_FACTOR)
        .sub(1);

      expect(
        await creditManager.calcRepayAmount(user.address, true, {
          // @ts-ignore
          blockTag: receipt.blockNumber - 1,
        })
      ).to.be.eq(expectedLiquidationAmount);

      expect(
        await underlyingToken.balanceOf(liquidator.address),
        `Incorrect sum transferred from liquidator ${pnl ? "PROFIT" : "LOSS"}`
      ).to.be.eq(initLiquidatorBalance.sub(expectedLiquidationAmount));

      expect(
        await underlyingToken.balanceOf(friend.address),
        `Incorrect amount sent from credit account for ${
          pnl ? "PROFIT" : "LOSS"
        }`
      ).to.be.eq(initFriendBalance.add(amount).add(borrowedAmount).sub(1));
    }
  });

  it("[CM-15]: liquidateCreditAccount correctly updates repay pool", async () => {
    // Send my to be able for lending

    for (const pnl of [true, false]) {
      const borrowedAmountWithInterest = await ts.liquidationSetup(pnl);

      await creditManager
        .connect(liquidator)
        .liquidateCreditAccount(user.address, friend.address, false);

      const totalFunds = amount
        .add(borrowedAmount)
        .mul(LIQUIDATION_DISCOUNTED_SUM)
        .div(PERCENTAGE_FACTOR)
        .sub(1);

      const fee = percentMul(totalFunds, FEE_LIQUIDATION);

      const amountToPool = pnl
        ? borrowedAmountWithInterest.add(fee)
        : totalFunds;

      const p = amountToPool.sub(borrowedAmountWithInterest);
      const profit = pnl ? p : 0;
      const loss = pnl ? 0 : -p;

      expect(
        await poolService.repayAmount(),
        `Incorrect borrowed amount ${pnl ? "PROFIT" : "LOSS"}`
      ).to.be.eq(borrowedAmount);
      expect(
        await poolService.repayProfit(),
        `Incorrect profit ${pnl ? "PROFIT" : "LOSS"}`
      ).to.be.eq(profit);
      expect(
        await poolService.repayLoss(),
        `Incorrect loss ${pnl ? "PROFIT" : "LOSS"}`
      ).to.be.eq(loss);
    }
  });

  it("[CM-16]: liquidateCreditAccount reverts for Hf>=1", async () => {
    const revertMsg = await errors.CM_CAN_LIQUIDATE_WITH_SUCH_HEALTH_FACTOR();

    await underlyingToken.mint(liquidator.address, userInitBalance);
    await underlyingToken
      .connect(liquidator)
      .approve(creditManager.address, MAX_INT);

    await ts.liquidationSetup();

    const [, ciAtOpen] = await ts.getCreditAccountParameters(user.address);

    const ciLiquidation = BigNumber.from(
      UNDERLYING_TOKEN_LIQUIDATION_THRESHOLD * (100 + leverageFactor)
    )
      .mul(ciAtOpen)
      .div(PERCENTAGE_FACTOR * leverageFactor);

    await poolService.setCumulative_RAY(ciLiquidation);

    const va = await creditManager.creditAccounts(user.address);

    expect(
      await creditFilter.calcCreditAccountHealthFactor(va),
      "Hf != 1"
    ).to.be.eq(PERCENTAGE_FACTOR);

    await expect(
      creditManager
        .connect(friend)
        .liquidateCreditAccount(user.address, friend.address, false)
    ).to.revertedWith(revertMsg);
  });

  // REPAY ACCOUNT

  it("[CM-17]: repayCreditAccount takes correct amount from borrower and send assets to provided account", async () => {
    await ts.openDefaultCreditAccount();

    const [ba, ciAtOpen] = await ts.getCreditAccountParameters(user.address);

    const creditAccount = await creditManager.creditAccounts(user.address);
    await tokenA.mint(creditAccount, uniswapInitBalance);

    const ciAtClose = RAY.mul(102).div(100);
    await poolService.setCumulative_RAY(ciAtClose);

    const friendBalanceBefore = await underlyingToken.balanceOf(friend.address);

    await creditFilter.setEnabledTokens(creditAccount, MAX_INT);

    const receipt = await creditManager
      .connect(user)
      .repayCreditAccount(friend.address);

    const borrowedAmountWithInterest =
      PoolServiceModel.getBorrowedAmountWithInterest(ba, ciAtClose, ciAtOpen);

    const tokenAamountConverted = await ts.priceOracle.convert(
      uniswapInitBalance,
      tokenA.address,
      underlyingToken.address
    );

    const fee = percentMul(borrowedAmountWithInterest.sub(ba), FEE_INTEREST);

    const repayCost = borrowedAmountWithInterest.add(fee);

    expect(
      await creditManager.calcRepayAmount(user.address, false, {
        // @ts-ignore
        blockTag: receipt.blockNumber - 1,
      }),
      "Incorrect repay cost"
    ).to.be.eq(repayCost);

    expect(
      await underlyingToken.balanceOf(user.address),
      "Incorrect user balance"
    ).to.be.eq(userInitBalance.sub(amount).sub(repayCost));

    expect(
      await underlyingToken.balanceOf(friend.address),
      "Friend balance"
    ).to.be.eq(friendBalanceBefore.add(amount).add(borrowedAmount).sub(1));

    expect(
      await tokenA.balanceOf(friend.address),
      "Friend tokenA balance"
    ).to.be.eq(uniswapInitBalance.sub(1)); // we take 1 for Michael Egorov optimisation
  });

  it("[CM-18]: repayCreditAccount emits event correctly", async () => {
    await ts.openDefaultCreditAccount();

    await expect(creditManager.connect(user).repayCreditAccount(friend.address))
      .to.emit(creditManager, "RepayCreditAccount")
      .withArgs(user.address, friend.address);
  });

  it("[CM-19]: repayCreditAccount reverts for user who has no opened credit account", async () => {
    const revertMsg = await errors.CM_NO_OPEN_ACCOUNT();
    await expect(
      creditManager.connect(user).repayCreditAccount(user.address)
    ).to.revertedWith(revertMsg);
  });

  // This statement protects protocol from FlashLoan attack
  it("[CM-20]: closeCreditAccount, repayCreditAccount reverts if called the same block as OpenCreditAccount", async () => {
    const revertMsg =
      await errors.AF_CANT_CLOSE_CREDIT_ACCOUNT_IN_THE_SAME_BLOCK();

    const flashLoanAttacker = await testDeployer.getFlashLoanAttacker(
      creditManager.address
    );

    await underlyingToken.mint(flashLoanAttacker.address, userInitBalance);

    const tokensQty = await creditFilter.allowedTokensCount();
    const paths: Array<{ path: Array<string>; amountOutMin: BigNumber }> = [];
    for (let i = 0; i < tokensQty.toNumber(); i++) {
      paths.push({
        path: [await creditFilter.allowedTokens(i), underlyingToken.address],
        amountOutMin: WAD,
      });
    }

    await expect(
      flashLoanAttacker.attackClose(amount, leverageFactor, paths),
      "Error during close attack"
    ).to.revertedWith(revertMsg);

    await expect(
      flashLoanAttacker.attackRepay(amount, leverageFactor),
      "Error during repay attack"
    ).to.revertedWith(revertMsg);
  });

  it("[CM-21]: repayCreditAccount returns credit account to factory", async () => {
    const accountFactory = await coreDeployer.getAccountFactory();

    await ts.openDefaultCreditAccount();

    const creditAccount = await creditManager.creditAccounts(user.address);

    const accountsCount = await accountFactory.countCreditAccountsInStock();

    await creditManager.connect(user).repayCreditAccount(friend.address);

    expect(await accountFactory.countCreditAccountsInStock()).to.be.eq(
      accountsCount.add(1)
    );
    expect(await accountFactory.tail()).to.be.eq(creditAccount);
  });

  it("[CM-22]: liquidateCreditAccount convert WETH to ETH when tranferring them to liquidatror", async () => {
    await ts.liquidationSetup(false);
    const creditAccount = await creditManager.creditAccounts(user.address);

    const wethMock = await coreDeployer.getWETHMock();
    const ethBalance = 10;
    await wethMock.deposit({ value: ethBalance });
    const wethToken = await ts.coreDeployer.getWETHMock();
    await wethToken.mint(creditAccount, ethBalance);

    const friendBalance = await friend.getBalance();

    await creditFilter.setEnabledTokens(creditAccount, MAX_INT);

    await creditManager
      .connect(liquidator)
      .liquidateCreditAccount(user.address, friend.address, false);

    expect(await friend.getBalance()).to.be.eq(
      friendBalance.add(ethBalance).sub(1)
    );
  });

  it("[CM-23]: repayCreditAccount convert WETH to ETH when transferring them", async () => {
    await ts.openDefaultCreditAccount();
    const creditAccount = await creditManager.creditAccounts(user.address);

    const wethMock = await coreDeployer.getWETHMock();
    const ethBalance = 10;
    await wethMock.deposit({ value: ethBalance });
    const wethToken = await ts.coreDeployer.getWETHMock();
    await wethToken.mint(creditAccount, ethBalance);

    const friendBalance = await friend.getBalance();

    await creditFilter.setEnabledTokens(creditAccount, MAX_INT);

    await creditManager.connect(user).repayCreditAccount(friend.address);

    expect(await friend.getBalance()).to.be.eq(
      friendBalance.add(ethBalance).sub(1)
    );
  });

  it("[CM-26]: hasOpenedCreditAccount works correctly", async () => {
    // Open trader account
    expect(await creditManager.hasOpenedCreditAccount(user.address)).to.be
      .false;
    // Open trader account
    await creditManager
      .connect(user)
      .openCreditAccount(amount, user.address, leverageFactor, referral);
    expect(await creditManager.hasOpenedCreditAccount(user.address)).to.be.true;
  });

  it("[CM-27]: closeCreditAccount remove hasOpenedAccount property", async () => {
    // Open default credit account
    await ts.openDefaultCreditAccount();
    const closePath = await ts.getClosePath(user.address, closeSlippage);
    await creditManager
      .connect(user)
      .closeCreditAccount(friend.address, closePath);
    expect(await creditManager.hasOpenedCreditAccount(user.address)).to.be
      .false;
  });

  // INCREASE BORROW AMOUNT

  it("[CM-28]: increaseBorrowedAmountCreditAccount reverts of health factor < Constants.HEALTH_FACTOR_MIN_AFTER_UPDATE", async () => {
    await ts.openDefaultCreditAccount();

    const revertMsg = await errors.CM_CAN_UPDATE_WITH_SUCH_HEALTH_FACTOR();

    const thresholdWeightedAmount = percentMul(
      amount.add(borrowedAmount),
      UNDERLYING_TOKEN_LIQUIDATION_THRESHOLD
    );
    const minHealthFactor = await creditManager.minHealthFactor();

    // Check frontier case
    const deltaToThrow = thresholdWeightedAmount
      .sub(percentMul(borrowedAmount, minHealthFactor.toNumber()))
      .mul(PERCENTAGE_FACTOR)
      .div(minHealthFactor.sub(PERCENTAGE_FACTOR));

    await expect(
      creditManager.connect(user).increaseBorrowedAmount(deltaToThrow.add(1))
    ).to.be.revertedWith(revertMsg);
  });

  it("[CM-29]: increaseBorrowedAmountCreditAccount transfers correct amount", async () => {
    await ts.openDefaultCreditAccount(1);

    const creditAccountAddress = await creditManager.creditAccounts(
      user.address
    );

    const creditAccount = await testDeployer.getCreditAccount(
      creditAccountAddress
    );

    const creditAccountBalanceBefore = await underlyingToken.balanceOf(
      creditAccount.address
    );

    const poolServiceBalanceBefore = await underlyingToken.balanceOf(
      poolService.address
    );

    const increasedAmount = 1e5;

    await expect(
      creditManager.connect(user).increaseBorrowedAmount(increasedAmount)
    )
      .to.emit(creditManager, "IncreaseBorrowedAmount")
      .withArgs(user.address, increasedAmount);

    expect(await underlyingToken.balanceOf(creditAccount.address)).to.be.eq(
      creditAccountBalanceBefore.add(increasedAmount)
    );
    expect(await underlyingToken.balanceOf(poolService.address)).to.be.eq(
      poolServiceBalanceBefore.sub(increasedAmount)
    );

    expect(
      await poolService.lendAmount(),
      "Lend amount called from pool"
    ).to.be.eq(increasedAmount);
    expect(
      await poolService.lendAccount(),
      "Lend address called from pool"
    ).to.be.eq(creditAccountAddress);
  });

  it("[CM-30]: increaseBorrowedAmountCreditAccount correctly update cumulativeIndex and borrowedAmount", async () => {
    await ts.openDefaultCreditAccount(1);

    const increasedAmount = BigNumber.from(1e5);

    const [borrowedAmountBefore, ciAtOpen, since] =
      await ts.getCreditAccountParameters(user.address);

    const ciAtIncrease = ciAtOpen.mul(122).div(100);
    await poolService.setCumulative_RAY(ciAtIncrease);

    await creditManager.connect(user).increaseBorrowedAmount(increasedAmount);

    const [borrowedAmountBefore2, ciAfterUpdate, since2] =
      await ts.getCreditAccountParameters(user.address);

    expect(
      borrowedAmountBefore2,
      "Borrowed amount wasn't update properly"
    ).to.be.eq(borrowedAmountBefore.add(increasedAmount));

    const ciExpected = ciAtIncrease
      .mul(ciAtOpen)
      .mul(borrowedAmountBefore.add(increasedAmount))
      .div(
        borrowedAmountBefore
          .mul(ciAtIncrease)
          .add(increasedAmount.mul(ciAtOpen))
      );

    expect(since, "Since was changed!").to.be.eq(since2);
    expect(ciAfterUpdate, "ciAtOpen was cnaged incorrectly!").to.be.eq(
      ciExpected
    );
  });

  it("[CM-31]: calcRepayAmount compute correctly", async () => {
    await ts.openDefaultCreditAccount();

    const [, ciAtOpen] = await ts.getCreditAccountParameters(user.address);

    const ciNow = ciAtOpen.mul(122).div(100);
    await poolService.setCumulative_RAY(ciNow);

    const borrowedAmountWithInterest =
      PoolServiceModel.getBorrowedAmountWithInterest(
        borrowedAmount,
        ciNow,
        ciAtOpen
      );

    // user balance = amount + borrowed amount
    const fee = percentMul(
      borrowedAmountWithInterest.sub(borrowedAmount),
      FEE_INTEREST
    );

    const feeLiq = percentMul(
      amount.add(borrowedAmount).sub(borrowedAmountWithInterest),
      FEE_LIQUIDATION
    );

    expect(
      await creditManager.calcRepayAmount(user.address, false),
      "Incorrect repay case"
    ).to.be.eq(borrowedAmountWithInterest.add(fee));

    expect(
      await creditManager.calcRepayAmount(user.address, true),
      "Incorrect liquidation case"
    ).to.be.eq(
      amount
        .add(borrowedAmount)
        .mul(LIQUIDATION_DISCOUNTED_SUM)
        .div(PERCENTAGE_FACTOR)
        .sub(1)
    );
  });

  // it("[CM-32]: setLimits sets correct values", async () => {
  //   const minAmountNew = WAD.mul(77823);
  //   const maxAmountNew = WAD.mul(1239203);
  //
  //   await expect(
  //     creditManager.setParams(minAmountNew, maxAmountNew, 1, 1, 1, 1, 1, 1)
  //   )
  //     .to.emit(creditManager, "NewParameters")
  //     .withArgs(minAmountNew, maxAmountNew);
  //   expect(await creditManager.minAmount()).to.be.eq(minAmountNew);
  //   expect(await creditManager.maxAmount()).to.be.eq(maxAmountNew);
  // });
  //
  // it("[CM-33]: setLimits reverts for non-configurator", async () => {
  //   const revertMsg = await errors.ACL_CALLER_NOT_CONFIGURATOR();
  //   const minAmountNew = WAD.mul(77823);
  //   const maxAmountNew = WAD.mul(1239203);
  //
  //   await expect(
  //     creditManager
  //       .connect(user)
  //       .setParams(minAmountNew, maxAmountNew, 1, 1, 1, 1, 1)
  //   ).to.be.revertedWith(revertMsg);
  // });

  it("[CM-34]: setParams reverts if maxAmount > minAmount", async () => {
    const revertMsg = await errors.CM_INCORRECT_PARAMS();
    const minAmountNew = WAD.mul(1239203);
    const maxAmountNew = WAD.mul(77823);

    await expect(
      creditManager.setParams(minAmountNew, maxAmountNew, 1, 1, 1, 1)
    ).to.be.revertedWith(revertMsg);
  });

  it("[CM-35]: provideCreditAccountAllowance approves contracts correctly", async () => {
    await ts.openDefaultCreditAccount();

    const creditAccount = await creditManager.creditAccounts(user.address);

    // add some tokens to test that we will not run two allowances
    await tokenA.mint(creditAccount, userInitBalance);

    // we set friend as contract to be able make a token transfer
    expect(await tokenA.allowance(creditAccount, friend.address)).to.be.eq(0);

    // make user as adapter
    await creditFilter.allowContract(friend.address, user.address);

    await creditManager
      .connect(user)
      .provideCreditAccountAllowance(
        creditAccount,
        friend.address,
        tokenA.address
      );
    expect(await tokenA.allowance(creditAccount, friend.address)).to.be.eq(
      MAX_INT
    );

    await tokenA
      .connect(friend)
      .transferFrom(creditAccount, DUMB_ADDRESS, userInitBalance);

    await creditManager
      .connect(user)
      .provideCreditAccountAllowance(
        creditAccount,
        friend.address,
        tokenA.address
      );
    expect(await tokenA.allowance(creditAccount, friend.address)).to.be.eq(
      MAX_INT.sub(userInitBalance)
    );
  });

  it("[CM-36]: setParams reverts for non-configurator and for incorrect values", async () => {
    const revertMsgNonConfig = await errors.ACL_CALLER_NOT_CONFIGURATOR();
    const revertMsgIncorrect = await errors.CM_INCORRECT_FEES();

    const incorrectValue = PERCENTAGE_FACTOR + 1;
    const maxLeverage = 400;

    await expect(
      creditManager.setParams(0, 1000, maxLeverage, incorrectValue, 100, 100)
    ).to.be.revertedWith(revertMsgIncorrect);

    await expect(
      creditManager.setParams(
        0,
        1000,
        maxLeverage,
        100,
        incorrectValue,
        incorrectValue
      )
    ).to.be.revertedWith(revertMsgIncorrect);

    await expect(
      creditManager.setParams(0, 1000, maxLeverage, 100, 100, incorrectValue)
    ).to.be.revertedWith(revertMsgIncorrect);
  });

  it("[CM-37]: setFees sets correct values & emits event", async () => {
    const minAmount = 0;
    const maxAmount = 1000;
    const feeInterest = 200;
    const feeLiquidation = 300;
    const liquidationDiscount = 9300;

    await expect(
      creditManager.setParams(
        minAmount,
        maxAmount,
        maxLeverage,
        feeInterest,
        feeLiquidation,
        liquidationDiscount
      )
    )
      .to.emit(creditManager, "NewParameters")
      .withArgs(
        minAmount,
        maxAmount,
        maxLeverage,
        feeInterest,
        feeLiquidation,
        liquidationDiscount
      );

    expect(await creditManager.maxLeverageFactor()).to.be.eq(maxLeverage);
    expect(await creditManager.feeInterest()).to.be.eq(feeInterest);
    expect(await creditManager.feeLiquidation()).to.be.eq(feeLiquidation);
    expect(await creditManager.liquidationDiscount()).to.be.eq(
      liquidationDiscount
    );
  });

  it("[CM-38]: repayCreditAccountETH reverts if called by non-weth gateway", async () => {
    const revertMsg = await errors.CM_WETH_GATEWAY_ONLY();
    // Open trader account
    await ts.openDefaultCreditAccount();

    await expect(
      creditManager
        .connect(liquidator)
        .repayCreditAccountETH(DUMB_ADDRESS, DUMB_ADDRESS)
    ).to.be.revertedWith(revertMsg);
  });

  it("[CM-39]: openCreditAccount, closeCreditAccount, liquidateCreditAccount, repayCreditAccount, repayCreditAccountETH, increaseBorrowedAmount, addCollateral reverts if contract is paused", async () => {
    await ts.openDefaultCreditAccount();

    const acl = await coreDeployer.getACL();
    await acl.addPausableAdmin(deployer.address);
    await acl.addUnpausableAdmin(deployer.address);

    await creditManager.connect(deployer).pause();

    await expect(
      creditManager.openCreditAccount(10, DUMB_ADDRESS, 10, 10)
    ).to.revertedWith(PAUSABLE_REVERT_MSG);

    await expect(
      creditManager.closeCreditAccount(DUMB_ADDRESS, [])
    ).to.revertedWith(PAUSABLE_REVERT_MSG);

    await expect(
      creditManager.liquidateCreditAccount(DUMB_ADDRESS, DUMB_ADDRESS, false)
    ).to.revertedWith(PAUSABLE_REVERT_MSG);

    await expect(
      creditManager.repayCreditAccount(DUMB_ADDRESS)
    ).to.revertedWith(PAUSABLE_REVERT_MSG);

    await expect(
      creditManager.repayCreditAccountETH(DUMB_ADDRESS, DUMB_ADDRESS)
    ).to.revertedWith(PAUSABLE_REVERT_MSG);

    await expect(
      creditManager.connect(user).increaseBorrowedAmount(12)
    ).to.revertedWith(PAUSABLE_REVERT_MSG);

    await expect(
      creditManager.connect(user).addCollateral(DUMB_ADDRESS, DUMB_ADDRESS, 12)
    ).to.revertedWith(PAUSABLE_REVERT_MSG);

    // adds deployer as adapter
    await creditFilter
      .connect(deployer)
      .allowContract(DUMB_ADDRESS, deployer.address);

    await expect(
      creditManager
        .connect(deployer)
        .provideCreditAccountAllowance(DUMB_ADDRESS, DUMB_ADDRESS, DUMB_ADDRESS)
    ).to.revertedWith(PAUSABLE_REVERT_MSG);

    await expect(
      creditManager
        .connect(deployer)
        .executeOrder(DUMB_ADDRESS, DUMB_ADDRESS, DUMB_ADDRESS)
    ).to.revertedWith(PAUSABLE_REVERT_MSG);

    await expect(
      creditManager.connect(deployer).transferAccountOwnership(DUMB_ADDRESS)
    ).to.revertedWith(PAUSABLE_REVERT_MSG);
  });

  it("[CM-40]: setParams reverts if minHeathFactor is too high", async () => {
    const revertMsg = await errors.CM_MAX_LEVERAGE_IS_TOO_HIGH();
    await expect(
      creditManager.setParams(0, 1000, 1500, 0, 200, 9500)
    ).to.be.revertedWith(revertMsg);
  });

  it("[CM-41]: minHealthFactor computed correctly", async () => {
    await ts.openDefaultCreditAccount(maxLeverage);

    const creditAccount = await creditManager.creditAccounts(user.address);

    expect(
      await creditFilter.calcCreditAccountHealthFactor(creditAccount)
    ).to.be.eq(await creditManager.minHealthFactor());
  });

  it("[CM-42]: closeCreditAccount reverts if user wants no to pay fees", async () => {
    const revertMsg = await errors.CM_CANT_CLOSE_WITH_LOSS();
    await ts.openDefaultCreditAccount();

    const creditAccount = await creditManager.getCreditAccountOrRevert(
      user.address
    );

    const tv = await creditFilter.calcTotalValue(creditAccount);

    const [borrowedAmount, ciAtOpen] = await ts.getCreditAccountParameters(
      user.address
    );

    // We consider edge case where:
    // tv = bai + iR * feeI
    // or:
    //
    //        tv  + ba * feeI
    // bai = ---------------------------
    //               1 + feeI
    //
    //                      bai
    // ciClose = ciAtOpen ------
    //                       ba
    // With less than one it should be reverted.

    const feeI = (await creditManager.feeInterest()).toNumber();

    const ciAtCloseThrow = ciAtOpen
      .mul(tv.mul(PERCENTAGE_FACTOR).add(borrowedAmount.mul(feeI)))
      .div(PERCENTAGE_FACTOR + feeI)
      .div(borrowedAmount);

    const closePath = await ts.getClosePath(user.address, closeSlippage);
    //
    await poolService.setCumulative_RAY(ciAtCloseThrow);

    const params = await creditManager._calcClosePayments(
      creditAccount,
      tv,
      false
    );

    expect(params.remainingFunds).to.be.eq(0);

    await expect(
      creditManager.connect(user).closeCreditAccount(friend.address, closePath)
    ).to.be.revertedWith(revertMsg);

    const ciAtCloseNotThrow = ciAtCloseThrow.sub(1e9);
    await poolService.setCumulative_RAY(ciAtCloseNotThrow);

    const paramsNotThrow = await creditManager._calcClosePayments(
      creditAccount,
      tv,
      false
    );

    expect(paramsNotThrow.remainingFunds).to.be.gt(0);

    await creditManager
      .connect(user)
      .closeCreditAccount(friend.address, closePath);
  });

  it("[CM-43]: constructor reverts if underlying token is not consistent", async () => {
    const revertMsg = await errors.CF_UNDERLYING_TOKEN_FILTER_CONFLICT();
    const contractName = "CreditManager";

    const creditManagerArtifact = (await ethers.getContractFactory(
      contractName
    )) as CreditManager__factory;

    const addressProvider = await coreDeployer.getAddressProvider();

    const creditFilterArtifact = (await ethers.getContractFactory(
      "CreditFilter"
    )) as CreditFilter__factory;

    const creditFilter = await creditFilterArtifact.deploy(
      addressProvider.address,
      ts.tokenA.address
    );

    const creditManager2 = await creditManagerArtifact.deploy(
      addressProvider.address,
      0,
      1000,
      100,
      poolService.address,
      creditFilter.address,
      (
        await integrationsDeployer.getUniswapMock()
      ).address
    );

    await expect(
      creditFilter.connectCreditManager(creditManager2.address)
    ).to.be.revertedWith(revertMsg);
  });

  it("[CM-44]: closeCreditAccount converts tokens to underlying asset and correctly compute remaining amount", async () => {
    // Open default credit account
    await ts.openDefaultCreditAccount();
    await ts.setupUniswapV2Adapter();

    const uniswapModel = ts.uniswapModel;

    await creditManager
      .connect(user)
      .addCollateral(user.address, tokenA.address, swapAmountA);

    // it moves timestamp in one year ahead to compute interest rate greater than 0
    // await ts.oneYearAhead();
    const newCumuativeIndex = RAY.mul(11).div(10);
    await ts.mockPoolService.setCumulative_RAY(newCumuativeIndex);

    const rateRAY = ts.uniswapModel.getRate([
      tokenA.address,
      underlyingToken.address,
    ]);

    const expectedClosureTrade = uniswapModel.swapExactTokensForTokens(
      swapAmountA,
      BigNumber.from(0),

      [tokenA.address, underlyingToken.address]
    );

    if (expectedClosureTrade.isReverted === true) {
      throw new Error("Unexpected revert");
    }

    const expectedTokenAToUnderlying = BigNumber.from(
      expectedClosureTrade.amounts[1]
    );

    const totalValue = amount
      .add(borrowedAmount)
      .add(expectedTokenAToUnderlying);

    const borrowedAmountWithInterest = borrowedAmount
      .mul(newCumuativeIndex)
      .div(RAY); // rayMul(borrowedAmount, interestAccrued);

    expect(
      expectedTokenAToUnderlying,
      "Expected token A to underlying"
    ).to.be.eq(
      swapAmountA
        .mul(rateRAY)
        .div(RAY)
        .mul(UniswapModel.FEE)
        .div(UniswapModel.FEE_discriminator)
    );

    const feeInterest = await creditManager.feeInterest();

    const fee = percentMul(
      borrowedAmountWithInterest.sub(borrowedAmount),
      feeInterest.toNumber()
    );

    const expectedBalanceAfter = totalValue
      .sub(borrowedAmountWithInterest)
      .sub(fee)
      .sub(1); // 1 for Michael Egorov gas efficiency trick

    //
    //  CLOSING CREDIT ACCOUNT
    //

    const closePath = await ts.getClosePath(user.address, closeSlippage);

    await expect(
      creditManager.connect(user).closeCreditAccount(friend.address, closePath)
    )
      .to.emit(creditManager, "CloseCreditAccount")
      .withArgs(user.address, friend.address, expectedBalanceAfter);

    expect(
      await underlyingToken.balanceOf(friend.address),
      "Remaining funds"
    ).to.be.eq(expectedBalanceAfter);
  });

  it("[CM-45]: closeCreditAccount reverts if someone change uniswap rate dramatically", async () => {
    // Open default credit account
    await ts.openDefaultCreditAccount();
    await ts.setupUniswapV2Adapter();

    await creditManager
      .connect(user)
      .addCollateral(user.address, tokenA.address, swapAmountA);

    // Uniswap rate equals chainlink rate
    const rate = await ts.uniswapMock.getRate([
      tokenA.address,
      underlyingToken.address,
    ]);
    const edgeRate = rate
      .mul(PERCENTAGE_FACTOR - closeSlippage)
      .div(PERCENTAGE_FACTOR);

    await ts.uniswapMock.setRate(
      tokenA.address,
      underlyingToken.address,
      edgeRate.sub(1)
    );

    const closePath = await ts.getClosePath(user.address, closeSlippage);

    await expect(
      creditManager.connect(user).closeCreditAccount(friend.address, closePath)
    ).to.be.revertedWith("UniswapV2Router: INSUFFICIENT_OUTPUT_AMOUNT");
  });

  it("[CM-46]: provideCreditAccountAllowance, executeOrder reverts for non-adapters", async () => {
    const revertMsg = await errors.CM_TARGET_CONTRACT_iS_NOT_ALLOWED();
    // make user as adapter
    await creditFilter.allowContract(friend.address, DUMB_ADDRESS);

    await expect(
      creditManager.provideCreditAccountAllowance(
        DUMB_ADDRESS,
        friend.address,
        DUMB_ADDRESS
      )
    ).to.revertedWith(revertMsg);

    await expect(
      creditManager.executeOrder(DUMB_ADDRESS, friend.address, DUMB_ADDRESS)
    ).to.revertedWith(revertMsg);
  });

  it("[CM-47]: execute executes pooldata on thrid party contract", async () => {
    const executorMock = await testDeployer.getExecutorMock();
    await creditFilter.allowContract(executorMock.address, deployer.address);
    await ts.openDefaultCreditAccount();

    const value = 100;
    const calldata = executorMock.interface.encodeFunctionData("setValue", [
      value,
    ]);

    const decodeData = await creditManager.callStatic.executeOrder(
      user.address,
      executorMock.address,
      calldata
    );

    const result = executorMock.interface.decodeFunctionResult(
      "value",
      decodeData
    );
    expect(result[0]).to.be.eq(value + 1);
    await expect(
      creditManager.executeOrder(user.address, executorMock.address, calldata),
      "emit ExecuteOrder"
    )
      .to.emit(creditManager, "ExecuteOrder")
      .withArgs(user.address, executorMock.address);

    const creditAccount = await creditManager.getCreditAccountOrRevert(
      user.address
    );

    expect(await executorMock.calledBy(), "Caller address").to.be.eq(
      creditAccount
    );
    expect(await executorMock.value(), "Value").to.be.eq(value);
  });

  it("[CM-48]: getCreditAccountOrRevert returns correct creditAccount address", async () => {
    await ts.openDefaultCreditAccount();
    const accFactory = await coreDeployer.getAccountFactory();
    const events = await accFactory.queryFilter(
      accFactory.filters.NewCreditAccount(),
      0,
      "latest"
    );
    // account factory will deploy one more account, cause it takes the last one from the list
    // so, acc factory will provide the first one, and predeployed will be kept in factory
    expect(events.length, "events != 2").to.be.eq(2);
    const creditAccount = await creditManager.getCreditAccountOrRevert(
      user.address
    );
    expect(creditAccount).to.be.eq(events[0].args.account);
  });

  it("[CM-48]: addCollateral enables token, transfer it and emits even", async () => {
    await ts.openDefaultCreditAccount();
    await tokenA.transfer(user.address, 1000);
    await tokenA.connect(user).approve(creditManager.address, MAX_INT);

    const creditAccount = await creditManager.getCreditAccountOrRevert(
      user.address
    );

    const balanceBeforeU = await tokenA.balanceOf(user.address);
    const balanceBeforeC = await tokenA.balanceOf(creditAccount);

    expect(await creditFilter.enabledTokens(creditAccount)).to.be.eq(1);
    await expect(
      creditManager
        .connect(user)
        .addCollateral(user.address, tokenA.address, 1000)
    )
      .to.emit(creditManager, "AddCollateral")
      .withArgs(user.address, tokenA.address, 1000);

    expect(await tokenA.balanceOf(user.address), "user balance").to.be.eq(
      balanceBeforeU.sub(1000)
    );
    expect(await tokenA.balanceOf(creditAccount)).to.be.eq(
      balanceBeforeC.add(1000)
    );

    expect(await creditFilter.enabledTokens(creditAccount)).to.be.eq(3); // 11b
  });

  it("[CM-49]: setFees updates creditFilter parameters", async () => {
    await creditManager.setParams(0, 1000, 400, 0, 500, 9500);
    expect(
      await creditFilter.liquidationThresholds(underlyingToken.address)
    ).to.be.eq(9000);
  });

  it("[CM-50]: liquidation with force works correctly", async () => {
    const revertMsg = await errors.CM_TRANSFER_FAILED();
    await ts.openDefaultCreditAccount();
    const blockedToken = await testDeployer.getERC20BlockingMock(
      "Block",
      "BLK"
    );

    const blockAmount = 100000;

    const chainlinkMock = await ts.testDeployer.getChainlinkPriceFeedMock(
      BigNumber.from(1).mul(WAD)
    );

    await ts.priceOracle.addPriceFeed(
      blockedToken.address,
      chainlinkMock.address
    );

    await creditFilter.allowToken(blockedToken.address, 1);
    await creditFilter.allowToken(underlyingToken.address, 1);

    await blockedToken.mint(user.address, blockAmount);
    await blockedToken.connect(user).approve(creditManager.address, MAX_INT);
    await creditManager
      .connect(user)
      .addCollateral(user.address, blockedToken.address, blockAmount);
    await blockedToken.blockToken();

    await underlyingToken.approve(creditManager.address, MAX_INT);
    await expect(
      creditManager.liquidateCreditAccount(
        user.address,
        deployer.address,
        false
      )
    ).to.be.revertedWith(revertMsg);

    const repayAmount = await creditManager.calcRepayAmount(user.address, true);

    const balanceBefore = await underlyingToken.balanceOf(deployer.address);

    const amountNotTransferred = await ts.priceOracle.convert(
      blockAmount,
      blockedToken.address,
      underlyingToken.address
    );

    await creditManager.liquidateCreditAccount(
      user.address,
      friend.address,
      true
    );

    expect(await underlyingToken.balanceOf(deployer.address)).to.be.eq(
      balanceBefore
        .sub(repayAmount)
        .add(
          amountNotTransferred
            .mul(await creditManager.liquidationDiscount())
            .div(PERCENTAGE_FACTOR)
        )
    );
  });

  it("[CM-51]: increase borrow amount reverts if try to increase more than maxAmount * leverage", async () => {
    const revertMsg = await errors.CM_INCORRECT_AMOUNT();

    await creditManager.setParams(
      0,
      CreditManagerTestSuite.amount,
      CreditManagerTestSuite.leverageFactor,
      100,
      200,
      9500
    );
    await ts.openDefaultCreditAccount();

    const creditAccount = ICreditAccount__factory.connect(
      await creditManager.getCreditAccountOrRevert(user.address),
      deployer
    );

    await creditManager
      .connect(user)
      .addCollateral(user.address, underlyingToken.address, 1000);
    await expect(
      creditManager.connect(user).increaseBorrowedAmount(100)
    ).to.be.revertedWith(revertMsg);
  });

  it("[CM-52]: transferAccountOwnership reverts for ZERO_ADDRESS", async () => {
    const revertMsg =
      await errors.CM_ZERO_ADDRESS_OR_USER_HAVE_ALREADY_OPEN_CREDIT_ACCOUNT();
    await ts.openDefaultCreditAccount();

    await expect(
      creditManager.connect(user).transferAccountOwnership(ADDRESS_0x0)
    ).to.be.revertedWith(revertMsg);
  });

  it("[CM-53]: transferAccountOwnership reverts for owner who has already credit account", async () => {
    const revertMsg =
      await errors.CM_ZERO_ADDRESS_OR_USER_HAVE_ALREADY_OPEN_CREDIT_ACCOUNT();
    await ts.openDefaultCreditAccount();

    await underlyingToken.approve(creditManager.address, MAX_INT);
    await creditManager.openCreditAccount(
      CreditManagerTestSuite.amount,
      deployer.address,
      CreditManagerTestSuite.leverageFactor,
      2
    );

    await expect(
      creditManager.connect(user).transferAccountOwnership(deployer.address)
    ).to.be.revertedWith(revertMsg);
  });

  it("[CM-54]: transferAccountOwnership transfers ownership & emits event", async () => {
    const revertMsg = await errors.CM_NO_OPEN_ACCOUNT();
    await ts.openDefaultCreditAccount();

    await creditFilter.approveAccountTransfers(user.address, true);

    await expect(
      creditManager.connect(user).transferAccountOwnership(deployer.address)
    )
      .to.emit(creditManager, "TransferAccount")
      .withArgs(user.address, deployer.address);

    await creditManager.getCreditAccountOrRevert(deployer.address);
    await expect(
      creditManager.getCreditAccountOrRevert(user.address)
    ).to.be.revertedWith(revertMsg);
  });

  it("[CM-55]:  transferAccountOwnership reverts if user do not provide allowance", async () => {
    const revertMsg = await errors.CF_TRANSFER_IS_NOT_ALLOWED();
    await ts.openDefaultCreditAccount();

    await expect(
      creditManager.connect(user).transferAccountOwnership(deployer.address)
    ).to.be.revertedWith(revertMsg);
  });

  it("[CM-56]: liquidateCreditAccount reverts if zero-address was provided", async () => {
    const revertMsg = await errors.ZERO_ADDRESS_IS_NOT_ALLOWED();

    await ts.liquidationSetup();

    await expect(
      creditManager
        .connect(liquidator)
        .liquidateCreditAccount(user.address, ADDRESS_0x0, false)
    ).to.be.revertedWith(revertMsg);

    await expect(
      creditManager.connect(user).repayCreditAccount(ADDRESS_0x0)
    ).to.be.revertedWith(revertMsg);
  });

  it("[CM-57]: closeCreditAccount reverts if closePath.length !== allowedAccountCount()", async () => {
    const revertMsg = await errors.INCORRECT_PATH_LENGTH();

    // Open default credit account
    await ts.openDefaultCreditAccount();

    const ciAtClose = RAY.mul(102).div(100);
    await poolService.setCumulative_RAY(ciAtClose);

    const closePath = await ts.getClosePath(user.address, 0);

    await expect(
      creditManager
        .connect(user)
        .closeCreditAccount(friend.address, closePath.slice(0, 2))
    ).to.be.revertedWith(revertMsg);
  });
  it("[CM-58]: approve reverts for non-allowed tokens", async () => {
    const revertMsg = await errors.CF_TOKEN_IS_NOT_ALLOWED();

    // Open default credit account
    await ts.openDefaultCreditAccount();

    const uniMock = await integrationsDeployer.getUniswapMock();
    const adapter = await integrationsDeployer.getUniswapV2Adapter(
      uniMock.address
    );
    await creditFilter.allowContract(uniMock.address, adapter.address);

    await expect(
      creditManager.connect(user).approve(uniMock.address, DUMB_ADDRESS)
    ).to.be.revertedWith(revertMsg);
  });

  it("[CM-59]: maxFactor =0 reverts", async () => {
    const revertMsg = await errors.CM_INCORRECT_PARAMS();

    await expect(
      creditManager.setParams(0, 1, 0, 200, 200, 9500)
    ).to.be.revertedWith(revertMsg);
  });

  it("[CM-60]: increaseBorrowedAmountCreditAccount comparison test", async () => {
    await ts.openDefaultCreditAccount(100);

    const increasedAmount = BigNumber.from(1e5);

    const [borrowedAmountBefore, ciAtOpen, since] =
      await ts.getCreditAccountParameters(user.address);

    const ciAtIncrease = ciAtOpen.mul(122).div(100);
    await poolService.setCumulative_RAY(ciAtIncrease);

    await creditManager.connect(user).increaseBorrowedAmount(increasedAmount);

    const borrowAmountAtMiddle = borrowedAmountBefore
      .mul(ciAtIncrease)
      .div(ciAtOpen)
      .add(increasedAmount);

    // Open credit account

    await ts.underlyingToken
      .connect(deployer)
      .approve(creditManager.address, MAX_INT);

    await creditManager
      .connect(deployer)
      .openCreditAccount(
        borrowAmountAtMiddle,
        deployer.address,
        100,
        CreditManagerTestSuite.referral
      );

    const [borrowedAmountMiddle, ciMiddle, sinceA] =
      await ts.getCreditAccountParameters(user.address);

    const [borrowedAmountMiddleDep, ciMiddleDep, sinceB] =
      await ts.getCreditAccountParameters(deployer.address);

    expect(borrowedAmountMiddleDep).to.be.eq(borrowAmountAtMiddle);

    const ciAtEnd = ciAtOpen.mul(422).div(100);

    const ba1 = borrowedAmountMiddle.mul(ciAtEnd).div(ciMiddle);
    const ba2 = borrowedAmountMiddleDep.mul(ciAtEnd).div(ciMiddleDep);

    expect(ba1).to.be.eq(ba2);
  });
});

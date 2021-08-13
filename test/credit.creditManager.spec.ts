// @ts-ignore
import { ethers } from "hardhat";
import { solidity } from "ethereum-waffle";
import * as chai from "chai";

import {
  CreditFilter,
  CreditFilter__factory,
  CreditFilterMock,
  CreditManager,
  CreditManager__factory,
  DieselToken,
  Errors,
  MockPoolService,
  TokenMock,
} from "../types/ethers-v5";
import { CoreDeployer } from "../deployer/coreDeployer";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { PoolDeployer } from "../deployer/poolDeployer";
import { IntegrationsDeployer } from "../deployer/integrationsDeployer";
import { TestDeployer } from "../deployer/testDeployer";
import {
  DUMB_ADDRESS,
  FEE_INTEREST,
  FEE_LIQUIDATION,
  FEE_SUCCESS,
  LEVERAGE_DECIMALS,
  LIQUIDATION_DISCOUNTED_SUM,
  MAX_INT,
  PAUSABLE_REVERT_MSG,
  PERCENTAGE_FACTOR,
  RAY,
  UNDERLYING_TOKEN_LIQUIDATION_THRESHOLD,
  WAD,
} from "../core/constants";
import { BigNumber } from "ethers";
import { percentMul, rayMul } from "../model/math";
import { PoolServiceModel } from "../model/poolService";
import { PoolTestSuite } from "../deployer/poolTestSuite";
import { CreditManagerTestSuite } from "../deployer/creditManagerTestSuite";
import { UniswapModel } from "../model/uniswapModel";

chai.use(solidity);
const { expect } = chai;

const { userInitBalance, addLiquidity } = PoolTestSuite;

const {
  uniswapInitBalance,
  swapAmountA,
  amount,
  leverageFactor,
  borrowedAmount,
  maxLeverage,
  referral,
  ALLOWED_CONTRACT_1,
  ALLOWED_CONTRACT_2,
  amountOutTolerance,
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

  beforeEach(async function () {
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

  it("[CM-1]: minHealthFactor computes correctly", async function () {
    const minHealhFactor = Math.floor(
      (UNDERLYING_TOKEN_LIQUIDATION_THRESHOLD * (maxLeverage + 100)) /
        maxLeverage
    );

    expect(await creditManager.minHealthFactor()).to.be.eq(minHealhFactor);
  });

  it("[CM-2]: openCreditAccount reverts if amount < minAmount or amount > maxAmount", async function () {
    const revertMsg = await errors.CM_INCORRECT_AMOUNT();
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

  it("[CM-3]: openCreditAccount reverts if user has already opened account", async function () {
    const revertMsg = await errors.CM_YOU_HAVE_ALREADY_OPEN_VIRTUAL_ACCOUNT();

    // Open trader account
    await creditManager
      .connect(user)
      .openCreditAccount(amount, user.address, leverageFactor, referral);

    await expect(
      creditManager
        .connect(user)
        .openCreditAccount(amount, user.address, leverageFactor, referral)
    ).to.be.revertedWith(revertMsg);
  });

  it("[CM-4]: openCreditAccount reverts if leverage > maxLeverage or leverage = 0", async function () {
    const revertMsg = await errors.CM_INCORRECT_LEVERAGE_FACTOR();

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

  it("[CM-5]: openCreditAccount sets correct general credit account parameters", async function () {
    // Open trader account
    const receipt = await creditManager
      .connect(user)
      .openCreditAccount(amount, user.address, leverageFactor, referral);

    const va = await testDeployer.getCreditAccount(
      await creditManager.creditAccounts(user.address)
    );

    const [borrowedAmountReal, ciAtOpen, since] =
      await ts.getCreditAccountParameters(user.address);

    expect(borrowedAmountReal).to.be.eq(borrowedAmount);
    expect(ciAtOpen).to.be.eq(
      await poolService.calcLinearCumulative_RAY({
        blockTag: receipt.blockNumber,
      })
    );
    expect(since).to.be.eq(receipt.blockNumber); // last block
  });

  it("[CM-6]: openCreditAccount transfers correct amount of user tokens to new credit account", async function () {
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

  it("[CM-7]: openCreditAccount transfers correct amount of pool tokens to new credit account", async function () {
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

  it("[CM-8]: openCreditAccount emits correct OpenCreditAccount", async function () {
    const accountFactory = await coreDeployer.getAccountFactory();

    // it should be next container which'll be taken
    const nextVA = await accountFactory.head();

    // Open trader account
    await expect(
      creditManager
        .connect(user)
        .openCreditAccount(amount, friend.address, leverageFactor, referral)
    )
      .to.emit(creditManager, "OpenCreditAccount")
      .withArgs(
        user.address,
        friend.address,
        nextVA,
        amount,
        borrowedAmount,
        referral
      );
  });

  //
  // CLOSE ACCOUNT
  //

  // it("[CM-9]: closeCreditAccount reverts for user who has no opened credit account", async function () {
  //   const revertMsg = await errors.CM_NO_OPEN_ACCOUNT();
  //   await expect(
  //     creditManager
  //       .connect(user)
  //       .closeCreditAccount(user.address, amountOutTolerance)
  //   ).to.revertedWith(revertMsg);
  // });
  //
  // it("[CM-10]: closeCreditAccount emits CloseCreditAccount correctly", async function () {
  //   // Open default credit account
  //   await ts.openDefaultCreditAccount();
  //
  //   const [, ciAtOpen] = await ts.getCreditAccountParameters(user.address);
  //
  //   const ciAtClose = RAY.mul(102).div(100);
  //   await poolService.setCumulative_RAY(ciAtClose);
  //
  //   const borrowedAmountWithInterest =
  //     PoolServiceModel.getBorrowedAmountWithInterest(
  //       borrowedAmount,
  //       ciAtClose,
  //       ciAtOpen
  //     );
  //
  //   // user balance = amount + borrowed amount
  //   const fee = percentMul(
  //     amount.add(borrowedAmount).sub(borrowedAmountWithInterest),
  //     FEE_SUCCESS
  //   ).add(
  //     percentMul(borrowedAmountWithInterest.sub(borrowedAmount), FEE_INTEREST)
  //   );
  //
  //   const remainingFunds = amount
  //     .add(borrowedAmount)
  //     .sub(borrowedAmountWithInterest)
  //     .sub(fee)
  //     .sub(1); // 1 for Michael Egorov gas efficiency trick
  //
  //   await expect(
  //     creditManager
  //       .connect(user)
  //       .closeCreditAccount(friend.address, amountOutTolerance)
  //   )
  //     .to.emit(creditManager, "CloseCreditAccount")
  //     .withArgs(user.address, friend.address, remainingFunds);
  // });

  // it("[CM-11]: closeCreditAccount repay pool & transfer remaining funds to borrower account correctly", async function () {
  //   await ts.openDefaultCreditAccount();
  //
  //   const poolBalanceBefore = await poolService.availableLiquidity();
  //
  //   const [, ciAtOpen] = await ts.getCreditAccountParameters(user.address);
  //
  //   const ciAtClose = RAY.mul(102).div(100);
  //   await poolService.setCumulative_RAY(ciAtClose);
  //
  //   await creditManager
  //     .connect(user)
  //     .closeCreditAccount(friend.address, amountOutTolerance);
  //
  //   const borrowedAmountWithInterest =
  //     PoolServiceModel.getBorrowedAmountWithInterest(
  //       borrowedAmount,
  //       ciAtClose,
  //       ciAtOpen
  //     );
  //
  //   const fee = percentMul(
  //     amount.add(borrowedAmount).sub(borrowedAmountWithInterest),
  //     FEE_SUCCESS
  //   ).add(
  //     percentMul(borrowedAmountWithInterest.sub(borrowedAmount), FEE_INTEREST)
  //   );
  //
  //   const remainingFunds = amount
  //     .add(borrowedAmount)
  //     .sub(borrowedAmountWithInterest)
  //     .sub(fee);
  //
  //   expect(await poolService.repayAmount(), "Incorrect repay amount").to.be.eq(
  //     borrowedAmount
  //   );
  //   expect(await poolService.repayProfit(), "Incorrectly profit").to.be.eq(fee);
  //   expect(await poolService.repayLoss(), "Incorrect loss").to.be.eq(0);
  //
  //   expect(
  //     await poolService.availableLiquidity(),
  //     "Pool balance updated incorrectly"
  //   ).to.be.eq(poolBalanceBefore.add(borrowedAmountWithInterest).add(fee));
  //
  //   expect(
  //     await underlyingToken.balanceOf(friend.address),
  //     "Remaining funds sent incorrectly"
  //   ).to.be.eq(
  //     remainingFunds.sub(1) // Michael Egorov efficiency trick
  //   );
  // });

  // LIQUIDATE ACCOUNT

  it("[CM-12]: liquidateCreditAccount reverts for borrower who has no opened credit account", async function () {
    const revertMsg = await errors.CM_NO_OPEN_ACCOUNT();
    await expect(
      creditManager
        .connect(friend)
        .liquidateCreditAccount(user.address, friend.address)
    ).to.revertedWith(revertMsg);
  });

  it("[CM-13]: liquidateCreditAccount works with health factor <1 and emits correct event", async function () {
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
        .liquidateCreditAccount(user.address, friend.address)
    )
      .to.emit(creditManager, "LiquidateCreditAccount")
      .withArgs(user.address, liquidator.address, remainingFunds);
  });

  it("[CM-14]: liquidateCreditAccount takes amountToPool from and transfers all tokens to liquidator", async function () {
    // Send my to be able for lending

    for (const pnl of [false, true]) {
      const borrowedAmountWithInterest = await ts.liquidationSetup(pnl);

      const initLiquidatorBalance = await underlyingToken.balanceOf(
        liquidator.address
      );
      const initFriendBalance = await underlyingToken.balanceOf(friend.address);

      const receipt = await creditManager
        .connect(liquidator)
        .liquidateCreditAccount(user.address, friend.address);

      await receipt.wait();

      const expectedLiquidationAmount = amount
        .add(borrowedAmount)
        .mul(LIQUIDATION_DISCOUNTED_SUM)
        .div(PERCENTAGE_FACTOR)
        .sub(1);

      expect(
        await creditManager.calcRepayAmount(user.address, true, {
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

  it("[CM-15]: liquidateCreditAccount correctly updates repay pool", async function () {
    // Send my to be able for lending

    for (const pnl of [true, false]) {
      const borrowedAmountWithInterest = await ts.liquidationSetup(pnl);

      await creditManager
        .connect(liquidator)
        .liquidateCreditAccount(user.address, friend.address);

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

  it("[CM-16]: liquidateCreditAccount reverts for Hf>=1", async function () {
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
        .liquidateCreditAccount(user.address, friend.address)
    ).to.revertedWith(revertMsg);
  });

  // REPAY ACCOUNT

  it("[CM-17]: repayCreditAccount takes correct amount from borrower and send assets to provided account", async function () {
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

    const fee = percentMul(
      amount
        // we should uniswapInitBalance, cause rate is 1, we set one chainlink mock for both assets
        .add(tokenAamountConverted)
        .add(ba)
        .sub(borrowedAmountWithInterest),
      FEE_SUCCESS
    ).add(percentMul(borrowedAmountWithInterest.sub(ba), FEE_INTEREST));

    const repayCost = borrowedAmountWithInterest.add(fee);

    expect(
      await creditManager.calcRepayAmount(user.address, false, {
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

  it("[CM-18]: repayCreditAccount emits event correctly", async function () {
    await ts.openDefaultCreditAccount();

    await expect(creditManager.connect(user).repayCreditAccount(friend.address))
      .to.emit(creditManager, "RepayCreditAccount")
      .withArgs(user.address, friend.address);
  });

  it("[CM-19]: repayCreditAccount reverts for user who has no opened credit account", async function () {
    const revertMsg = await errors.CM_NO_OPEN_ACCOUNT();
    await expect(
      creditManager.connect(user).repayCreditAccount(user.address)
    ).to.revertedWith(revertMsg);
  });

  // This statement protects protocol from FlashLoan attack
  it("[CM-20]: closeCreditAccount, repayCreditAccount reverts if called the same block as OpenCreditAccount", async function () {
    const flashLoanAttacker = await testDeployer.getFlashLoanAttacker(
      creditManager.address
    );

    await underlyingToken.mint(flashLoanAttacker.address, userInitBalance);

    const revertMsg =
      await errors.AF_CANT_CLOSE_CREDIT_ACCOUNT_IN_THE_SAME_BLOCK();
    await expect(
      flashLoanAttacker.attackClose(amount, leverageFactor),
      "Error during close attack"
    ).to.revertedWith(revertMsg);

    await expect(
      flashLoanAttacker.attackRepay(amount, leverageFactor),
      "Error during repay attack"
    ).to.revertedWith(revertMsg);
  });

  it("[CM-21]: repayCreditAccount returns credit account to factory", async function () {
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

  it("[CM-22]: liquidateCreditAccount convert WETH to ETH when tranferring them to liquidatror", async function () {
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
      .liquidateCreditAccount(user.address, friend.address);

    expect(await friend.getBalance()).to.be.eq(
      friendBalance.add(ethBalance).sub(1)
    );
  });

  it("[CM-23]: repayCreditAccount convert WETH to ETH when transferring them", async function () {
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

  it("[CM-26]: hasOpenedCreditAccount works correctly", async function () {
    // Open trader account
    expect(await creditManager.hasOpenedCreditAccount(user.address)).to.be
      .false;
    // Open trader account
    await creditManager
      .connect(user)
      .openCreditAccount(amount, user.address, leverageFactor, referral);
    expect(await creditManager.hasOpenedCreditAccount(user.address)).to.be.true;
  });

  // it("[CM-27]: closeCreditAccount remove hasOpenedAccount property", async function () {
  //   // Open default credit account
  //   await ts.openDefaultCreditAccount();
  //
  //   await creditManager
  //     .connect(user)
  //     .closeCreditAccount(friend.address, amountOutTolerance);
  //   expect(await creditManager.hasOpenedCreditAccount(user.address)).to.be
  //     .false;
  // });

  // INCREASE BORROW AMOUNT

  it("[CM-28]: increaseBorrowedAmountCreditAccount reverts of health factor < Constants.HEALTH_FACTOR_MIN_AFTER_UPDATE", async function () {
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

  it("[CM-29]: increaseBorrowedAmountCreditAccount transfers correct amount", async function () {
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

    await  creditManager.connect(user).increaseBorrowedAmount(increasedAmount)
    expect(await underlyingToken.balanceOf(creditAccount.address)).to.be.eq(creditAccountBalanceBefore.add(increasedAmount))
    expect(await underlyingToken.balanceOf(poolService.address)).to.be.eq(poolServiceBalanceBefore.sub(increasedAmount))

    expect(
      await poolService.lendAmount(),
      "Lend amount called from pool"
    ).to.be.eq(increasedAmount);
    expect(
      await poolService.lendAccount(),
      "Lend address called from pool"
    ).to.be.eq(creditAccountAddress);
  });

  it("[CM-30]: increaseBorrowedAmountCreditAccount correctly update borrowed amount and total borrow", async function () {
    await ts.openDefaultCreditAccount(1);

    const increasedAmount = BigNumber.from(1e5);

    const [borrowedAmountBefore, ciAtOpen, since] =
      await ts.getCreditAccountParameters(user.address);

    const ciAtIncrease = ciAtOpen.mul(122).div(100);
    await poolService.setCumulative_RAY(ciAtIncrease);

    await creditManager.connect(user).increaseBorrowedAmount(increasedAmount);

    const [borrowedAmountBefore2, ciAtOpen2, since2] =
      await ts.getCreditAccountParameters(user.address);

    expect(
      borrowedAmountBefore2,
      "Borrowed amount wasn't update properly"
    ).to.be.eq(
      borrowedAmountBefore.add(increasedAmount.mul(ciAtOpen).div(ciAtIncrease))
    );

    expect(since, "Since was changed!").to.be.eq(since2);
    expect(ciAtOpen, "ciAtOpen was changed!").to.be.eq(ciAtOpen2);
  });

  it("[CM-31]: calcRepayAmount compute correctly", async function () {
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
      amount.add(borrowedAmount).sub(borrowedAmountWithInterest),
      FEE_SUCCESS
    ).add(
      percentMul(borrowedAmountWithInterest.sub(borrowedAmount), FEE_INTEREST)
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

  it("[CM-32]: setLimits sets correct values", async function () {
    const minAmountNew = WAD.mul(77823);
    const maxAmountNew = WAD.mul(1239203);

    await expect(creditManager.setLimits(minAmountNew, maxAmountNew))
      .to.emit(creditManager, "NewLimits")
      .withArgs(minAmountNew, maxAmountNew);
    expect(await creditManager.minAmount()).to.be.eq(minAmountNew);
    expect(await creditManager.maxAmount()).to.be.eq(maxAmountNew);
  });

  it("[CM-33]: setLimits reverts for non-configurator", async function () {
    const revertMsg = await errors.ACL_CALLER_NOT_CONFIGURATOR();
    const minAmountNew = WAD.mul(77823);
    const maxAmountNew = WAD.mul(1239203);

    await expect(
      creditManager.connect(user).setLimits(minAmountNew, maxAmountNew)
    ).to.be.revertedWith(revertMsg);
  });

  it("[CM-34]: setLimits reverts if maxAmount > minAmount", async function () {
    const revertMsg = await errors.CM_INCORRECT_LIMITS();
    const minAmountNew = WAD.mul(1239203);
    const maxAmountNew = WAD.mul(77823);

    await expect(
      creditManager.setLimits(minAmountNew, maxAmountNew)
    ).to.be.revertedWith(revertMsg);
  });

  it("[CM-35]: provideCreditAccountAllowance approves contracts correctly", async function () {
    await ts.openDefaultCreditAccount();

    const vaAddress = await creditManager.creditAccounts(user.address);

    // add some tokens to test that we will not run two allowances
    await tokenA.mint(vaAddress, userInitBalance);

    // we set friend as contract to be able make a token transfer
    expect(await tokenA.allowance(vaAddress, friend.address)).to.be.eq(0);

    // make user as adapter
    await creditFilter.allowContract(DUMB_ADDRESS, user.address);

    await creditManager
      .connect(user)
      .provideCreditAccountAllowance(vaAddress, friend.address, tokenA.address);
    expect(await tokenA.allowance(vaAddress, friend.address)).to.be.eq(MAX_INT);

    await tokenA
      .connect(friend)
      .transferFrom(vaAddress, DUMB_ADDRESS, userInitBalance);

    await creditManager
      .connect(user)
      .provideCreditAccountAllowance(vaAddress, friend.address, tokenA.address);
    expect(await tokenA.allowance(vaAddress, friend.address)).to.be.eq(
      MAX_INT.sub(userInitBalance)
    );
  });

  it("[CM-36]: setFees reverts for non-configurator and for incorrect values", async function () {
    const revertMsgNonConfig = await errors.ACL_CALLER_NOT_CONFIGURATOR();
    const revertMsgIncorrect = await errors.CM_INCORRECT_FEES();

    const incorrectValue = PERCENTAGE_FACTOR + 1;

    await expect(
      creditManager.connect(user).setFees(100, 100, 100, 100)
    ).to.be.revertedWith(revertMsgNonConfig);

    await expect(
      creditManager.setFees(incorrectValue, 100, 100, 100)
    ).to.be.revertedWith(revertMsgIncorrect);

    await expect(
      creditManager.setFees(100, incorrectValue, 100, 100)
    ).to.be.revertedWith(revertMsgIncorrect);

    await expect(
      creditManager.setFees(100, 100, incorrectValue, 100)
    ).to.be.revertedWith(revertMsgIncorrect);

    await expect(
      creditManager.setFees(100, 100, 100, incorrectValue)
    ).to.be.revertedWith(revertMsgIncorrect);
  });

  it("[CM-37]: setFees sets correct values & emits event", async function () {
    const feeSuccess = 456;
    const feeInterest = 2314;
    const feeLiquidation = 1934;
    const liquidationDiscount = 488;

    await expect(
      creditManager.setFees(
        feeSuccess,
        feeInterest,
        feeLiquidation,
        liquidationDiscount
      )
    )
      .to.emit(creditManager, "NewFees")
      .withArgs(feeSuccess, feeInterest, feeLiquidation, liquidationDiscount);

    expect(await creditManager.feeSuccess()).to.be.eq(feeSuccess);
    expect(await creditManager.feeInterest()).to.be.eq(feeInterest);
    expect(await creditManager.feeLiquidation()).to.be.eq(feeLiquidation);
    expect(await creditManager.liquidationDiscount()).to.be.eq(
      liquidationDiscount
    );
  });

  it("[CM-38]: repayCreditAccountETH reverts if called by non-weth gateway", async function () {
    const revertMsg = await errors.CM_WETH_GATEWAY_ONLY();
    // Open trader account
    await ts.openDefaultCreditAccount();

    await expect(
      creditManager
        .connect(liquidator)
        .repayCreditAccountETH(DUMB_ADDRESS, DUMB_ADDRESS)
    ).to.be.revertedWith(revertMsg);
  });

  it("[CM-39]: openCreditAccount, closeCreditAccount, liquidateCreditAccount, repayCreditAccount, repayCreditAccountETH, increaseBorrowedAmount, addCollateral reverts if contract is paused", async function () {
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
      creditManager.liquidateCreditAccount(DUMB_ADDRESS, DUMB_ADDRESS)
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

    // await expect(
    //     creditManager.connect(user).provideCreditAccountAllowance(DUMB_ADDRESS, DUMB_ADDRESS, DUMB_ADDRESS)
    // ).to.revertedWith(PAUSABLE_REVERT_MSG);
  });

  it("[CM-40]: constructor reverts if minHeathFactor is too high", async function () {
    const revertMsg = await errors.CM_MAX_LEVERAGE_IS_TOO_HIGH();
    const contractName = "CreditManager";

    const creditManagerArtifact = (await ethers.getContractFactory(
      contractName
    )) as CreditManager__factory;

    const addressProvider = await coreDeployer.getAddressProvider();

    await expect(
      creditManagerArtifact.deploy(
        addressProvider.address,
        0,
        1000,
        10000,
        poolService.address,
        ts.creditFilter.address,
        await integrationsDeployer.getUniswapAddress()
      )
    ).to.be.revertedWith(revertMsg);
  });

  it("[CM-41]: minHealthFactor computed correctly", async function () {
    await ts.openDefaultCreditAccount(maxLeverage);

    const va = await creditManager.creditAccounts(user.address);

    expect(await creditFilter.calcCreditAccountHealthFactor(va)).to.be.eq(
      await creditManager.minHealthFactor()
    );
  });

  // it("[CM-42]: closeCreditAccount reverts if loss accrued", async function () {
  //   const revertMsg = await errors.CM_CANT_CLOSE_WITH_LOSS();
  //   await ts.openDefaultCreditAccount();
  //
  //   await ts.getCreditAccountParameters(user.address);
  //
  //   const ciAtClose = RAY.mul(2);
  //   await poolService.setCumulative_RAY(ciAtClose);
  //
  //   await expect(
  //     creditManager
  //       .connect(user)
  //       .closeCreditAccount(friend.address, amountOutTolerance)
  //   ).to.be.revertedWith(revertMsg);
  // });

  it("[CM-43]: constructor reverts if underlying token is not consistent", async function () {
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

    await expect(
      creditManagerArtifact.deploy(
        addressProvider.address,
        0,
        1000,
        100,
        poolService.address,
        creditFilter.address,
        await integrationsDeployer.getUniswapAddress()
      )
    ).to.be.revertedWith(revertMsg);
  });

  // it("[CM-44]: closeCreditAccount converts tokens to underlying asset and correctly compute remaining amount", async function () {
  //   // Open default credit account
  //   await ts.openDefaultCreditAccount();
  //   await ts.setupUniswapV2Adapter();
  //
  //   const uniswapModel = ts.uniswapModel;
  //
  //   await creditManager
  //     .connect(user)
  //     .addCollateral(user.address, tokenA.address, swapAmountA);
  //
  //   // it moves timestamp in one year ahead to compute interest rate greater than 0
  //   // await ts.oneYearAhead();
  //   const newCumuativeIndex = RAY.mul(11).div(10);
  //   await ts.mockPoolService.setCumulative_RAY(newCumuativeIndex);
  //
  //   const rateRAY = ts.uniswapModel.getRate([
  //     tokenA.address,
  //     underlyingToken.address,
  //   ]);
  //
  //   const expectedClosureTrade = uniswapModel.swapExactTokensForTokens(
  //     swapAmountA,
  //     BigNumber.from(0),
  //
  //     [tokenA.address, underlyingToken.address]
  //   );
  //
  //   if (expectedClosureTrade.isReverted === true) {
  //     throw new Error("Unexpected revert");
  //   }
  //
  //   const expectedTokenAToUnderlying = BigNumber.from(
  //     expectedClosureTrade.amounts[1]
  //   );
  //
  //   const totalValue = amount
  //     .add(borrowedAmount)
  //     .add(expectedTokenAToUnderlying);
  //
  //   const borrowedAmountWithInterest = borrowedAmount
  //     .mul(newCumuativeIndex)
  //     .div(RAY); // rayMul(borrowedAmount, interestAccrued);
  //
  //   expect(
  //     expectedTokenAToUnderlying,
  //     "Expected token A to underlying"
  //   ).to.be.eq(
  //     swapAmountA
  //       .mul(rateRAY)
  //       .div(RAY)
  //       .mul(UniswapModel.FEE)
  //       .div(UniswapModel.FEE_discriminator)
  //   );
  //
  //   const feeSuccess = await creditManager.feeSuccess();
  //   const feeInterest = await creditManager.feeInterest();
  //
  //   const fee = percentMul(
  //     totalValue.sub(borrowedAmountWithInterest),
  //     feeSuccess.toNumber()
  //   ).add(
  //     percentMul(
  //       borrowedAmountWithInterest.sub(borrowedAmount),
  //       feeInterest.toNumber()
  //     )
  //   );
  //
  //   const expectedBalanceAfter = totalValue
  //     .sub(borrowedAmountWithInterest)
  //     .sub(fee)
  //     .sub(1); // 1 for Michael Egorov gas efficiency trick
  //
  //   //
  //   //  CLOSING CREDIT ACCOUNT
  //   //
  //
  //   await expect(
  //     creditManager
  //       .connect(user)
  //       .closeCreditAccount(friend.address, amountOutTolerance)
  //   )
  //     .to.emit(creditManager, "CloseCreditAccount")
  //     .withArgs(user.address, friend.address, expectedBalanceAfter);
  //
  //   expect(
  //     await underlyingToken.balanceOf(friend.address),
  //     "Remaining funds"
  //   ).to.be.eq(expectedBalanceAfter);
  // });
  //
  // it("[CM-45]: closeCreditAccount reverts if someone change uniswap rate dramatically", async function () {
  //   // Open default credit account
  //   await ts.openDefaultCreditAccount();
  //   await ts.setupUniswapV2Adapter();
  //
  //   await creditManager
  //     .connect(user)
  //     .addCollateral(user.address, tokenA.address, swapAmountA);
  //
  //   // Uniswap rate equals chainlink rate
  //   const rate = await ts.uniswapMock.getRate([
  //     tokenA.address,
  //     underlyingToken.address,
  //   ]);
  //   const edgeRate = rate.mul(amountOutTolerance).div(PERCENTAGE_FACTOR);
  //
  //   await ts.uniswapMock.setRate(
  //     tokenA.address,
  //     underlyingToken.address,
  //     edgeRate.sub(1)
  //   );
  //
  //   await expect(
  //     creditManager
  //       .connect(user)
  //       .closeCreditAccount(friend.address,amountOutTolerance)
  //   ).to.be.revertedWith("UniswapV2Router: INSUFFICIENT_OUTPUT_AMOUNT");
  // });


});

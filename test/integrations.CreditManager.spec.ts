import { expect } from "../utils/expect";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import * as chai from "chai";

import { CreditFilter, CreditManager, DieselToken, Errors, IPoolService, TokenMock } from "../types/ethers-v5";
import { CoreDeployer } from "../deployer/coreDeployer";
import { PoolDeployer } from "../deployer/poolDeployer";
import { IntegrationsDeployer } from "../deployer/integrationsDeployer";
import { TestDeployer } from "../deployer/testDeployer";
import { PoolTestSuite } from "../deployer/poolTestSuite";
import { CreditManagerTestSuite } from "../deployer/creditManagerTestSuite";



const { userInitBalance, addLiquidity } = PoolTestSuite;

const {
  uniswapInitBalance,
  amount,
  leverageFactor,
  borrowedAmount,
  maxLeverage,
  referral,
  ALLOWED_CONTRACT_1,
  ALLOWED_CONTRACT_2,
  amountOutTolerance,
} = CreditManagerTestSuite;

describe("Integrational CreditManager", function () {
  let ts: CreditManagerTestSuite;

  let deployer: SignerWithAddress;
  let coreDeployer: CoreDeployer;
  let integrationsDeployer: IntegrationsDeployer;
  let poolDeployer: PoolDeployer;
  let testDeployer: TestDeployer;

  let poolService: IPoolService;
  let creditManager: CreditManager;
  let creditFilter: CreditFilter;

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
    await ts.setupCreditManager();

    deployer = ts.deployer;
    coreDeployer = ts.coreDeployer;
    integrationsDeployer = ts.integrationsDeployer;
    poolDeployer = ts.poolDeployer;
    testDeployer = ts.testDeployer;

    poolService = ts.poolService;
    creditManager = ts.creditManager as CreditManager;
    creditFilter = ts.creditFilter;

    liquidityProvider = ts.liquidityProvider;
    user = ts.user;
    liquidator = ts.liquidator;
    friend = ts.friend;

    dieselToken = ts.dieselToken;
    underlyingToken = ts.underlyingToken;
    tokenA = ts.tokenA;
    errors = ts.errors;
  });

  //
  // OPEN CREDIT ACCOUNT
  //

  // it("[ICreditManager-1]: openCreditAccount transfers correct total amount of tokens to new credit account", async function () {
  //   // Open default credit account
  //   await ts.openDefaultCreditAccount();
  //
  //   expect(
  //     await creditManager.getCreditAccountTokenBalance(
  //       user.address,
  //       underlyingToken.address
  //     )
  //   ).to.be.eq(amount.add(borrowedAmount));
  //
  //   expect(await creditManager.calcCreditAccountTotalValue(user.address)).to.be.eq(
  //     amount.add(borrowedAmount)
  //   );
  // });
  //
  // it("[ICreditManager-2]: openCreditAccount sets correct borrow rate", async function () {
  //   // Open default credit account
  //   await ts.openDefaultCreditAccount();
  //
  //   const poolBorrowRate = await poolService.borrowAPY_RAY();
  //
  //   const modelBorrowRate = await poolDeployer.linearInterestRateModel.calcBorrowRate(
  //     addLiquidity,
  //     addLiquidity.sub(borrowedAmount)
  //   );
  //   const jsModelBorrowRate_RAY = poolDeployer.linearInterestRateModelJS.calcBorrowRate_RAY(
  //     addLiquidity,
  //     addLiquidity.sub(borrowedAmount)
  //   );
  //
  //   expect(jsModelBorrowRate_RAY).to.be.eq(modelBorrowRate);
  //   expect(poolBorrowRate).to.be.eq(modelBorrowRate);
  // });
  //
  //
  // it("[ICreditManager-3]: expectedLiquidity() returns correct value after Credit account was opened", async function () {
  //   // Open default credit account
  //   await ts.openDefaultCreditAccount();
  //   const totalLiquidityAtStart = await poolService.expectedLiquidity();
  //   const borrowRate = await poolService.borrowAPY_RAY();
  //   const initialTimestamp = await ts.getTimestamp();
  //
  //   for (let i = 0; i < 4; i++) {
  //     await ts.oneYearAhead();
  //
  //     const timeDifference = (await ts.getTimestamp()) - initialTimestamp;
  //
  //     // it could have difference in 1-2 wei
  //     const interestAccrued = borrowedAmount
  //       .mul(borrowRate)
  //       .mul(timeDifference)
  //       .div(SECONDS_PER_YEAR)
  //       .div(RAY);
  //
  //     const borrowAmountWithInterest = await creditManager.calcCreditAccountAccruedInterested(
  //       user.address
  //     );
  //     const expectedBorrowedAmountWithInterest = borrowedAmount.add(
  //       interestAccrued
  //     );
  //
  //     const diff = borrowAmountWithInterest
  //       .sub(expectedBorrowedAmountWithInterest)
  //       .abs();
  //
  //     expect(diff).to.be.lt(2);
  //
  //     const expectedTotalLiquidity = totalLiquidityAtStart
  //       .add(borrowAmountWithInterest)
  //       .sub(borrowedAmount);
  //
  //     expect(await poolService.expectedLiquidity()).to.be.eq(
  //       expectedTotalLiquidity
  //     );
  //   }
  // });
  //
  // //
  // // CLOSE ACCOUNT
  // //
  //
  // it("[ICreditManager-4]: closeCreditAccount correcly compute remaining funds", async function () {
  //   // Open default credit account
  //   const tsAtOpen = await ts.openDefaultCreditAccount();
  //
  //   await ts.oneYearAhead();
  //
  //   const [a, ciAtOpen, b] = await creditManager.getCreditAccountParameters(
  //       user.address
  //   );
  //
  //   const borrowRate = await poolService.borrowAPY_RAY();
  //
  //   const curTime = await ts.getTimestamp();
  //   const expectedBlockTime = curTime + 1;
  //
  //   const ciLinear = PoolServiceModel.ciLinear_RAY(
  //       borrowRate,
  //       expectedBlockTime,
  //       tsAtOpen
  //   );
  //
  //   const borrowedAmountWithInterest = PoolServiceModel.getBorrowedAmountWithInterest(
  //       borrowedAmount,
  //       ciLinear,
  //       ciAtOpen
  //   );
  //
  //   // user balance = amount + borrowed amount
  //   const fee = amount
  //       .add(borrowedAmount)
  //       .sub(borrowedAmountWithInterest)
  //       .mul(FEE)
  //       .div(PERCENTAGE_FACTOR);
  //
  //   const remainingFunds = amount
  //       .add(borrowedAmount)
  //       .sub(borrowedAmountWithInterest)
  //       .sub(fee)
  //       .sub(1); // 1 for Michael Egorov gas efficiency trick
  //
  //   await expect(
  //       creditManager
  //           .connect(user)
  //           .closeCreditAccount(friend.address, amountOutTolerance)
  //   )
  //       .to.emit(creditManager, "CloseCreditAccount")
  //       .withArgs(user.address, friend.address, remainingFunds);
  //
  //   expect(await underlyingToken.balanceOf(friend.address)).to.be.eq(
  //       remainingFunds
  //   );
  // });
  //
  // it("[ICreditManager-5]: closeCreditAccount updates total borrowed correct correctly", async function () {
  //   // Open default credit account
  //   await ts.openDefaultCreditAccount();
  //
  //   await ts.oneYearAhead();
  //
  //   await creditManager
  //       .connect(user)
  //       .closeCreditAccount(friend.address, amountOutTolerance);
  //
  //   expect(await poolService.totalBorrowed()).to.be.eq(0);
  // });
  //
  // it("[ICreditManager-6]: closeCreditAccount updates total liquidity correct correctly", async function () {
  //   // Open default credit account
  //   const tsAtOpen = await ts.openDefaultCreditAccount();
  //
  //   await ts.oneYearAhead();
  //
  //   const [a, ciAtOpen, b] = await creditManager.getCreditAccountParameters(
  //       user.address
  //   );
  //
  //   const borrowRate = await poolService.borrowAPY_RAY();
  //
  //   const totalLiquidityAtStart = addLiquidity;
  //
  //   // await ts.oneYearAhead();
  //
  //   const feeSize = FEE;
  //
  //   const receipt = await creditManager
  //       .connect(user)
  //       .closeCreditAccount(friend.address, amountOutTolerance);
  //
  //   const blockTime = await ts.getTimestamp(receipt.blockNumber);
  //
  //   const ciLinear = PoolServiceModel.ciLinear_RAY(
  //       borrowRate,
  //       blockTime,
  //       tsAtOpen
  //   );
  //
  //   const borrowedAmountWithInterest = PoolServiceModel.getBorrowedAmountWithInterest(
  //       borrowedAmount,
  //       ciLinear,
  //       ciAtOpen
  //   );
  //
  //   const interestAccrued = borrowedAmountWithInterest.sub(borrowedAmount);
  //
  //   const fee = amount.sub(interestAccrued).mul(feeSize).div(PERCENTAGE_FACTOR);
  //
  //   const totalLiquidityExpected = totalLiquidityAtStart
  //       .add(interestAccrued)
  //       .add(fee);
  //
  //   expect(await poolService.expectedLiquidity()).to.be.eq(
  //       totalLiquidityExpected
  //   );
  // });
  //
  // it("[ICreditManager-7]: closeCreditAccount mint fees diesel token correctly", async function () {
  //   const tsAtOpen = await ts.openDefaultCreditAccount();
  //
  //   await ts.oneYearAhead();
  //
  //   const [a, ciAtOpen, b] = await creditManager.getCreditAccountParameters(
  //       user.address
  //   );
  //
  //   const treasuryMock = await coreDeployer.getTreasuryMock();
  //   const treasuryBalanceBefore = await dieselToken.balanceOf(
  //       treasuryMock.address
  //   );
  //
  //   const borrowRate = await poolService.borrowAPY_RAY();
  //   const dieselSupply = await dieselToken.totalSupply();
  //
  //   const receipt = await creditManager
  //       .connect(user)
  //       .closeCreditAccount(friend.address, amountOutTolerance);
  //
  //   const blockTime = await ts.getTimestamp(receipt.timestamp);
  //
  //   const ciLinear = PoolServiceModel.ciLinear_RAY(
  //       borrowRate,
  //       blockTime,
  //       tsAtOpen
  //   );
  //
  //   const borrowedAmountWithInterest = PoolServiceModel.getBorrowedAmountWithInterest(
  //       borrowedAmount,
  //       ciLinear,
  //       ciAtOpen
  //   );
  //
  //   const expectedTotalLiquidity = PoolServiceModel.calcTotalLiquidity(
  //       addLiquidity,
  //       borrowedAmount,
  //       borrowRate,
  //       blockTime,
  //       tsAtOpen
  //   );
  //
  //   // user balance = amount x (1+leverage factor)
  //   const fee = amount
  //       .add(borrowedAmount)
  //       .sub(borrowedAmountWithInterest)
  //       .mul(FEE)
  //       .div(PERCENTAGE_FACTOR);
  //
  //   const dieselRate = PoolServiceModel.getDieselRate_RAY(
  //       expectedTotalLiquidity,
  //       dieselSupply
  //   );
  //
  //   const dieselSurplus = rayDiv(fee, dieselRate);
  //
  //   expect(await dieselToken.balanceOf(treasuryMock.address)).to.be.eq(
  //       treasuryBalanceBefore.add(dieselSurplus)
  //   );
  // });
  //
  // it("closeCreditAccount correctly update dieselRate in case amountSent>borrowedAmountWithInterest", async function () {
  //   const tsAtOpen = await ts.openDefaultCreditAccount();
  //
  //   await ts.oneYearAhead();
  //
  //   const [a, ciAtOpen, b] = await creditManager.getCreditAccountParameters(
  //       user.address
  //   );
  //
  //   const borrowRate = await poolService.borrowAPY_RAY();
  //   const dieselSupply = await dieselToken.totalSupply();
  //
  //   const d2 = await poolService.getDieselRate_RAY();
  //   const receipt = await creditManager
  //       .connect(user)
  //       .closeCreditAccount(friend.address, amountOutTolerance);
  //
  //   const expectedBlockTime = await ts.getTimestamp(receipt.blockNumber);
  //
  //   const ciLinear = PoolServiceModel.ciLinear_RAY(
  //       borrowRate,
  //       expectedBlockTime,
  //       tsAtOpen
  //   );
  //
  //   const borrowedAmountWithInterest = PoolServiceModel.getBorrowedAmountWithInterest(
  //       borrowedAmount,
  //       ciLinear,
  //       ciAtOpen
  //   );
  //
  //   const expectedTotalLiquidity = PoolServiceModel.calcTotalLiquidity(
  //       addLiquidity,
  //       borrowedAmount,
  //       borrowRate,
  //       expectedBlockTime,
  //       tsAtOpen
  //   );
  //
  //   const feeSize = FEE;
  //
  //   // user balance = amount x (1+leverage factor)
  //   const fee = amount
  //       .mul(leverageFactor + LEVERAGE_DECIMALS)
  //       .div(LEVERAGE_DECIMALS)
  //       .sub(borrowedAmountWithInterest)
  //       .mul(feeSize)
  //       .div(PERCENTAGE_FACTOR);
  //
  //   const ttl2 = await poolService.expectedLiquidity();
  //
  //   const dieselRate = PoolServiceModel.getDieselRate_RAY(
  //       expectedTotalLiquidity,
  //       dieselSupply
  //   );
  //
  //   const dieselSurplus = rayDiv(fee, dieselRate);
  //   const dieselSupply2 = dieselSupply.add(dieselSurplus);
  //
  //   const rate2 = PoolServiceModel.getDieselRate_RAY(
  //       expectedTotalLiquidity.add(fee),
  //       dieselSupply2
  //   );
  //
  //   expect(await poolService.getDieselRate_RAY()).to.be.eq(rate2);
  // });
  //
  // it("closeCreditAccount burns diesel tokens correctly in amountSent < borrowedAmountWithInterest", async function () {
  //   // we want to get borrowAmount * interestRate * t > amount + borrowAmount
  //   // amount * leverage * t > amount(1 + leverage)
  //   //
  //   //      1 + leverage
  //   // t > ---------------
  //   //         leverage
  //   //
  //   const dropsize =
  //       borrowedAmount.add(amount).mul(10000).div(amount).toNumber() + 1;
  //
  //   const tsAtOpen = await ts.liquidationSetup(dropsize);
  //
  //   const [a, ciAtOpen, b] = await creditManager.getCreditAccountParameters(
  //       user.address
  //   );
  //
  //   const borrowRate = await poolService.borrowAPY_RAY();
  //
  //   const dieselSupply = await dieselToken.totalSupply();
  //
  //   const treasuryMock = await coreDeployer.getTreasuryMock();
  //
  //   // transfer tokens to treasury to be able burn them
  //   const lpAmount = await dieselToken.balanceOf(liquidityProvider.address);
  //
  //   await dieselToken
  //       .connect(liquidityProvider)
  //       .transfer(treasuryMock.address, lpAmount);
  //
  //   const receipt = await creditManager
  //       .connect(user)
  //       .closeCreditAccount(friend.address, amountOutTolerance);
  //
  //   const blockTime = await ts.getTimestamp(receipt.blockNumber);
  //
  //   const ciLinear = PoolServiceModel.ciLinear_RAY(
  //       borrowRate,
  //       blockTime,
  //       tsAtOpen
  //   );
  //
  //   const borrowedAmountWithInterest = PoolServiceModel.getBorrowedAmountWithInterest(
  //       borrowedAmount,
  //       ciLinear,
  //       ciAtOpen
  //   );
  //
  //   const expectedTotalLiquidity = PoolServiceModel.calcTotalLiquidity(
  //       addLiquidity,
  //       borrowedAmount,
  //       borrowRate,
  //       blockTime,
  //       tsAtOpen
  //   );
  //
  //   // user balance = amount x (1+leverage factor) + 1 (from Michael Egorov optimisation)
  //   const shortage = borrowedAmountWithInterest
  //       .sub(amount.add(borrowedAmount))
  //       .add(1);
  //
  //   const dieselRate = PoolServiceModel.getDieselRate_RAY(
  //       expectedTotalLiquidity,
  //       dieselSupply
  //   );
  //
  //   const shortageDiesel = rayDiv(shortage, dieselRate);
  //
  //   expect(await dieselToken.balanceOf(treasuryMock.address)).to.be.eq(
  //       lpAmount.sub(shortageDiesel)
  //   );
  // });
  //
  // it("closeCreditAccount updates borrow rate correct correctly", async function () {
  //   // Open default credit account
  //   await ts.openDefaultCreditAccount();
  //
  //   const blockNum = await ethers.provider.getBlockNumber();
  //   const currentBlockchainTime = await ethers.provider.getBlock(blockNum);
  //   const oneYearLater = currentBlockchainTime.timestamp + SECONDS_PER_YEAR;
  //   await ethers.provider.send("evm_mine", [oneYearLater]);
  //
  //   await creditManager
  //       .connect(user)
  //       .closeCreditAccount(friend.address, amountOutTolerance);
  //
  //   expect(await poolService.borrowAPY_RAY()).to.be.eq(0);
  // });
  //
  // it("closeCreditAccount remove hasOpenedAccount property", async function () {
  //   // Open default credit account
  //   await ts.openDefaultCreditAccount();
  //
  //   await creditManager
  //       .connect(user)
  //       .closeCreditAccount(friend.address, amountOutTolerance);
  //   expect(await creditManager.hasOpenedCreditAccount(user.address)).to.be.false;
  // });
  //
  // it("closeCreditAccount transfer remaining funds to borrower account correctly", async function () {
  //   // Open default credit account
  //   const tsAtOpen = await ts.openDefaultCreditAccount();
  //
  //   const [a, ciAtOpen, b] = await creditManager.getCreditAccountParameters(
  //       user.address
  //   );
  //
  //   const borrowRate = await poolService.borrowAPY_RAY();
  //
  //   const receipt = await creditManager
  //       .connect(user)
  //       .closeCreditAccount(friend.address, amountOutTolerance);
  //
  //   const blockTime = await ts.getTimestamp(receipt.blockNumber);
  //
  //   // Так как у нас закрытие вначале - едет математика
  //
  //   const ciLinear = PoolServiceModel.ciLinear_RAY(
  //       borrowRate,
  //       blockTime,
  //       tsAtOpen
  //   );
  //
  //   const borrowedAmountWithInterest = PoolServiceModel.getBorrowedAmountWithInterest(
  //       borrowedAmount,
  //       ciLinear,
  //       ciAtOpen
  //   );
  //
  //   const fee = amount
  //       .mul(leverageFactor + LEVERAGE_DECIMALS)
  //       .div(LEVERAGE_DECIMALS)
  //       .sub(borrowedAmountWithInterest)
  //       .mul(FEE)
  //       .div(PERCENTAGE_FACTOR);
  //
  //   const remainingFunds = amount
  //       .add(borrowedAmount)
  //       .sub(borrowedAmountWithInterest)
  //       .sub(fee);
  //
  //   expect(await underlyingToken.balanceOf(friend.address)).to.be.eq(
  //       remainingFunds.sub(1) // Michael Egorov efficiency trick
  //   );
  // });
  //
  //
  //
  //
  //
  // // it("calcCreditAccountHealthFactor computes health factor correct", async function () {
  // //   // Open default credit account
  // //   await ts.openDefaultCreditAccount();
  // //
  // //   const healthFactor = await creditManager.calcCreditAccountHealthFactor(
  // //     user.address
  // //   );
  // //
  // //   // ToDo: Make correct calculation!
  // //   const expectedHealthFactor = BigNumber.from(0)
  // //     .mul(leverageFactor + 1)
  // //     .div(leverageFactor);
  // //   expect(healthFactor).to.be.eq(expectedHealthFactor);
  // // });
  //
  // it("hasOpenedCreditAccount works correctly", async function () {
  //   // Adding liquidity
  //   await poolService
  //     .connect(liquidityProvider)
  //     .addLiquidity(addLiquidity, liquidityProvider.address, referral);
  //
  //   // Open trader account
  //   expect(await creditManager.hasOpenedCreditAccount(user.address)).to.be.false;
  //   // Open trader account
  //   await creditManager
  //     .connect(user)
  //     .openCreditAccount(amount, user.address, leverageFactor, referral);
  //   expect(await creditManager.hasOpenedCreditAccount(user.address)).to.be.true;
  // });
  //
  // // This statement protects protocol from FlashLoan attack
  // it("closeCreditAccount, repayCreditAccount reverts if called the same block as OpenCreditAccount", async function () {
  //   // Adding liquidity
  //   await poolService
  //     .connect(liquidityProvider)
  //     .addLiquidity(addLiquidity, liquidityProvider.address, referral);
  //
  //   const flashLoanAttacker = await testDeployer.getFlashLoanAttacker(
  //     creditManager.address
  //   );
  //
  //   await underlyingToken.mint(flashLoanAttacker.address, userInitBalance);
  //
  //   const revertMsg = await errors.CreditManager_VIRTUAL_ACCOUNT_CLOSE_THE_SAME_BLOCK();
  //   await expect(
  //     flashLoanAttacker.attackClose(amount, leverageFactor)
  //   ).to.revertedWith(revertMsg);
  //
  //   await expect(
  //     flashLoanAttacker.attackRepay(amount, leverageFactor)
  //   ).to.revertedWith(revertMsg);
  // });
  //
  //
  //
  // //
  // // LIQUIDATE ACCOUNT
  // //
  //
  // it("liquidateCreditAccount reverts for borrower who has no opened credit account", async function () {
  //   const revertMsg = await errors.CreditManager_NO_OPEN_ACCOUNT();
  //   await expect(
  //     creditManager
  //       .connect(friend)
  //       .liquidateCreditAccount(user.address, friend.address)
  //   ).to.revertedWith(revertMsg);
  // });
  //
  // it("liquidateCreditAccount works with health factor <1 and emit correct events", async function () {
  //   await underlyingToken.mint(liquidator.address, userInitBalance);
  //   await underlyingToken
  //     .connect(liquidator)
  //     .approve(creditManager.address, MAX_INT);
  //
  //   const tsAtOpen = await ts.liquidationSetup();
  //
  //   const [a, ciAtOpen, b] = await creditManager.getCreditAccountParameters(
  //     user.address
  //   );
  //
  //   const borrowRate = await poolService.borrowAPY_RAY();
  //
  //   const curTime = await ts.getTimestamp();
  //
  //   const blockTime = curTime + 1;
  //
  //   const ciLinear = PoolServiceModel.ciLinear_RAY(
  //     borrowRate,
  //     blockTime,
  //     tsAtOpen
  //   );
  //
  //   const borrowedAmountWithInterest = PoolServiceModel.getBorrowedAmountWithInterest(
  //     borrowedAmount,
  //     ciLinear,
  //     ciAtOpen
  //   );
  //
  //   const totalFunds = amount
  //     .add(borrowedAmount)
  //     .mul(LIQUIDATION_DISCOUNTED_SUM)
  //     .div(PERCENTAGE_FACTOR);
  //
  //   const fee = totalFunds
  //     .sub(borrowedAmountWithInterest)
  //     .mul(FEE_LIQUIDATION)
  //     .div(PERCENTAGE_FACTOR);
  //
  //   // Minus liquidation Premium(!)
  //   const remainingFunds = totalFunds
  //     .sub(borrowedAmountWithInterest)
  //     .sub(fee)
  //     .sub(1); // Michael Egorov gas optimisation
  //
  //   await expect(
  //     creditManager
  //       .connect(liquidator)
  //       .liquidateCreditAccount(user.address, friend.address)
  //   )
  //     .to.emit(creditManager, "LiquidateCreditAccount")
  //     .withArgs(user.address, liquidator.address, remainingFunds);
  // });
  //
  // it("liquidateCreditAccount transfers all tokens to liquidator", async function () {
  //   await underlyingToken.mint(liquidator.address, userInitBalance);
  //   await underlyingToken
  //     .connect(liquidator)
  //     .approve(creditManager.address, MAX_INT);
  //
  //   const initFriendBalance = await underlyingToken.balanceOf(friend.address);
  //
  //   await ts.liquidationSetup();
  //
  //   await creditManager
  //     .connect(liquidator)
  //     .liquidateCreditAccount(user.address, friend.address);
  //
  //   expect(await underlyingToken.balanceOf(friend.address)).to.be.eq(
  //     initFriendBalance.add(amount).add(borrowedAmount).sub(1)
  //   );
  // });
  //
  // //
  // // REPAY ACCOUNT
  // //
  //
  // it("repayCreditAccount takes correct amount from borrower and send assets to provided account", async function () {
  //   const tsAtOpen = await ts.openDefaultCreditAccount();
  //
  //   const [a, ciAtOpen, b] = await creditManager.getCreditAccountParameters(
  //     user.address
  //   );
  //
  //   const borrowRate = await poolService.borrowAPY_RAY();
  //
  //   const vaAddress = await creditManager.creditAccounts(user.address);
  //   await tokenA.mint(vaAddress, uniswapInitBalance);
  //
  //   const receipt = await creditManager
  //     .connect(user)
  //     .repayCreditAccount(friend.address);
  //
  //   const blockTime = await ts.getTimestamp(receipt.blockNumber);
  //
  //   const ciLinear = PoolServiceModel.ciLinear_RAY(
  //     borrowRate,
  //     blockTime,
  //     tsAtOpen
  //   );
  //
  //   const borrowedAmountWithInterest = PoolServiceModel.getBorrowedAmountWithInterest(
  //     borrowedAmount,
  //     ciLinear,
  //     ciAtOpen
  //   );
  //
  //   const fee = amount
  //     // we should uniswapInitBalance, cause rate is 1, we set one chainlink mock for both assets
  //     .add(uniswapInitBalance)
  //     .add(borrowedAmount)
  //     .sub(borrowedAmountWithInterest)
  //     .mul(FEE)
  //     .div(PERCENTAGE_FACTOR);
  //
  //   const repayCost = borrowedAmountWithInterest.add(fee);
  //
  //   expect(await underlyingToken.balanceOf(user.address)).to.be.eq(
  //     userInitBalance.sub(amount).sub(repayCost)
  //   );
  //
  //   expect(await underlyingToken.balanceOf(friend.address)).to.be.eq(
  //     amount.add(borrowedAmount).sub(1)
  //   );
  //
  //   expect(await tokenA.balanceOf(friend.address)).to.be.eq(
  //     uniswapInitBalance.sub(1)
  //   ); // we take 1 for Michain Egorov optimisation
  // });
  //
  // //
  // // INCREASE BORROW AMOUNT
  // //
  //
  // it("increaseBorrowedAmountCreditAccount reverts of health factor < Constants.HEALTH_FACTOR_MIN_AFTER_UPDATE", async function () {
  //   await ts.openDefaultCreditAccount();
  //
  //   const revertMsg = await errors.CreditManager_CAN_UPDATE_WITH_SUCH_HEALTH_FACTOR();
  //
  //   const availableAmount = await poolService.availableLiquidity();
  //
  //   await expect(
  //     creditManager.connect(user).increaseBorrowedAmount(availableAmount.sub(1))
  //   ).to.be.revertedWith(revertMsg);
  // });
  //
  // it("increaseBorrowedAmountCreditAccount transfers correct amount", async function () {
  //   await ts.openDefaultCreditAccount(1);
  //
  //   const creditAccountAddress = await creditManager.creditAccounts(user.address);
  //
  //   const creditAccount = await testDeployer.getCreditAccount(
  //     creditAccountAddress
  //   );
  //
  //   const increasedAmount = 1e5;
  //
  //   await expect(() =>
  //     creditManager.connect(user).increaseBorrowedAmount(increasedAmount)
  //   ).to.changeTokenBalances(
  //     underlyingToken,
  //     [poolService, creditAccount],
  //     [-increasedAmount, increasedAmount]
  //   );
  // });
  //
  // it("increaseBorrowedAmountCreditAccount correctly update borrowed amount and total borrow", async function () {
  //   await ts.openDefaultCreditAccount(1);
  //
  //   await ts.oneYearAhead();
  //
  //   const increasedAmount = BigNumber.from(1e5);
  //
  //   const totalBorrowedBefore = await poolService.totalBorrowed();
  //   const [
  //     borrowedAmountBefore,
  //     ciAtOpen,
  //     b,
  //   ] = await creditManager.getCreditAccountParameters(user.address);
  //
  //   await creditManager.connect(user).increaseBorrowedAmount(increasedAmount);
  //
  //   const cumIndex = await poolService.calcLinearCumulative_RAY();
  //
  //   const [
  //     borrowedAmountBefore2,
  //     ciAtOpen2,
  //     b2,
  //   ] = await creditManager.getCreditAccountParameters(user.address);
  //
  //   expect(borrowedAmountBefore2).to.be.eq(
  //     borrowedAmountBefore.add(increasedAmount.mul(ciAtOpen).div(cumIndex))
  //   );
  //
  //   expect(await poolService.totalBorrowed()).to.be.eq(
  //     totalBorrowedBefore.add(increasedAmount)
  //   );
  // });
  //
  // it("provideCreditAccountAllowance approves contracts correctly", async function () {
  //   // Need to new PoolDeployer
  //   ts = new CreditManagerTestSuite();
  //   await ts.getSuite();
  //
  //   poolDeployer = ts.poolDeployer;
  //
  //   await ts.setupTestCreditManager();
  //
  //   creditManager = ts.creditManager as TestCreditManager;
  //
  //   poolService = ts.poolService;
  //   underlyingToken = ts.underlyingToken;
  //   tokenA = ts.tokenA;
  //
  //   await ts.openDefaultCreditAccount();
  //
  //   const vaAddress = await creditManager.creditAccounts(user.address);
  //
  //   // add some tokens to test that we will not run two allowances
  //   await tokenA.mint(vaAddress, userInitBalance);
  //
  //   // we set friend as contract to be able make a token transfer
  //   expect(await tokenA.allowance(vaAddress, friend.address)).to.be.eq(0);
  //   await creditManager
  //     .connect(user)
  //     .provideCreditAccountAllowance(friend.address, tokenA.address);
  //   expect(await tokenA.allowance(vaAddress, friend.address)).to.be.eq(MAX_INT);
  //
  //   await tokenA
  //     .connect(friend)
  //     .transferFrom(vaAddress, DUMB_ADDRESS, userInitBalance);
  //
  //   await creditManager
  //     .connect(user)
  //     .provideCreditAccountAllowance(friend.address, tokenA.address);
  //   expect(await tokenA.allowance(vaAddress, friend.address)).to.be.eq(
  //     MAX_INT.sub(userInitBalance)
  //   );
  // });
  //
  // it("closeCreditAccount, repayCreditAccount, liquidateCreditAccount reverts if user has no account", async function () {
  //   const revertMsg = await errors.CreditManager_NO_OPEN_ACCOUNT();
  //   // Open trader account
  //   await expect(
  //     creditManager
  //       .connect(user)
  //       .closeCreditAccount(DUMB_ADDRESS, amountOutTolerance)
  //   ).to.be.revertedWith(revertMsg);
  //
  //   await expect(
  //     creditManager.connect(user).repayCreditAccount(DUMB_ADDRESS)
  //   ).to.be.revertedWith(revertMsg);
  //
  //   await expect(
  //     creditManager
  //       .connect(user)
  //       .liquidateCreditAccount(DUMB_ADDRESS, DUMB_ADDRESS)
  //   ).to.be.revertedWith(revertMsg);
  // });
  //
  // it("liquidateCreditAccount, reverts if Hf >1", async function () {
  //   const revertMsg = await errors.CreditManager_CAN_LIQUIDATE_WITH_SUCH_HEALTH_FACTOR();
  //   // Open trader account
  //   await ts.openDefaultCreditAccount();
  //
  //   await expect(
  //     creditManager
  //       .connect(liquidator)
  //       .liquidateCreditAccount(user.address, liquidator.address)
  //   ).to.be.revertedWith(revertMsg);
  // });
  //
  // // it("getAllowedSwapContractsCount, getAllowedSwapContractById returns correct values", async function () {
  // //   expect(await creditManager.allowedContractsCount()).to.be.eq(2);
  // //   expect(await creditManager.allowedContracts(0)).to.be.hexEqual(
  // //     ALLOWED_CONTRACT_1
  // //   );
  // //   expect(await creditManager.allowedContracts(1)).to.be.hexEqual(
  // //     ALLOWED_CONTRACT_2
  // //   );
  // // });
  //
  // // it("allowedTokensCount allowedTokens returns correct values", async function () {
  // //   expect(await creditManager.allowedTokensCount()).to.be.eq(2);
  // //   expect(await creditManager.allowedTokens(0)).to.be.hexEqual(
  // //     underlyingToken.address
  // //   );
  // //   expect(await creditManager.allowedTokens(1)).to.be.hexEqual(tokenA.address);
  // // });
  //
  // it("setLimits sets correct values", async function () {
  //   const minAmountNew = WAD.mul(77823);
  //   const maxAmountNew = WAD.mul(1239203);
  //
  //   await creditManager.setLimits(minAmountNew, maxAmountNew);
  //   expect(await creditManager.minAmount()).to.be.eq(minAmountNew);
  //   expect(await creditManager.maxAmount()).to.be.eq(maxAmountNew);
  // });
  //
  // it("setLimits reverts for non-configurator", async function () {
  //   const revertMsg = await errors.ACL_CALLER_NOT_CONFIGURATOR();
  //   const minAmountNew = WAD.mul(77823);
  //   const maxAmountNew = WAD.mul(1239203);
  //
  //   await expect(
  //     creditManager.connect(user).setLimits(minAmountNew, maxAmountNew)
  //   ).to.be.revertedWith(revertMsg);
  // });
  //
  // it("setLimits reverts if maxAmount > minAmount", async function () {
  //   const revertMsg = await errors.CreditManager_INCORRECT_LIMITS();
  //   const minAmountNew = WAD.mul(1239203);
  //   const maxAmountNew = WAD.mul(77823);
  //
  //   await expect(
  //     creditManager.setLimits(minAmountNew, maxAmountNew)
  //   ).to.be.revertedWith(revertMsg);
  // });
  //
  // it("repayCreditAccountETH reverts if called by non-weth gateway", async function () {
  //   const revertMsg = await errors.CreditManager_WETH_GATEWAY_ONLY();
  //   // Open trader account
  //   await ts.openDefaultCreditAccount();
  //
  //   await expect(
  //     creditManager
  //       .connect(liquidator)
  //       .repayCreditAccountETH(DUMB_ADDRESS, DUMB_ADDRESS)
  //   ).to.be.revertedWith(revertMsg);
  // });
});

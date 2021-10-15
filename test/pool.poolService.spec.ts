// @ts-ignore
import { ethers } from "hardhat";
import { expect } from "../utils/expect";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import {
  ADDRESS_0x0,
  MAX_INT,
  PERCENTAGE_FACTOR,
  percentMul,
  RAY,
  rayDiv,
  rayMul,
  SECONDS_PER_YEAR,
} from "@diesellabs/gearbox-sdk";

import {
  DieselToken,
  Errors,
  TestPoolService,
  TokenMock,
} from "../types/ethers-v5";
import { CoreDeployer } from "../deployer/coreDeployer";
import { PoolDeployer } from "../deployer/poolDeployer";
import { PoolTestSuite } from "../deployer/poolTestSuite";
import { CreditManagerTestSuite } from "../deployer/creditManagerTestSuite";
import { DUMB_ADDRESS, PAUSABLE_REVERT_MSG } from "../core/constants";
import { BigNumber } from "ethers";
import { LinearInterestRateModelDeployer } from "../deployer/linearIRModelDeployer";

const {
  liquidityProviderInitBalance,
  addLiquidity,
  removeLiquidity,
  referral,
} = PoolTestSuite;

describe("PoolService", function () {
  let ts: PoolTestSuite;
  let deployer: SignerWithAddress;
  let coreDeployer: CoreDeployer;
  let poolDeployer: PoolDeployer;

  let poolService: TestPoolService;

  let liquidityProvider: SignerWithAddress;
  let user: SignerWithAddress;
  let friend: SignerWithAddress;

  let dieselToken: DieselToken;
  let underlyingToken: TokenMock;
  let errors: Errors;

  beforeEach(async () => {
    ts = new PoolTestSuite();
    await ts.getSuite();
    await ts.setupPoolService(true);

    deployer = ts.deployer;
    coreDeployer = ts.coreDeployer;
    poolDeployer = ts.poolDeployer;

    poolService = ts.poolService as TestPoolService;

    liquidityProvider = ts.liquidityProvider;
    user = ts.user;
    friend = ts.friend;

    dieselToken = ts.dieselToken;
    underlyingToken = ts.underlyingToken;
    errors = ts.errors;
  });

  it("[PS-1]: getDieselRate_RAY=RAY, withdrawFee=0 and expectedLiquidityLimit as expected at start", async () => {
    expect(await poolService.getDieselRate_RAY()).to.be.eq(RAY);
    expect(await poolService.withdrawFee()).to.be.eq(0);
    expect(await poolService.expectedLiquidityLimit()).to.be.eq(MAX_INT);
  });

  it("[PS-2]: addLiquidity correctly adds liquidity", async () => {
    await expect(
      poolService
        .connect(liquidityProvider)
        .addLiquidity(addLiquidity, friend.address, referral)
    )
      .to.emit(poolService, "AddLiquidity")
      .withArgs(
        liquidityProvider.address,
        friend.address,
        addLiquidity,
        referral
      );

    expect(await dieselToken.balanceOf(friend.address)).to.be.eq(addLiquidity);
    expect(await underlyingToken.balanceOf(liquidityProvider.address)).to.be.eq(
      liquidityProviderInitBalance.sub(addLiquidity)
    );
    expect(await poolService.expectedLiquidity()).to.be.eq(addLiquidity);
    expect(await poolService.availableLiquidity()).to.be.eq(addLiquidity);
  });

  it("[PS-3]: removeLiquidity correctly removes liquidity", async () => {
    // Adds liquidity to pool
    await poolService
      .connect(liquidityProvider)
      .addLiquidity(addLiquidity, friend.address, referral);

    // It emits RemoveLiquidity event
    await expect(
      poolService
        .connect(friend)
        .removeLiquidity(removeLiquidity, liquidityProvider.address)
    )
      .to.emit(poolService, "RemoveLiquidity")
      .withArgs(friend.address, liquidityProvider.address, removeLiquidity);

    // It correctly burns diesel tokens
    expect(await dieselToken.balanceOf(friend.address)).to.be.eq(
      addLiquidity.sub(removeLiquidity)
    );

    // It correctly returns underlying asset
    expect(await underlyingToken.balanceOf(liquidityProvider.address)).to.be.eq(
      liquidityProviderInitBalance.sub(addLiquidity).add(removeLiquidity)
    );

    // It correctly updates total liquidity
    expect(await poolService.expectedLiquidity()).to.be.eq(
      addLiquidity.sub(removeLiquidity)
    );

    // It correctly updates available liquidity
    expect(await poolService.availableLiquidity()).to.be.eq(
      addLiquidity.sub(removeLiquidity)
    );
  });

  it("[PS-4]: addLiquidity, removeLiquidity, lendCreditAccount reverts if contract is paused", async () => {
    const acl = await coreDeployer.getACL();
    await acl.addPausableAdmin(deployer.address);
    await acl.addUnpausableAdmin(deployer.address);

    await poolService.connect(deployer).pause();

    await expect(
      poolService
        .connect(liquidityProvider)
        .addLiquidity(addLiquidity, liquidityProvider.address, referral)
    ).to.revertedWith(PAUSABLE_REVERT_MSG);

    await poolService.connect(deployer).unpause();

    await poolService
      .connect(liquidityProvider)
      .addLiquidity(addLiquidity, liquidityProvider.address, referral);
    await poolService.connect(deployer).pause();

    await expect(
      poolService
        .connect(liquidityProvider)
        .removeLiquidity(0, liquidityProvider.address)
    ).to.revertedWith(PAUSABLE_REVERT_MSG);

    await expect(
      poolService.lendCreditAccount(120, liquidityProvider.address)
    ).to.revertedWith(PAUSABLE_REVERT_MSG);

    await expect(poolService.repayCreditAccount(1, 1, 1)).to.revertedWith(
      PAUSABLE_REVERT_MSG
    );
  });

  it("[PS-5]: constructor set correct cumulative index to 1 at start", async () => {
    expect(await poolService.getCumulativeIndex_RAY()).to.be.eq(RAY);
  });

  it("[PS-6]: getDieselRate_RAY correctly computes rate", async () => {
    await poolService
      .connect(liquidityProvider)
      .addLiquidity(addLiquidity, liquidityProvider.address, referral);

    // increase total liquidity x2, which should make getRay x2 also
    await poolService.setExpectedLiquidity(addLiquidity.mul(2));
    expect(await poolService.expectedLiquidity()).to.be.eq(addLiquidity.mul(2));

    expect(await poolService.getDieselRate_RAY()).to.be.eq(RAY.mul(2));
  });

  it("[PS-7]: addLiquidity correctly adds liquidity with DieselRate != 1", async () => {
    await poolService
      .connect(liquidityProvider)
      .addLiquidity(addLiquidity, liquidityProvider.address, referral);

    // increase total liquidity x2, which should make getRay x2 also
    await poolService.setExpectedLiquidity(addLiquidity.mul(2));

    await expect(
      poolService
        .connect(liquidityProvider)
        .addLiquidity(addLiquidity, friend.address, referral)
    )
      .to.emit(poolService, "AddLiquidity")
      .withArgs(
        liquidityProvider.address,
        friend.address,
        addLiquidity,
        referral
      );

    // it's expected to get 2 times less tokens, cause rate x2
    const dieselTokenExpected = addLiquidity.div(2);

    expect(await dieselToken.balanceOf(friend.address)).to.be.eq(
      dieselTokenExpected
    );

    // LP balance = initial balance - addLiquidity x2
    expect(await underlyingToken.balanceOf(liquidityProvider.address)).to.be.eq(
      liquidityProviderInitBalance.sub(addLiquidity.mul(2))
    );
    // We set x2 loquidity and add x1 liquidity
    expect(await poolService.expectedLiquidity()).to.be.eq(addLiquidity.mul(3));

    // We add liquidy twice
    expect(await poolService.availableLiquidity()).to.be.eq(
      addLiquidity.mul(2)
    );
  });

  it("[PS-8]: removeLiquidity correctly removes liquidity if diesel rate != 1", async () => {
    // Adds liquiditity to pool
    await poolService
      .connect(liquidityProvider)
      .addLiquidity(addLiquidity, friend.address, referral);

    // We set total liquidity to x2. It's like diesel tokens costs x2 underlying ones
    await poolService.setExpectedLiquidity(addLiquidity.mul(2));

    // It emits RemoveLiquidity event
    await expect(
      poolService
        .connect(friend)
        .removeLiquidity(removeLiquidity, liquidityProvider.address)
    )
      .to.emit(poolService, "RemoveLiquidity")
      .withArgs(friend.address, liquidityProvider.address, removeLiquidity);

    // It correctly burns diesel tokens
    expect(await dieselToken.balanceOf(friend.address)).to.be.eq(
      addLiquidity.sub(removeLiquidity)
    );

    // It correctly returns underlying asset
    expect(await underlyingToken.balanceOf(liquidityProvider.address)).to.be.eq(
      liquidityProviderInitBalance.sub(addLiquidity).add(removeLiquidity.mul(2))
    );

    // Total liqudity = 2x addLiquity (as it set before0 - removeLiquidty x2
    expect(await poolService.expectedLiquidity()).to.be.eq(
      addLiquidity.mul(2).sub(removeLiquidity.mul(2))
    );

    // It correctly updates available liquidity
    expect(await poolService.availableLiquidity()).to.be.eq(
      addLiquidity.sub(removeLiquidity.mul(2))
    );
  });

  it("[PS-9]: connectCreditManager, forbidCreditManagerToBorrow, newInterestRateModel, setExpecetedLiquidityLimit reverts if called with non-configurator", async () => {
    const revertMsg = await errors.ACL_CALLER_NOT_CONFIGURATOR();

    await expect(
      poolService.connect(liquidityProvider).connectCreditManager(DUMB_ADDRESS)
    ).to.revertedWith(revertMsg);

    await expect(
      poolService
        .connect(liquidityProvider)
        .forbidCreditManagerToBorrow(DUMB_ADDRESS)
    ).to.revertedWith(revertMsg);

    await expect(
      poolService
        .connect(liquidityProvider)
        .updateInterestRateModel(DUMB_ADDRESS)
    ).to.revertedWith(revertMsg);

    await expect(
      poolService.connect(liquidityProvider).setExpectedLiquidityLimit(0)
    ).to.revertedWith(revertMsg);

    await expect(
      poolService.connect(liquidityProvider).setWithdrawFee(0)
    ).to.revertedWith(revertMsg);
  });

  it("[PS-10]: connectCreditManager reverts if another pool is setup in CreditManager", async () => {
    const revertMsg = await errors.POOL_INCOMPATIBLE_CREDIT_ACCOUNT_MANAGER();

    const vts = new CreditManagerTestSuite();
    await vts.getSuite();
    await vts.setupCreditManager();

    await expect(
      poolService.connectCreditManager(vts.creditManager.address)
    ).to.revertedWith(revertMsg);
  });

  it("[PS-11]: connectCreditManager adds CreditManager correctly and emits event", async () => {
    const vts = new CreditManagerTestSuite();
    await vts.getSuite({ poolService });

    expect(await poolService.creditManagersCount()).to.be.eq(0);

    const events = await poolService.queryFilter(
      poolService.filters.NewCreditManagerConnected(null)
    );
    expect(events.length).to.be.eq(0);

    await vts.setupCreditManager();

    expect(await poolService.creditManagersCount()).to.be.eq(1);
    expect(await poolService.creditManagers(0)).to.be.eq(
      vts.creditManager.address
    );
    expect(await poolService.creditManagersCanBorrow(vts.creditManager.address))
      .to.be.true;
    expect(await poolService.creditManagersCanRepay(vts.creditManager.address))
      .to.be.true;

    const eventsAfter = await poolService.queryFilter(
      poolService.filters.NewCreditManagerConnected(vts.creditManager.address)
    );
    expect(eventsAfter.length).to.be.eq(1);
  });

  it("[PS-12]: lendCreditAccount, repayCreditAccount reverts if called non-CreditManager", async () => {
    const revertMsg = await errors.POOL_CONNECTED_CREDIT_MANAGERS_ONLY();
    await expect(
      poolService.lendCreditAccount(0, DUMB_ADDRESS)
    ).to.be.revertedWith(revertMsg);
    await expect(poolService.repayCreditAccount(0, 0, 0)).to.be.revertedWith(
      revertMsg
    );
  });

  it("[PS-13]: lendCreditAccount reverts of creditManagers was disallowed by forbidCreditManagerToBorrow", async () => {
    const revertMsg = await errors.POOL_CONNECTED_CREDIT_MANAGERS_ONLY();
    const creditManagerMock =
      await ts.testDeployer.getCreditManagerMockForPoolTest(
        poolService.address
      );

    await poolService
      .connect(liquidityProvider)
      .addLiquidity(addLiquidity, friend.address, referral);

    await poolService.connectCreditManager(creditManagerMock.address);

    const borrowedAmount = addLiquidity.div(2);
    await creditManagerMock.lendCreditAccount(
      borrowedAmount,
      creditManagerMock.address
    );

    await expect(
      poolService.forbidCreditManagerToBorrow(creditManagerMock.address)
    )
      .to.emit(poolService, "BorrowForbidden")
      .withArgs(creditManagerMock.address);

    await expect(
      creditManagerMock.lendCreditAccount(
        borrowedAmount,
        creditManagerMock.address
      )
    ).to.be.revertedWith(revertMsg);
  });

  it("[PS-14]: lendCreditAccount lends transfers tokens correctly", async () => {
    const creditManagerMock =
      await ts.testDeployer.getCreditManagerMockForPoolTest(
        poolService.address
      );

    await poolService
      .connect(liquidityProvider)
      .addLiquidity(addLiquidity, friend.address, referral);

    await poolService.connectCreditManager(creditManagerMock.address);

    const borrowedAmount = addLiquidity.div(2);

    const cmBalanceBefore = await underlyingToken.balanceOf(
      creditManagerMock.address
    );

    await creditManagerMock.lendCreditAccount(
      borrowedAmount,
      creditManagerMock.address
    );

    expect(await underlyingToken.balanceOf(creditManagerMock.address)).to.be.eq(
      cmBalanceBefore.add(borrowedAmount)
    );
  });

  it("[PS-15]: lendCreditAccount emits Borrow event", async () => {
    const creditManagerMock =
      await ts.testDeployer.getCreditManagerMockForPoolTest(
        poolService.address
      );

    await poolService
      .connect(liquidityProvider)
      .addLiquidity(addLiquidity, friend.address, referral);

    await poolService.connectCreditManager(creditManagerMock.address);
    const borrowedAmount = addLiquidity.div(2);
    await expect(
      creditManagerMock.lendCreditAccount(
        borrowedAmount,
        creditManagerMock.address
      )
    )
      .to.emit(poolService, "Borrow")
      .withArgs(
        creditManagerMock.address,
        creditManagerMock.address,
        borrowedAmount
      );
  });

  it("[PS-16]: lendCreditAccount correctly updates parameters", async () => {
    const creditManagerMock =
      await ts.testDeployer.getCreditManagerMockForPoolTest(
        poolService.address
      );

    await poolService
      .connect(liquidityProvider)
      .addLiquidity(addLiquidity, friend.address, referral);

    await poolService.connectCreditManager(creditManagerMock.address);
    const borrowedAmount = addLiquidity.div(2);
    const totalBorrowed = await poolService.totalBorrowed();
    await creditManagerMock.lendCreditAccount(
      borrowedAmount,
      creditManagerMock.address
    );
    expect(await poolService.totalBorrowed()).to.be.eq(
      totalBorrowed.add(borrowedAmount)
    );
  });

  it("[PS-17]: lendCreditAccount correctly updates borrow rate", async () => {
    const creditManagerMock =
      await ts.testDeployer.getCreditManagerMockForPoolTest(
        poolService.address
      );

    await poolService
      .connect(liquidityProvider)
      .addLiquidity(addLiquidity, friend.address, referral);

    await poolService.connectCreditManager(creditManagerMock.address);
    const borrowedAmount = addLiquidity.div(2);
    const totalBorrowed = await poolService.totalBorrowed();
    await creditManagerMock.lendCreditAccount(
      borrowedAmount,
      creditManagerMock.address
    );

    expect(await poolService.totalBorrowed()).to.be.eq(
      totalBorrowed.add(borrowedAmount)
    );

    const expectedLU = addLiquidity;
    const available = addLiquidity.sub(borrowedAmount);

    const borrowRateModel =
      ts.poolDeployer.linearInterestRateModelJS.calcBorrowRate_RAY(
        expectedLU,
        available
      );

    expect(await poolService.borrowAPY_RAY()).to.be.eq(borrowRateModel);
  });

  it("[PS-18]: repay correctly emits Repay event", async () => {
    const creditManagerMock =
      await ts.testDeployer.getCreditManagerMockForPoolTest(
        poolService.address
      );

    await poolService
      .connect(liquidityProvider)
      .addLiquidity(addLiquidity, friend.address, referral);

    await poolService.connectCreditManager(creditManagerMock.address);

    const borrowedAmount = addLiquidity.div(2);

    for (const params of [
      { profit: 1200, loss: 1000 },
      { profit: 0, loss: 1200 },
    ]) {
      const { profit, loss } = params;

      await creditManagerMock.lendCreditAccount(
        borrowedAmount,
        creditManagerMock.address
      );
      await expect(
        creditManagerMock.repayCreditAccount(borrowedAmount, profit, loss)
      )
        .to.emit(poolService, "Repay")
        .withArgs(creditManagerMock.address, borrowedAmount, profit, loss);
    }
  });

  it("[PS-19]: repay correctly update pool params if loss accrued: case treasury < loss", async () => {
    const creditManagerMock =
      await ts.testDeployer.getCreditManagerMockForPoolTest(
        poolService.address
      );

    const treasuryAddress = await ts.coreDeployer.getTreasuryAddress();

    await poolService
      .connect(liquidityProvider)
      .addLiquidity(addLiquidity, friend.address, referral);

    expect(await dieselToken.balanceOf(treasuryAddress)).to.be.eq(0);

    await poolService.connectCreditManager(creditManagerMock.address);

    const borrowedAmount = addLiquidity.div(2);

    const profit = 0;
    const loss = 1e6;

    // Transfer a little part to treasury to cover
    const treasuryBalance = 1e4;

    await dieselToken
      .connect(friend)
      .transfer(treasuryAddress, treasuryBalance);

    const receipt = await creditManagerMock.lendCreditAccount(
      borrowedAmount,
      friend.address
    );

    const initialTimestamp = await ts.getTimestamp(receipt.blockNumber);

    const totalBorrowed = await poolService.totalBorrowed();

    await underlyingToken
      .connect(friend)
      .transfer(poolService.address, borrowedAmount);

    await ts.oneYearAhead();

    const borrowRate = await poolService.borrowAPY_RAY();

    const receipt2 = await creditManagerMock.repayCreditAccount(
      borrowedAmount,
      profit,
      loss
    );

    const timestampRepay = await ts.getTimestamp(receipt2.blockNumber);

    const timeDifference = timestampRepay - initialTimestamp;

    const interestAccrued = totalBorrowed
      .mul(borrowRate)
      .div(RAY)
      .mul(timeDifference)
      .div(SECONDS_PER_YEAR);

    const dieselRate_RAY = RAY.mul(addLiquidity.add(interestAccrued)).div(
      addLiquidity
    );

    const dieselInsurance = rayMul(
      BigNumber.from(treasuryBalance),
      dieselRate_RAY
    );

    const expectedLiquidityModel = interestAccrued.add(addLiquidity).sub(loss);

    expect(await poolService.totalBorrowed()).to.be.eq(
      totalBorrowed.sub(borrowedAmount)
    );
    expect(await dieselToken.balanceOf(treasuryAddress)).to.be.eq(0);

    expect(await poolService.expectedLiquidity()).to.be.eq(
      expectedLiquidityModel
    );

    expect(await poolService.availableLiquidity()).to.be.eq(addLiquidity);

    const borrowRateModel =
      ts.poolDeployer.linearInterestRateModelJS.calcBorrowRate_RAY(
        expectedLiquidityModel,
        addLiquidity
      );
    expect(await poolService.borrowAPY_RAY()).to.be.eq(borrowRateModel);
  });

  it("[PS-20]: repay correctly update  pool params if loss accrued: case treasury > loss", async () => {
    const creditManagerMock =
      await ts.testDeployer.getCreditManagerMockForPoolTest(
        poolService.address
      );

    const treasuryAddress = await ts.coreDeployer.getTreasuryAddress();

    await poolService
      .connect(liquidityProvider)
      .addLiquidity(addLiquidity, treasuryAddress, referral);

    expect(await dieselToken.balanceOf(treasuryAddress)).to.be.eq(addLiquidity);

    await poolService.connectCreditManager(creditManagerMock.address);

    const borrowedAmount = addLiquidity.div(2);

    const profit = 0;
    const loss = addLiquidity.div(2);

    const receipt1 = await creditManagerMock.lendCreditAccount(
      borrowedAmount,
      creditManagerMock.address
    );

    const initialTimestamp = await ts.getTimestamp(receipt1.blockNumber);

    const totalBorrowed = await poolService.totalBorrowed();
    const borrowRate = await poolService.borrowAPY_RAY();

    await ts.oneYearAhead();

    const receipt2 = await creditManagerMock.repayCreditAccount(
      borrowedAmount,
      profit,
      loss
    );
    expect(await poolService.totalBorrowed()).to.be.eq(
      totalBorrowed.sub(borrowedAmount)
    );
    const timestampRepay = await ts.getTimestamp(receipt2.blockNumber);

    const timeDifference = timestampRepay - initialTimestamp;

    const interestAccrued = rayMul(
      borrowedAmount,
      borrowRate.mul(timeDifference).div(SECONDS_PER_YEAR)
    );

    const expectedLiquidityBefore = addLiquidity.add(interestAccrued);

    const dieselRate_RAY = RAY.mul(expectedLiquidityBefore).div(addLiquidity);

    const dieselBurned = rayDiv(BigNumber.from(loss), dieselRate_RAY);

    expect(await poolService.totalBorrowed()).to.be.eq(
      totalBorrowed.sub(borrowedAmount)
    );

    expect(await dieselToken.balanceOf(treasuryAddress)).to.be.eq(
      addLiquidity.sub(dieselBurned)
    );

    const expectedLiquidityAfter = expectedLiquidityBefore.sub(loss);

    const borrowRateModel =
      ts.poolDeployer.linearInterestRateModelJS.calcBorrowRate_RAY(
        expectedLiquidityAfter,
        addLiquidity.sub(borrowedAmount)
      );

    expect(await poolService.borrowAPY_RAY()).to.be.eq(borrowRateModel);
  });

  it("[PS-21]: repay correctly update  pool params if profit accrued", async () => {
    const creditManagerMock =
      await ts.testDeployer.getCreditManagerMockForPoolTest(
        poolService.address
      );

    const treasuryAddress = await ts.coreDeployer.getTreasuryAddress();

    await poolService
      .connect(liquidityProvider)
      .addLiquidity(addLiquidity, liquidityProvider.address, referral);

    await poolService.connectCreditManager(creditManagerMock.address);

    const borrowedAmount = addLiquidity.div(2);

    const profit = borrowedAmount.div(100);
    const loss = 0;

    const receipt1 = await creditManagerMock.lendCreditAccount(
      borrowedAmount,
      creditManagerMock.address
    );

    const initialTimestamp = await ts.getTimestamp(receipt1.blockNumber);

    const totalBorrowed = await poolService.totalBorrowed();
    const borrowRate = await poolService.borrowAPY_RAY();

    const receipt2 = await creditManagerMock.repayCreditAccount(
      borrowedAmount,
      profit,
      loss
    );
    expect(await poolService.totalBorrowed()).to.be.eq(
      totalBorrowed.sub(borrowedAmount)
    );
    const timestampRepay = await ts.getTimestamp(receipt2.blockNumber);

    const timeDifference = timestampRepay - initialTimestamp;

    const interestAccrued = rayMul(
      totalBorrowed,
      borrowRate.mul(timeDifference).div(SECONDS_PER_YEAR)
    );

    const expectedLiquidityModel = addLiquidity
      .add(interestAccrued)
      .add(profit);

    expect(await poolService.totalBorrowed()).to.be.eq(0);

    expect(await poolService.expectedLiquidity()).to.be.eq(
      expectedLiquidityModel
    );

    const dieselRate_RAY = RAY.mul(addLiquidity.add(interestAccrued)).div(
      addLiquidity
    );

    const dieselMinted = rayDiv(BigNumber.from(profit), dieselRate_RAY);

    expect(await dieselToken.balanceOf(treasuryAddress)).to.be.eq(dieselMinted);

    const borrowRateModel =
      ts.poolDeployer.linearInterestRateModelJS.calcBorrowRate_RAY(
        expectedLiquidityModel,
        addLiquidity.sub(borrowedAmount)
      );
    expect(await poolService.borrowAPY_RAY()).to.be.eq(borrowRateModel);
  });

  it("[PS-22]: repay with profit doesnt change diesel rate", async () => {
    const creditManagerMock =
      await ts.testDeployer.getCreditManagerMockForPoolTest(
        poolService.address
      );

    const treasuryAddress = await ts.coreDeployer.getTreasuryAddress();

    await poolService
      .connect(liquidityProvider)
      .addLiquidity(addLiquidity, treasuryAddress, referral);

    await poolService.connectCreditManager(creditManagerMock.address);

    const borrowedAmount = addLiquidity.div(2);

    const profit = borrowedAmount.div(10);
    const loss = 0;

    const receipt1 = await creditManagerMock.lendCreditAccount(
      borrowedAmount,
      creditManagerMock.address
    );

    const initialTimestamp = await ts.getTimestamp(receipt1.blockNumber);
    const borrowRate = await poolService.borrowAPY_RAY();

    await ts.oneYearAhead();

    const receipt2 = await creditManagerMock.repayCreditAccount(
      borrowedAmount,
      profit,
      loss
    );

    const timestampRepay = await ts.getTimestamp(receipt2.blockNumber);

    const timeDifference = timestampRepay - initialTimestamp;

    const interestAccrued = rayMul(
      borrowedAmount,
      borrowRate.mul(timeDifference).div(SECONDS_PER_YEAR)
    );

    const expectedLiquidityModel = addLiquidity.add(interestAccrued);

    const dieselRateBefore = RAY.mul(expectedLiquidityModel).div(addLiquidity);

    const dieselRateAfter = await poolService.getDieselRate_RAY();

    // Should be equal with 10^-19 %
    expect(dieselRateBefore.div(1e6)).to.be.eq(dieselRateAfter.div(1e6));
  });

  it("[PS-22]: repay with treasury > loss doesnt change diesel rate", async () => {
    const creditManagerMock =
      await ts.testDeployer.getCreditManagerMockForPoolTest(
        poolService.address
      );

    const treasuryAddress = await ts.coreDeployer.getTreasuryAddress();

    await poolService
      .connect(liquidityProvider)
      .addLiquidity(addLiquidity, treasuryAddress, referral);

    await poolService.connectCreditManager(creditManagerMock.address);

    const borrowedAmount = addLiquidity.div(2);

    const profit = 0;
    const loss = borrowedAmount;

    const receipt1 = await creditManagerMock.lendCreditAccount(
      borrowedAmount,
      creditManagerMock.address
    );

    const initialTimestamp = await ts.getTimestamp(receipt1.blockNumber);
    const borrowRate = await poolService.borrowAPY_RAY();

    await ts.oneYearAhead();

    const receipt2 = await creditManagerMock.repayCreditAccount(
      borrowedAmount,
      profit,
      loss
    );

    const timestampRepay = await ts.getTimestamp(receipt2.blockNumber);

    const timeDifference = timestampRepay - initialTimestamp;

    const interestAccrued = rayMul(
      borrowedAmount,
      borrowRate.mul(timeDifference).div(SECONDS_PER_YEAR)
    );

    const expectedLiquidityModel = addLiquidity.add(interestAccrued);

    const dieselRateBefore = RAY.mul(expectedLiquidityModel).div(addLiquidity);

    const dieselRateAfter = await poolService.getDieselRate_RAY();

    // Should be equal with 10^-19 %
    expect(dieselRateBefore.div(1e8)).to.be.eq(dieselRateAfter.div(1e8));
  });

  it("[PS-23]: repay with treasury < loss emit UncoveredEvent", async () => {
    const creditManagerMock =
      await ts.testDeployer.getCreditManagerMockForPoolTest(
        poolService.address
      );

    await poolService
      .connect(liquidityProvider)
      .addLiquidity(addLiquidity, friend.address, referral);

    await poolService.connectCreditManager(creditManagerMock.address);

    const borrowedAmount = addLiquidity.div(2);

    const profit = 0;
    const loss = borrowedAmount;

    await creditManagerMock.lendCreditAccount(
      borrowedAmount,
      creditManagerMock.address
    );

    await ts.oneYearAhead();

    await expect(
      creditManagerMock.repayCreditAccount(borrowedAmount, profit, loss)
    )
      .to.emit(poolService, "UncoveredLoss")
      .withArgs(creditManagerMock.address, loss);
  });

  it("[PS-24]: fromDiesel / toDiesel works correct", async () => {
    const creditManagerMock =
      await ts.testDeployer.getCreditManagerMockForPoolTest(
        poolService.address
      );

    await poolService
      .connect(liquidityProvider)
      .addLiquidity(addLiquidity, friend.address, referral);

    await poolService.connectCreditManager(creditManagerMock.address);
    const borrowedAmount = addLiquidity.div(2);
    await creditManagerMock.lendCreditAccount(
      borrowedAmount,
      creditManagerMock.address
    );
    await ts.oneYearAhead();

    const dieselRate = await poolService.getDieselRate_RAY();

    expect(await poolService.toDiesel(addLiquidity)).to.be.eq(
      rayDiv(addLiquidity, dieselRate)
    );
    expect(await poolService.fromDiesel(addLiquidity)).to.be.eq(
      rayMul(addLiquidity, dieselRate)
    );
  });

  it("[PS-25]: newInterestRateModel changes interest rate model & emit event", async () => {
    const IRMDeployer = new LinearInterestRateModelDeployer({
      Rbase: 10,
      Rslope1: 20,
      Rslope2: 30,
      Uoptimal: 40,
    });

    const iModel = await IRMDeployer.getLinearInterestRateModel();

    await expect(poolService.updateInterestRateModel(iModel.address))
      .to.emit(poolService, "NewInterestRateModel")
      .withArgs(iModel.address);

    expect(await poolService.interestRateModel()).to.be.eq(iModel.address);
  });

  it("[PS-26]: newInterestRateModel updates borrow rate correctly", async () => {
    const IRMDeployer = new LinearInterestRateModelDeployer({
      Rbase: 10,
      Rslope1: 20,
      Rslope2: 30,
      Uoptimal: 40,
    });

    const iModel = await IRMDeployer.getLinearInterestRateModel();

    const receipt = await poolService.updateInterestRateModel(iModel.address);

    const expectedLiqReal = await poolService.expectedLiquidity({
      blockTag: receipt.blockNumber,
    });
    const availableLiqReal = await poolService.availableLiquidity({
      blockTag: receipt.blockNumber,
    });

    expect(await poolService.borrowAPY_RAY()).to.be.eq(
      IRMDeployer.model.calcBorrowRate_RAY(expectedLiqReal, availableLiqReal)
    );
  });

  it("[PS-27]: borrowRate updates parameters correctly", async () => {
    const creditManagerMock =
      await ts.testDeployer.getCreditManagerMockForPoolTest(
        poolService.address
      );

    await poolService
      .connect(liquidityProvider)
      .addLiquidity(addLiquidity, friend.address, referral);

    await poolService.connectCreditManager(creditManagerMock.address);

    const borrowedAmount = addLiquidity.div(2);
    await creditManagerMock.lendCreditAccount(
      borrowedAmount,
      creditManagerMock.address
    );

    await ts.oneYearAhead();

    const receipt = await poolService.updateBorrowRate();

    const expectedLiqReal = await poolService.expectedLiquidity({
      blockTag: receipt.blockNumber,
    });
    const availableLiqReal = await poolService.availableLiquidity({
      blockTag: receipt.blockNumber,
    });

    const iModelRate =
      ts.poolDeployer.linearInterestRateModelJS.calcBorrowRate_RAY(
        expectedLiqReal,
        availableLiqReal
      );

    const timestamp = await ts.getTimestamp(receipt.blockNumber);
    const ci = await poolService.calcLinearCumulative_RAY({
      blockTag: receipt.blockNumber,
    });

    expect(await poolService.getExpectedLU()).to.be.eq(expectedLiqReal);
    expect(await poolService.getTimestampLU()).to.be.eq(timestamp);
    expect(await poolService.getCumulativeIndex_RAY()).to.be.eq(ci);
    expect(await poolService.borrowAPY_RAY()).to.be.eq(iModelRate);
  });

  it("[PS-28]: calcLinearCumulative_RAY computes correctly", async () => {
    const timestampLU = await poolService.getTimestampLU();
    await ts.oneYearAhead();

    const blockNum = await ethers.provider.getBlockNumber();
    const timestampNow = await ts.getTimestamp(blockNum);
    const LC_RAY = await poolService.calcLinearCumulative_RAY();
    const borrowRate = await poolService.borrowAPY_RAY();

    const timeDifference = timestampNow - timestampLU.toNumber();
    const linearAPY = RAY.add(
      borrowRate.mul(timeDifference).div(SECONDS_PER_YEAR)
    );
    const LC_Model = rayMul(RAY, linearAPY);

    expect(LC_RAY).to.be.eq(LC_Model);
  });

  it("[PS-29]: expectedLiquidity() computes correctly", async () => {
    const creditManagerMock =
      await ts.testDeployer.getCreditManagerMockForPoolTest(
        poolService.address
      );

    await poolService
      .connect(liquidityProvider)
      .addLiquidity(addLiquidity, friend.address, referral);

    await poolService.connectCreditManager(creditManagerMock.address);

    const borrowedAmount = addLiquidity.div(2);

    // LEND MONEY
    const receipt = await creditManagerMock.lendCreditAccount(
      borrowedAmount,
      creditManagerMock.address
    );
    const timestampLend = await ts.getTimestamp(receipt.blockNumber);

    await ts.oneYearAhead();

    const _expectLU = await poolService.getExpectedLU();
    const blockNum = await ethers.provider.getBlockNumber();
    const timestampNow = await ts.getTimestamp(blockNum);
    const borrowRate = await poolService.borrowAPY_RAY();

    const timeDifference = timestampNow - timestampLend;

    const totalBorrowedinterestAccrued = borrowedAmount
      .mul(borrowRate)
      .div(RAY)
      .mul(timeDifference)
      .div(SECONDS_PER_YEAR);
    expect(await poolService.expectedLiquidity()).to.be.eq(
      _expectLU.add(totalBorrowedinterestAccrued)
    );
  });

  it("[PS-30]: setExpectedLiquidityLimit() set limit & emits event", async () => {
    const newLimit = 98834;
    await expect(poolService.setExpectedLiquidityLimit(newLimit))
      .to.emit(poolService, "NewExpectedLiquidityLimit")
      .withArgs(newLimit);

    expect(await poolService.expectedLiquidityLimit()).to.be.eq(newLimit);
  });

  it("[PS-31]: addLiquidity reverts if expectLiquidity > limit", async () => {
    const revertedMsg = await errors.POOL_MORE_THAN_EXPECTED_LIQUIDITY_LIMIT();

    await poolService.setExpectedLiquidityLimit(addLiquidity);
    await poolService
      .connect(liquidityProvider)
      .addLiquidity(addLiquidity, friend.address, referral);

    await expect(
      poolService.addLiquidity(1, friend.address, referral)
    ).to.revertedWith(revertedMsg);
  });

  it("[PS-32]: setWithdrawFee reverts in fee > 1%", async () => {
    const revertMsg = await errors.POOL_INCORRECT_WITHDRAW_FEE();
    await expect(poolService.setWithdrawFee(101)).to.be.revertedWith(revertMsg);
  });

  it("[PS-33]: setWithdrawFee sets fees correct", async () => {
    const fee = 10;
    await expect(poolService.setWithdrawFee(fee))
      .to.emit(poolService, "NewWithdrawFee")
      .withArgs(fee);
    expect(await poolService.withdrawFee()).to.be.eq(fee);
  });

  it("[PS-34]: remove liquidity correctly takes withdraw fee", async () => {
    await poolService
      .connect(liquidityProvider)
      .addLiquidity(addLiquidity, friend.address, referral);

    const fee = 50;
    await poolService.setWithdrawFee(fee);
    const treasuryMock = await ts.coreDeployer.getTreasuryMock();

    const lpBalanceBefore = await underlyingToken.balanceOf(
      liquidityProvider.address
    );
    const treasureBalanceBefore = await underlyingToken.balanceOf(
      treasuryMock.address
    );

    // It emits RemoveLiquidity event
    await poolService
      .connect(friend)
      .removeLiquidity(removeLiquidity, liquidityProvider.address);

    const lpBalanceExpected = lpBalanceBefore.add(
      percentMul(removeLiquidity, PERCENTAGE_FACTOR - fee)
    );
    const treasureBalanceExpected = treasureBalanceBefore.add(
      percentMul(removeLiquidity, fee)
    );

    expect(
      await underlyingToken.balanceOf(liquidityProvider.address),
      "Incorrect LP balance after operation"
    ).to.be.eq(lpBalanceExpected);
    expect(
      await underlyingToken.balanceOf(treasuryMock.address),
      "Incorrect treasury balance after operation"
    ).to.be.eq(treasureBalanceExpected);
  });

  it("[PS-35]: connectCreditManager reverts if creditManager is already connected", async () => {
    const revertMsg = await errors.POOL_CANT_ADD_CREDIT_MANAGER_TWICE();
    const vts = new CreditManagerTestSuite();
    await vts.getSuite({ poolService });

    expect(await poolService.creditManagersCount()).to.be.eq(0);

    await vts.setupCreditManager();
    await expect(
      poolService.connectCreditManager(vts.creditManager.address)
    ).to.be.revertedWith(revertMsg);
  });

  it("[PS-35]: updateInterestModel reverts for zero address", async () => {
    const revertMsg = await errors.ZERO_ADDRESS_IS_NOT_ALLOWED();
    await expect(
      poolService.updateInterestRateModel(ADDRESS_0x0)
    ).to.be.revertedWith(revertMsg);
  });
});

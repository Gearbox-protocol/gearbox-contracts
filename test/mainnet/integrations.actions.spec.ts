/*
 * SPDX-License-Identifier: BSL-1.1
 * Gearbox. Generalized leverage protocol, which allows to take leverage and then use it across other DeFi protocols and platforms in a composable way.
 * (c) Gearbox.fi, 2021
 */

// @ts-ignore
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { expect } from "../../utils/expect";

import { ERC20, Errors, IWETH__factory, IYVault__factory } from "../../types/ethers-v5";
import { TestDeployer } from "../../deployer/testDeployer";
import {
  CURVE_3POOL_ADDRESS,
  MainnetSuite,
  UNISWAP_V2_ADDRESS,
  UNISWAP_V3_QUOTER,
  UNISWAP_V3_ROUTER,
  YEARN_DAI_ADDRESS,
  YEARN_USDC_ADDRESS
} from "./helper";
import { MAX_INT, WAD } from "@diesellabs/gearbox-sdk";
import { BigNumber } from "ethers";
import { ADDRESS_0x0, DUMB_ADDRESS, LEVERAGE_DECIMALS } from "../../core/constants";
import { tokenDataByNetwork, WETHToken } from "../../core/token";
import { ERC20__factory } from "@diesellabs/gearbox-sdk/lib/types";
import { LPInterface, SwapInterface } from "../../core/leveragedActions";
import { UniV2helper } from "../../integrations/uniV2helper";
import { UniV3helper } from "../../integrations/uniV3helper";
import { CurveHelper } from "../../integrations/curveHelper";
import { CreditManagerTestSuite } from "../../deployer/creditManagerTestSuite";

describe("Actions test", function () {
  this.timeout(0);

  const daiLiquidity = BigNumber.from(10000).mul(WAD);
  const ethLiquidity = BigNumber.from(50).mul(WAD);
  const accountAmount = BigNumber.from(1000).mul(WAD);
  const accountAmountETH = BigNumber.from(3).mul(WAD);
  const leverageFactor = 4 * LEVERAGE_DECIMALS;
  const referralCode = 888777;

  let ts: MainnetSuite;
  let deployer: SignerWithAddress;
  let user: SignerWithAddress;
  let liquidator: SignerWithAddress;
  let friend: SignerWithAddress;

  let errors: Errors;

  before(async () => {
    ts = await MainnetSuite.getSuite();
    const accounts = (await ethers.getSigners()) as Array<SignerWithAddress>;
    deployer = accounts[0];
    user = accounts[1];
    liquidator = accounts[2];
    friend = accounts[3];

    const testDeployer = new TestDeployer();
    errors = await testDeployer.getErrors();
    const r1 = await ts.daiToken.approve(ts.creditManagerDAI.address, MAX_INT);
    await r1.wait();
    const r2 = await ts.daiToken.approve(ts.poolDAI.address, MAX_INT);
    await r2.wait();
    const r3 = await ts.poolDAI.addLiquidity(daiLiquidity, deployer.address, 3);
    await r3.wait();
    const r4 = await ts.daiToken.approve(ts.leveragedActions.address, MAX_INT);
    await r4.wait();

    const poolAmount = await ts.poolETH.availableLiquidity();

    if (poolAmount.lt(ethLiquidity)) {
      const r5 = await ts.wethGateway.addLiquidityETH(
        ts.poolETH.address,
        deployer.address,
        2,
        { value: ethLiquidity.sub(poolAmount) }
      );
      await r5.wait();
    }
  });

  it("[LA-1]: openLong [UNI_V2] w/o LP works correctly", async () => {
    const poolBalance = await ts.daiToken.balanceOf(ts.poolDAI.address);

    const expectedAmountOnCreditAccount = accountAmount
      .mul(leverageFactor + LEVERAGE_DECIMALS)
      .div(LEVERAGE_DECIMALS);

    const path = [
      tokenDataByNetwork.Mainnet.DAI.address,
      WETHToken.Mainnet,
      tokenDataByNetwork.Mainnet.LINK.address,
    ];

    const uniV2adapter = await UniV2helper.getHelper(
      UNISWAP_V2_ADDRESS,
      deployer
    );

    const calldata = await uniV2adapter.getSwapCalldata(
      "ExactTokensToTokens",
      path,
      expectedAmountOnCreditAccount,
      deployer.address,
      UniV2helper.getDeadline(),
      0
    );

    const expectedLinkAmount = await uniV2adapter.getExpectedAmount(
      "ExactTokensToTokens",
      path,
      expectedAmountOnCreditAccount
    );

    await expect(
      ts.leveragedActions.openLong(
        accountAmount,
        {
          creditManager: ts.creditManagerDAI.address,
          leverageFactor,
          swapInterface: SwapInterface.UniswapV2,
          swapContract: UNISWAP_V2_ADDRESS,
          swapCalldata: calldata,
          lpInterface: LPInterface.NoLP,
          lpContract: ADDRESS_0x0,
        },
        referralCode
      )
    )
      .to.emit(ts.leveragedActions, "Action")
      .withArgs(
        tokenDataByNetwork.Mainnet.DAI.address,
        tokenDataByNetwork.Mainnet.DAI.address,
        tokenDataByNetwork.Mainnet.LINK.address,
        accountAmount,
        ADDRESS_0x0,
        UNISWAP_V2_ADDRESS,
        ADDRESS_0x0,
        referralCode
      );

    expect(
      await ts.daiToken.balanceOf(ts.poolDAI.address),
      "Pool balance"
    ).to.be.eq(
      poolBalance.sub(accountAmount.mul(leverageFactor).div(LEVERAGE_DECIMALS))
    );

    expect(
      await ts.creditManagerDAI.hasOpenedCreditAccount(deployer.address),
      "has credit account"
    ).to.be.true;

    const creditAccount = await ts.creditManagerDAI.getCreditAccountOrRevert(
      deployer.address
    );

    expect(await ts.daiToken.balanceOf(creditAccount), "dai balance").to.be.lte(
      2
    );

    const linkToken = ERC20__factory.connect(
      tokenDataByNetwork.Mainnet.LINK.address,
      deployer
    ) as ERC20;
    expect(await linkToken.balanceOf(creditAccount), "Link balance").to.be.eq(
      expectedLinkAmount
    );

    await ts.creditManagerDAI.repayCreditAccount(deployer.address);
  });

  it("[LA-2]: openLong [UNI_V2] with YEARN LP works correctly", async () => {
    const poolBalance = await ts.wethToken.balanceOf(ts.poolETH.address);

    const expectedAmountOnCreditAccount = accountAmountETH
      .mul(leverageFactor + LEVERAGE_DECIMALS)
      .div(LEVERAGE_DECIMALS);

    const path = [WETHToken.Mainnet, tokenDataByNetwork.Mainnet.USDC.address];

    const uniV2adapter = await UniV2helper.getHelper(
      UNISWAP_V2_ADDRESS,
      deployer
    );

    const calldata = await uniV2adapter.getSwapCalldata(
      "ExactTokensToTokens",
      path,
      expectedAmountOnCreditAccount,
      deployer.address,
      UniV2helper.getDeadline(),
      0
    );

    const expectedUSDCAmount = await uniV2adapter.getExpectedAmount(
      "ExactTokensToTokens",
      path,
      expectedAmountOnCreditAccount
    );

    const yearnAdapter = await ts.creditFilterETH.contractToAdapter(
      YEARN_USDC_ADDRESS
    );

    const yToken = ERC20__factory.connect(
      ts.yearnUSDC.address,
      deployer
    ) as ERC20;

    const adapter = IYVault__factory.connect(yearnAdapter, deployer);

    const usdcToken = ERC20__factory.connect(
      await adapter.token(),
      deployer
    ) as ERC20;
    await usdcToken.approve(ts.yearnUSDC.address, MAX_INT);

    const yUSDCexpected = await ts.yearnUSDC.callStatic["deposit(uint256)"](
      expectedUSDCAmount
    );

    await expect(
      ts.leveragedActions.openLong(
        accountAmountETH,
        {
          creditManager: ts.creditManagerETH.address,
          leverageFactor,
          swapInterface: SwapInterface.UniswapV2,
          swapContract: UNISWAP_V2_ADDRESS,
          swapCalldata: calldata,
          lpInterface: LPInterface.Yearn,
          lpContract: YEARN_USDC_ADDRESS,
        },
        referralCode,
        { value: accountAmountETH }
      )
    )
      .to.emit(ts.leveragedActions, "Action")
      .withArgs(
        WETHToken.Mainnet,
        WETHToken.Mainnet,
        YEARN_USDC_ADDRESS,
        accountAmountETH,
        ADDRESS_0x0,
        UNISWAP_V2_ADDRESS,
        YEARN_USDC_ADDRESS,
        referralCode
      );

    expect(
      await ts.wethToken.balanceOf(ts.poolETH.address),
      "Pool balance"
    ).to.be.eq(
      poolBalance.sub(
        accountAmountETH.mul(leverageFactor).div(LEVERAGE_DECIMALS)
      )
    );

    expect(
      await ts.creditManagerETH.hasOpenedCreditAccount(deployer.address),
      "has credit account"
    ).to.be.true;

    const creditAccount = await ts.creditManagerETH.getCreditAccountOrRevert(
      deployer.address
    );

    expect(
      await ts.wethToken.balanceOf(creditAccount),
      "usdc balance"
    ).to.be.lte(2);

    expect(
      (await yToken.balanceOf(creditAccount)).sub(yUSDCexpected).abs(),
      "yUSDC balance"
    ).to.be.lte(2);

    await ts.wethGateway.repayCreditAccountETH(
      ts.creditManagerETH.address,
      deployer.address,
      { value: expectedAmountOnCreditAccount }
    );
  });

  it("[LA-3]: openLong [UNI_V3] w/o LP works correctly", async () => {
    const poolBalance = await ts.daiToken.balanceOf(ts.poolDAI.address);

    const expectedAmountOnCreditAccount = accountAmount
      .mul(leverageFactor + LEVERAGE_DECIMALS)
      .div(LEVERAGE_DECIMALS);

    const path = [
      tokenDataByNetwork.Mainnet.DAI.address,
      WETHToken.Mainnet,
      tokenDataByNetwork.Mainnet.LINK.address,
    ];

    const uniV3adapter = await UniV3helper.getHelper(
      UNISWAP_V3_ROUTER,
      UNISWAP_V3_QUOTER,
      deployer
    );

    const calldata = await uniV3adapter.getSwapCalldata(
      "ExactTokensToTokens",
      path,
      expectedAmountOnCreditAccount,
      deployer.address,
      UniV2helper.getDeadline(),
      0
    );

    const expectedLinkAmount = await uniV3adapter.getExpectedAmount(
      "ExactTokensToTokens",
      path,
      expectedAmountOnCreditAccount
    );

    await expect(
      ts.leveragedActions.openLong(
        accountAmount,
        {
          creditManager: ts.creditManagerDAI.address,
          leverageFactor,
          swapInterface: SwapInterface.UniswapV3,
          swapContract: UNISWAP_V3_ROUTER,
          swapCalldata: calldata,
          lpInterface: LPInterface.NoLP,
          lpContract: ADDRESS_0x0,
        },
        referralCode
      )
    )
      .to.emit(ts.leveragedActions, "Action")
      .withArgs(
        tokenDataByNetwork.Mainnet.DAI.address,
        tokenDataByNetwork.Mainnet.DAI.address,
        tokenDataByNetwork.Mainnet.LINK.address,
        accountAmount,
        ADDRESS_0x0,
        UNISWAP_V3_ROUTER,
        ADDRESS_0x0,
        referralCode
      );

    expect(
      await ts.daiToken.balanceOf(ts.poolDAI.address),
      "Pool balance"
    ).to.be.eq(
      poolBalance.sub(accountAmount.mul(leverageFactor).div(LEVERAGE_DECIMALS))
    );

    expect(
      await ts.creditManagerDAI.hasOpenedCreditAccount(deployer.address),
      "has credit account"
    ).to.be.true;

    const creditAccount = await ts.creditManagerDAI.getCreditAccountOrRevert(
      deployer.address
    );

    expect(await ts.daiToken.balanceOf(creditAccount), "dai balance").to.be.eq(
      0
    );

    const linkToken = ERC20__factory.connect(
      tokenDataByNetwork.Mainnet.LINK.address,
      deployer
    ) as ERC20;
    expect(
      (await linkToken.balanceOf(creditAccount)).sub(expectedLinkAmount).abs(),
      "Link balance"
    ).to.be.lt(2);

    await ts.creditManagerDAI.repayCreditAccount(deployer.address);
  });

  it("[LA-4]: openLong [CURVE] w/o LP works correctly", async () => {
    const poolBalance = await ts.daiToken.balanceOf(ts.poolDAI.address);

    const expectedAmountOnCreditAccount = accountAmount
      .mul(leverageFactor + LEVERAGE_DECIMALS)
      .div(LEVERAGE_DECIMALS);

    const path = [
      tokenDataByNetwork.Mainnet.DAI.address,
      tokenDataByNetwork.Mainnet.USDC.address,
    ];

    const curveAdapter = await CurveHelper.getHelper(
      CURVE_3POOL_ADDRESS,
      deployer
    );

    const calldata = await curveAdapter.getSwapCalldata(
      "ExactTokensToTokens",
      path,
      expectedAmountOnCreditAccount,
      deployer.address,
      UniV2helper.getDeadline(),
      0
    );

    const expectedUSDCAmount = await curveAdapter.getExpectedAmount(
      "ExactTokensToTokens",
      path,
      expectedAmountOnCreditAccount
    );

    await expect(
      ts.leveragedActions.openLong(
        accountAmount,
        {
          creditManager: ts.creditManagerDAI.address,
          leverageFactor,
          swapInterface: SwapInterface.Curve,
          swapContract: CURVE_3POOL_ADDRESS,
          swapCalldata: calldata,
          lpInterface: LPInterface.NoLP,
          lpContract: ADDRESS_0x0,
        },
        referralCode
      )
    )
      .to.emit(ts.leveragedActions, "Action")
      .withArgs(
        tokenDataByNetwork.Mainnet.DAI.address,
        tokenDataByNetwork.Mainnet.DAI.address,
        tokenDataByNetwork.Mainnet.USDC.address,
        accountAmount,
        ADDRESS_0x0,
        CURVE_3POOL_ADDRESS,
        ADDRESS_0x0,
        referralCode
      );

    expect(
      await ts.daiToken.balanceOf(ts.poolDAI.address),
      "Pool balance"
    ).to.be.eq(
      poolBalance.sub(accountAmount.mul(leverageFactor).div(LEVERAGE_DECIMALS))
    );

    expect(
      await ts.creditManagerDAI.hasOpenedCreditAccount(deployer.address),
      "has credit account"
    ).to.be.true;

    const creditAccount = await ts.creditManagerDAI.getCreditAccountOrRevert(
      deployer.address
    );

    expect(await ts.daiToken.balanceOf(creditAccount), "dai balance").to.be.eq(
      0
    );

    const usdcToken = ERC20__factory.connect(
      tokenDataByNetwork.Mainnet.USDC.address,
      deployer
    ) as ERC20;

    expect(
      (await usdcToken.balanceOf(creditAccount)).sub(expectedUSDCAmount).abs(),
      "USDC balance"
    ).to.be.lte(2);

    await ts.creditManagerDAI.repayCreditAccount(deployer.address);
  });

  it("[LA-5]: shortUniV2 - Long [UNI_V2] w/o LP works correctly", async () => {
    const poolBalance = await ts.wethToken.balanceOf(ts.poolETH.address);

    const uniV2adapter = await UniV2helper.getHelper(
      UNISWAP_V2_ADDRESS,
      deployer
    );

    const shortPath = [
      tokenDataByNetwork.Mainnet.DAI.address,
      WETHToken.Mainnet,
    ];

    const longPath = [
      WETHToken.Mainnet,
      tokenDataByNetwork.Mainnet.DAI.address,
    ];

    const expectedAmountBeforeOpenAcc = await uniV2adapter.getExpectedAmount(
      "ExactTokensToTokens",
      shortPath,
      accountAmount
    );

    const expectedAmountOnCreditAccount = expectedAmountBeforeOpenAcc
      .mul(leverageFactor + LEVERAGE_DECIMALS)
      .div(LEVERAGE_DECIMALS);

    const calldata = await uniV2adapter.getSwapCalldata(
      "ExactTokensToTokens",
      longPath,
      expectedAmountOnCreditAccount,
      deployer.address,
      UniV2helper.getDeadline(),
      0
    );

    const expectedDAIAmount = await uniV2adapter.getExpectedAmount(
      "ExactTokensToTokens",
      longPath,
      expectedAmountOnCreditAccount
    );

    await expect(
      ts.leveragedActions.openShortUniV2(
        UNISWAP_V2_ADDRESS,
        accountAmount,
        expectedAmountBeforeOpenAcc,
        shortPath,
        {
          creditManager: ts.creditManagerETH.address,
          leverageFactor,
          swapInterface: SwapInterface.UniswapV2,
          swapContract: UNISWAP_V2_ADDRESS,
          swapCalldata: calldata,
          lpInterface: LPInterface.NoLP,
          lpContract: ADDRESS_0x0,
        },
        referralCode
      )
    )
      .to.emit(ts.leveragedActions, "Action")
      .withArgs(
        tokenDataByNetwork.Mainnet.DAI.address,
        WETHToken.Mainnet,
        tokenDataByNetwork.Mainnet.DAI.address,
        accountAmount,
        UNISWAP_V2_ADDRESS,
        UNISWAP_V2_ADDRESS,
        ADDRESS_0x0,
        referralCode
      );

    expect(
      await ts.wethToken.balanceOf(ts.poolETH.address),
      "Pool balance"
    ).to.be.eq(
      poolBalance.sub(
        expectedAmountBeforeOpenAcc.mul(leverageFactor).div(LEVERAGE_DECIMALS)
      )
    );

    expect(
      await ts.creditManagerETH.hasOpenedCreditAccount(deployer.address),
      "has credit account"
    ).to.be.true;

    const creditAccount = await ts.creditManagerETH.getCreditAccountOrRevert(
      deployer.address
    );

    expect(
      await ts.wethToken.balanceOf(creditAccount),
      "weth balance"
    ).to.be.eq(0);

    const daiToken = ERC20__factory.connect(
      tokenDataByNetwork.Mainnet.DAI.address,
      deployer
    ) as ERC20;

    const daiBalance = await daiToken.balanceOf(creditAccount);
    expect(daiBalance, "DAI balance").to.be.gt(expectedDAIAmount);

    await ts.wethGateway.repayCreditAccountETH(
      ts.creditManagerETH.address,
      deployer.address,
      { value: expectedAmountOnCreditAccount }
    );
  });

  it("[LA-6]: shortUniV3 - Long [UNI_V2] w/o LP works correctly", async () => {
    const poolBalance = await ts.wethToken.balanceOf(ts.poolETH.address);

    const uniV3adapter = await UniV3helper.getHelper(
      UNISWAP_V3_ROUTER,
      UNISWAP_V3_QUOTER,
      deployer
    );

    const shortPath = [
      tokenDataByNetwork.Mainnet.DAI.address,
      WETHToken.Mainnet,
    ];

    const longPath = [
      WETHToken.Mainnet,
      tokenDataByNetwork.Mainnet.DAI.address,
    ];

    const expectedAmountBeforeOpenAcc = await uniV3adapter.getExpectedAmount(
      "ExactTokensToTokens",
      shortPath,
      accountAmount
    );

    const expectedAmountOnCreditAccount = expectedAmountBeforeOpenAcc
      .mul(leverageFactor + LEVERAGE_DECIMALS)
      .div(LEVERAGE_DECIMALS);

    const uniV2adapter = await UniV2helper.getHelper(
      UNISWAP_V2_ADDRESS,
      deployer
    );

    const calldata = await uniV2adapter.getSwapCalldata(
      "ExactTokensToTokens",
      longPath,
      expectedAmountOnCreditAccount,
      deployer.address,
      UniV2helper.getDeadline(),
      0
    );

    const expectedDAIAmount = await uniV2adapter.getExpectedAmount(
      "ExactTokensToTokens",
      longPath,
      expectedAmountOnCreditAccount
    );

    await expect(
      ts.leveragedActions.openShortUniV3(
        UNISWAP_V3_ROUTER,
        {
          path: UniV3helper.pathToUniV3Path(shortPath),
          recipient: deployer.address,
          deadline: UniV3helper.getDeadline(),
          amountIn: accountAmount,
          amountOutMinimum: expectedAmountBeforeOpenAcc,
        },
        {
          creditManager: ts.creditManagerETH.address,
          leverageFactor,
          swapInterface: SwapInterface.UniswapV2,
          swapContract: UNISWAP_V2_ADDRESS,
          swapCalldata: calldata,
          lpInterface: LPInterface.NoLP,
          lpContract: ADDRESS_0x0,
        },
        referralCode
      )
    )
      .to.emit(ts.leveragedActions, "Action")
      .withArgs(
        tokenDataByNetwork.Mainnet.DAI.address,
        WETHToken.Mainnet,
        tokenDataByNetwork.Mainnet.DAI.address,
        accountAmount,
        UNISWAP_V3_ROUTER,
        UNISWAP_V2_ADDRESS,
        ADDRESS_0x0,
        referralCode
      );

    expect(
      await ts.wethToken.balanceOf(ts.poolETH.address),
      "Pool balance"
    ).to.be.eq(
      poolBalance.sub(
        expectedAmountBeforeOpenAcc.mul(leverageFactor).div(LEVERAGE_DECIMALS)
      )
    );

    expect(
      await ts.creditManagerETH.hasOpenedCreditAccount(deployer.address),
      "has credit account"
    ).to.be.true;

    const creditAccount = await ts.creditManagerETH.getCreditAccountOrRevert(
      deployer.address
    );

    expect(
      await ts.wethToken.balanceOf(creditAccount),
      "weth balance"
    ).to.be.eq(0);

    const daiToken = ERC20__factory.connect(
      tokenDataByNetwork.Mainnet.DAI.address,
      deployer
    ) as ERC20;

    const daiBalance = await daiToken.balanceOf(creditAccount);
    expect(daiBalance, "DAI balance").to.be.gte(expectedDAIAmount);

    await ts.wethGateway.repayCreditAccountETH(
      ts.creditManagerETH.address,
      deployer.address,
      { value: expectedAmountOnCreditAccount }
    );
  });

  it("[LA-7]: Curve - Long [UNI_V3] w/o LP works correctly", async () => {
    const usdcToken = ERC20__factory.connect(
      tokenDataByNetwork.Mainnet.USDC.address,
      deployer
    ) as ERC20;

    const r = await usdcToken.approve(ts.leveragedActions.address, MAX_INT);
    await r.wait();

    const accountAmountUSDC = accountAmount.mul(1000000).div(WAD);

    const poolBalance = await ts.daiToken.balanceOf(ts.poolDAI.address);

    const curveAdapter = await CurveHelper.getHelper(
      CURVE_3POOL_ADDRESS,
      deployer
    );

    const shortPath = [
      tokenDataByNetwork.Mainnet.USDC.address,
      tokenDataByNetwork.Mainnet.DAI.address,
    ];

    const longPath = [
      tokenDataByNetwork.Mainnet.DAI.address,
      WETHToken.Mainnet,
      tokenDataByNetwork.Mainnet.USDC.address,
    ];

    const expectedAmountBeforeOpenAcc = await curveAdapter.getExpectedAmount(
      "ExactTokensToTokens",
      shortPath,
      accountAmountUSDC
    );

    const expectedAmountOnCreditAccount = expectedAmountBeforeOpenAcc
      .mul(leverageFactor + LEVERAGE_DECIMALS)
      .div(LEVERAGE_DECIMALS);

    const uniV3adapter = await UniV3helper.getHelper(
      UNISWAP_V3_ROUTER,
      UNISWAP_V3_QUOTER,
      deployer
    );

    const calldata = await uniV3adapter.getSwapCalldata(
      "ExactTokensToTokens",
      longPath,
      expectedAmountOnCreditAccount,
      deployer.address,
      UniV3helper.getDeadline(),
      0
    );

    const expectedUSDCAmount = await uniV3adapter.getExpectedAmount(
      "ExactTokensToTokens",
      longPath,
      expectedAmountOnCreditAccount
    );

    await expect(
      ts.leveragedActions.openShortCurve(
        CURVE_3POOL_ADDRESS,
        curveAdapter.getIndex(shortPath[0]),
        curveAdapter.getIndex(shortPath[1]),
        accountAmountUSDC,
        expectedAmountBeforeOpenAcc.sub(1),

        {
          creditManager: ts.creditManagerDAI.address,
          leverageFactor,
          swapInterface: SwapInterface.UniswapV3,
          swapContract: UNISWAP_V3_ROUTER,
          swapCalldata: calldata,
          lpInterface: LPInterface.NoLP,
          lpContract: ADDRESS_0x0,
        },
        referralCode
      )
    )
      .to.emit(ts.leveragedActions, "Action")
      .withArgs(
        tokenDataByNetwork.Mainnet.USDC.address,
        tokenDataByNetwork.Mainnet.DAI.address,
        tokenDataByNetwork.Mainnet.USDC.address,
        accountAmountUSDC,
        CURVE_3POOL_ADDRESS,
        UNISWAP_V3_ROUTER,
        ADDRESS_0x0,
        referralCode
      );

    expect(
      await ts.daiToken.balanceOf(ts.poolDAI.address),
      "Pool balance"
    ).to.be.eq(
      poolBalance.sub(
        expectedAmountBeforeOpenAcc.mul(leverageFactor).div(LEVERAGE_DECIMALS)
      )
    );

    expect(
      await ts.creditManagerDAI.hasOpenedCreditAccount(deployer.address),
      "has credit account"
    ).to.be.true;

    const creditAccount = await ts.creditManagerDAI.getCreditAccountOrRevert(
      deployer.address
    );

    expect(await ts.daiToken.balanceOf(creditAccount), "dai balance").to.be.lte(
      1
    );

    const usdcBalance = await usdcToken.balanceOf(creditAccount);
    expect(usdcBalance.sub(expectedUSDCAmount).abs(), "USDC balance").to.be.lte(
      2
    );

    await ts.creditManagerDAI.repayCreditAccount(deployer.address);
  });

  it("[LA-8]: openLP works correctly", async () => {
    const daiBalance = accountAmount
      .mul(leverageFactor + LEVERAGE_DECIMALS)
      .div(LEVERAGE_DECIMALS);

    await ts.daiToken.approve(ts.yearnDAI.address, MAX_INT);

    await expect(
      ts.leveragedActions.openLP(
        ts.creditManagerDAI.address,
        leverageFactor,
        accountAmount,
        LPInterface.Yearn,
        YEARN_DAI_ADDRESS,
        referralCode
      )
    )
      .to.emit(ts.leveragedActions, "Action")
      .withArgs(
        tokenDataByNetwork.Mainnet.DAI.address,
        tokenDataByNetwork.Mainnet.DAI.address,
        YEARN_DAI_ADDRESS,
        accountAmount,
        ADDRESS_0x0,
        ADDRESS_0x0,
        YEARN_DAI_ADDRESS,
        referralCode
      );

    // @notice it depends on block (timestamp) so yDAI expected should be calculated immediately after call
    const yDAIexpected = await ts.yearnDAI.callStatic["deposit(uint256)"](
      daiBalance
    );

    const creditAccount = await ts.creditManagerDAI.getCreditAccountOrRevert(
      deployer.address
    );
    const yDAIbalance = await ts.yearnDAI.balanceOf(creditAccount);

    expect(yDAIbalance.sub(yDAIexpected).abs(), "yDAI balance").to.be.lte(2);

    expect(await ts.daiToken.balanceOf(creditAccount), "DAI balance").to.be.eq(
      0
    );
    await ts.creditManagerDAI.repayCreditAccount(friend.address);
  });

  it("[LA-9]: _openLong reverts for unknown creditManager", async () => {
    const revertMsg = await errors.CF_CONTRACT_IS_NOT_IN_ALLOWED_LIST();

    const ts2 = new CreditManagerTestSuite();
    await ts2.getSuite();
    await ts2.getSuite();
    await ts2.setupCreditManager();

    await expect(
      ts.leveragedActions.openShortCurve(
        CURVE_3POOL_ADDRESS,
        0,
        1,
        accountAmount,
        accountAmount,

        {
          creditManager: ts2.creditManager.address,
          leverageFactor,
          swapInterface: SwapInterface.UniswapV3,
          swapContract: UNISWAP_V3_ROUTER,
          swapCalldata: ADDRESS_0x0,
          lpInterface: LPInterface.NoLP,
          lpContract: ADDRESS_0x0,
        },
        referralCode
      )
    ).to.be.revertedWith(revertMsg);
  });

  it("[LA-10]: _openLong reverts for unknown contracts", async () => {
    const revertMsg = await errors.CF_CONTRACT_IS_NOT_IN_ALLOWED_LIST();
    const usdcToken = ERC20__factory.connect(
      tokenDataByNetwork.Mainnet.USDC.address,
      deployer
    ) as ERC20;

    const r = await usdcToken.approve(ts.leveragedActions.address, MAX_INT);
    await r.wait();

    const accountAmountUSDC = accountAmount.mul(1000000).div(WAD);

    const curveAdapter = await CurveHelper.getHelper(
      CURVE_3POOL_ADDRESS,
      deployer
    );

    const shortPath = [
      tokenDataByNetwork.Mainnet.USDC.address,
      tokenDataByNetwork.Mainnet.DAI.address,
    ];

    const expectedAmountBeforeOpenAcc = await curveAdapter.getExpectedAmount(
      "ExactTokensToTokens",
      shortPath,
      accountAmountUSDC
    );

    await expect(
      ts.leveragedActions.openShortCurve(
        CURVE_3POOL_ADDRESS,
        curveAdapter.getIndex(shortPath[0]),
        curveAdapter.getIndex(shortPath[1]),
        accountAmountUSDC,
        expectedAmountBeforeOpenAcc.sub(1),

        {
          creditManager: ts.creditManagerDAI.address,
          leverageFactor,
          swapInterface: SwapInterface.UniswapV3,
          swapContract: DUMB_ADDRESS,
          swapCalldata: ADDRESS_0x0,
          lpInterface: LPInterface.NoLP,
          lpContract: ADDRESS_0x0,
        },
        referralCode
      )
    ).to.be.revertedWith(revertMsg);
  });

  it("[LA-11]: action reverts if provided msg.value for non-wethtoken", async () => {
    const revertMsg = await errors.LA_INCORRECT_MSG();
    await expect(
      ts.leveragedActions.openLP(
        ts.creditManagerDAI.address,
        leverageFactor,
        accountAmount,
        LPInterface.Yearn,
        YEARN_DAI_ADDRESS,
        referralCode,
        { value: WAD }
      )
    ).to.be.revertedWith(revertMsg);
  });

  it("[LA-12]: action reverts if provided msg.value for non-wethtoken", async () => {
    const revertMsg = await errors.LA_INCORRECT_VALUE();
    await expect(
      ts.leveragedActions.openLP(
        ts.creditManagerETH.address,
        leverageFactor,
        accountAmount,
        LPInterface.Yearn,
        YEARN_DAI_ADDRESS,
        referralCode,
        { value: WAD }
      )
    ).to.be.revertedWith(revertMsg);
  });

  it("[LA-13]: _openShort returns unused tokens", async () => {
    const surplus = WAD.mul(50000);

    const uniV3adapter = await UniV3helper.getHelper(
      UNISWAP_V3_ROUTER,
      UNISWAP_V3_QUOTER,
      deployer
    );

    const shortPath = [
      tokenDataByNetwork.Mainnet.DAI.address,
      WETHToken.Mainnet,
    ];

    const longPath = [
      WETHToken.Mainnet,
      tokenDataByNetwork.Mainnet.DAI.address,
    ];

    const expectedAmountBeforeOpenAcc = await uniV3adapter.getExpectedAmount(
      "ExactTokensToTokens",
      shortPath,
      accountAmount
    );

    const expectedAmountOnCreditAccount = expectedAmountBeforeOpenAcc
      .mul(leverageFactor + LEVERAGE_DECIMALS)
      .div(LEVERAGE_DECIMALS);

    const uniV2adapter = await UniV2helper.getHelper(
      UNISWAP_V2_ADDRESS,
      deployer
    );

    const calldata = await uniV2adapter.getSwapCalldata(
      "ExactTokensToTokens",
      longPath,
      expectedAmountOnCreditAccount,
      deployer.address,
      UniV2helper.getDeadline(),
      0
    );

    const balanceBefore = await ts.daiToken.balanceOf(user.address);

    await ts.daiToken
      .connect(user)
      .approve(ts.leveragedActions.address, MAX_INT);
    await ts.daiToken.transfer(user.address, accountAmount);

    await ts.daiToken.transfer(ts.leveragedActions.address, surplus);

    await ts.leveragedActions.connect(user).openShortUniV3(
      UNISWAP_V3_ROUTER,
      {
        path: UniV3helper.pathToUniV3Path(shortPath),
        recipient: deployer.address,
        deadline: UniV3helper.getDeadline(),
        amountIn: accountAmount,
        amountOutMinimum: expectedAmountBeforeOpenAcc,
      },
      {
        creditManager: ts.creditManagerETH.address,
        leverageFactor,
        swapInterface: SwapInterface.UniswapV2,
        swapContract: UNISWAP_V2_ADDRESS,
        swapCalldata: calldata,
        lpInterface: LPInterface.NoLP,
        lpContract: ADDRESS_0x0,
      },
      referralCode
    );

    expect(await ts.daiToken.balanceOf(user.address)).to.be.eq(
      balanceBefore.add(surplus)
    );

    await ts.wethGateway
      .connect(user)
      .repayCreditAccountETH(ts.creditManagerETH.address, friend.address, {
        value: expectedAmountOnCreditAccount,
      });
  });

  it("[LA-14]: _openShort returns ETH for wethTokens", async () => {
    const shortPath = [
      WETHToken.Mainnet,
      tokenDataByNetwork.Mainnet.DAI.address,
    ];

    const longPath = [
      tokenDataByNetwork.Mainnet.DAI.address,
      WETHToken.Mainnet,
    ];

    const uniV2adapter = await UniV2helper.getHelper(
      UNISWAP_V2_ADDRESS,
      deployer
    );

    const accAmount = await uniV2adapter.getExpectedAmount(
      "TokensToExactTokens",
      shortPath,
      accountAmount
    );

    const expectedAmountBeforeOpenAcc = await uniV2adapter.getExpectedAmount(
      "ExactTokensToTokens",
      shortPath,
      accAmount
    );

    const expectedAmountOnCreditAccount = expectedAmountBeforeOpenAcc
      .mul(leverageFactor + LEVERAGE_DECIMALS)
      .div(LEVERAGE_DECIMALS);

    const calldata = await uniV2adapter.getSwapCalldata(
      "ExactTokensToTokens",
      longPath,
      expectedAmountOnCreditAccount,
      deployer.address,
      UniV2helper.getDeadline(),
      0
    );

    const iWETH = IWETH__factory.connect(ts.wethToken.address, deployer);

    await iWETH.deposit({ value: WAD.mul(100) });
    await ts.wethToken.transfer(ts.leveragedActions.address, WAD.mul(100));

    // Transfers enough money for repaying account
    await ts.daiToken.transfer(
      user.address,
      expectedAmountOnCreditAccount.mul(2)
    );

    const ethBalanceBefore = await user.getBalance();

    const r1 = await ts.leveragedActions.connect(user).openShortUniV2(
      UNISWAP_V2_ADDRESS,
      accAmount,
      expectedAmountBeforeOpenAcc,
      shortPath,
      {
        creditManager: ts.creditManagerDAI.address,
        leverageFactor,
        swapInterface: SwapInterface.UniswapV2,
        swapContract: UNISWAP_V2_ADDRESS,
        swapCalldata: calldata,
        lpInterface: LPInterface.NoLP,
        lpContract: ADDRESS_0x0,
      },
      referralCode,
      { value: accAmount }
    );

    await r1.wait();

    await ts.daiToken
      .connect(user)
      .approve(ts.creditManagerDAI.address, MAX_INT);

    const r2 = await ts.creditManagerDAI
      .connect(user)
      .repayCreditAccount(deployer.address);

    await r2.wait();

    expect(await user.getBalance()).to.be.gt(
      ethBalanceBefore.sub(accountAmountETH).add(WAD.mul(100)).sub(WAD)
    );
  });

  it("[LA-14]: _openShort returns ETH for wethTokens", async () => {});
});

/*
 * SPDX-License-Identifier: BSL-1.1
 * Gearbox. Generalized leverage protocol, which allows to take leverage and then use it across other DeFi protocols and platforms in a composable way.
 * (c) Gearbox.fi, 2021
 */

// @ts-ignore
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { expect } from "../../utils/expect";

import {
  ERC20,
  Errors,
  ICurvePool__factory,
  IERC20__factory,
  IWETH__factory,
  IYVault__factory,
  PoolService,
} from "../../types/ethers-v5";
import { TestDeployer } from "../../deployer/testDeployer";
import { MainnetSuite } from "./helper";
import {
  AdapterInterface,
  ADDRESS_0x0,
  CURVE_3POOL_ADDRESS,
  LEVERAGE_DECIMALS,
  MAX_INT,
  PERCENTAGE_FACTOR,
  SwapType,
  tokenDataByNetwork,
  UNISWAP_V2_ROUTER,
  UNISWAP_V3_QUOTER,
  UNISWAP_V3_ROUTER,
  WAD,
  WETHToken,
  YEARN_DAI_ADDRESS,
  YEARN_USDC_ADDRESS,
} from "@diesellabs/gearbox-sdk";
import { BigNumber } from "ethers";
import {
  DEFAULT_CREDIT_MANAGER,
  DUMB_ADDRESS,
  DUMB_ADDRESS2,
  UNDERLYING_TOKEN_LIQUIDATION_THRESHOLD,
} from "../../core/constants";
import { ERC20__factory } from "@diesellabs/gearbox-sdk/lib/types";
import { CreditManagerTestSuite } from "../../deployer/creditManagerTestSuite";
import {
  CurveHelper,
  UniV2helper,
  UniV3helper,
} from "@diesellabs/gearbox-leverage";
import { STANDARD_INTEREST_MODEL_PARAMS } from "../../core/pool";
import { CreditManagerDeployer } from "../../deployer/creditManagerDeployer";
import { CoreDeployer } from "../../deployer/coreDeployer";
import { TokenDeployer } from "../../deployer/tokenDeployer";

describe("LeveragedActions test (Mainnet test)", function () {
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

    const r6 = await ts.creditFilterDAI.approveAccountTransfers(
      ts.leveragedActions.address,
      true
    );
    await r6.wait();
    const r7 = await ts.creditFilterETH.approveAccountTransfers(
      ts.leveragedActions.address,
      true
    );
    await r7.wait();

    const r8 = await ts.creditFilterDAI
      .connect(user)
      .approveAccountTransfers(ts.leveragedActions.address, true);
    await r6.wait();
    const r9 = await ts.creditFilterETH
      .connect(user)
      .approveAccountTransfers(ts.leveragedActions.address, true);
    await r7.wait();
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
      "UniswapV2",
      UNISWAP_V2_ROUTER,
      await ts.creditFilterDAI.contractToAdapter(UNISWAP_V2_ROUTER),
      ADDRESS_0x0,
      deployer
    );

    const tradePath = await uniV2adapter.getTradePath(
      SwapType.ExactInput,
      expectedAmountOnCreditAccount,
      path
    );

    const calldata = await uniV2adapter.getCalldata(tradePath, 0, deployer);

    const expectedLinkAmount = await uniV2adapter.getExpectedAmount(
      SwapType.ExactInput,
      path,
      expectedAmountOnCreditAccount
    );

    await expect(
      ts.leveragedActions.openLong(
        accountAmount,
        {
          amountOutMin: expectedLinkAmount,
          creditManager: ts.creditManagerDAI.address,
          leverageFactor,
          swapInterface: AdapterInterface.UniswapV2,
          swapContract: UNISWAP_V2_ROUTER,
          swapCalldata: calldata,
          lpInterface: AdapterInterface.NoSwap,
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
        UNISWAP_V2_ROUTER,
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
      "UniswapV2",
      UNISWAP_V2_ROUTER,
      await ts.creditFilterETH.contractToAdapter(UNISWAP_V2_ROUTER),
      ADDRESS_0x0,
      deployer
    );

    const tradePath = await uniV2adapter.getTradePath(
      SwapType.ExactInput,
      expectedAmountOnCreditAccount,
      path
    );

    const calldata = await uniV2adapter.getCalldata(tradePath, 0, deployer);

    const expectedUSDCAmount = await uniV2adapter.getExpectedAmount(
      SwapType.ExactInput,
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
          amountOutMin: yUSDCexpected,
          creditManager: ts.creditManagerETH.address,
          leverageFactor,
          swapInterface: AdapterInterface.UniswapV2,
          swapContract: UNISWAP_V2_ROUTER,
          swapCalldata: calldata,
          lpInterface: AdapterInterface.YearnV2,
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
        UNISWAP_V2_ROUTER,
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
      "UniswapV3",
      UNISWAP_V3_ROUTER,
      await ts.creditFilterDAI.contractToAdapter(UNISWAP_V3_ROUTER),
      UNISWAP_V3_QUOTER,
      ADDRESS_0x0,
      deployer
    );

    const tradePath = await uniV3adapter.getTradePath(
      SwapType.ExactInput,
      expectedAmountOnCreditAccount,
      path
    );
    const calldata = await uniV3adapter.getCalldata(tradePath, 0, deployer);

    const expectedLinkAmount = await uniV3adapter.getExpectedAmount(
      SwapType.ExactInput,
      path,
      expectedAmountOnCreditAccount
    );

    await expect(
      ts.leveragedActions.openLong(
        accountAmount,
        {
          amountOutMin: expectedLinkAmount,
          creditManager: ts.creditManagerDAI.address,
          leverageFactor,
          swapInterface: AdapterInterface.UniswapV3,
          swapContract: UNISWAP_V3_ROUTER,
          swapCalldata: calldata,
          lpInterface: AdapterInterface.NoSwap,
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

    expect(await ts.daiToken.balanceOf(creditAccount), "dai balance").to.be.lte(
      2
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
      "CurveV1",
      CURVE_3POOL_ADDRESS,
      await ts.creditFilterDAI.contractToAdapter(CURVE_3POOL_ADDRESS),
      3,
      deployer
    );

    const tradePath = await curveAdapter.getTradePath(
      SwapType.ExactInput,
      expectedAmountOnCreditAccount,
      path
    );

    const calldata = await curveAdapter.getCalldata(tradePath, 0, deployer);

    const expectedUSDCAmount = await curveAdapter.getExpectedAmount(
      SwapType.ExactInput,
      path,
      expectedAmountOnCreditAccount
    );

    await expect(
      ts.leveragedActions.openLong(
        accountAmount,
        {
          amountOutMin: expectedUSDCAmount,
          creditManager: ts.creditManagerDAI.address,
          leverageFactor,
          swapInterface: AdapterInterface.CurveV1,
          swapContract: CURVE_3POOL_ADDRESS,
          swapCalldata: calldata,
          lpInterface: AdapterInterface.NoSwap,
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

    expect(await ts.daiToken.balanceOf(creditAccount), "dai balance").to.be.lte(
      2
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
      "UniswapV2",
      UNISWAP_V2_ROUTER,
      await ts.creditFilterETH.contractToAdapter(UNISWAP_V2_ROUTER),
      ADDRESS_0x0,
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
      SwapType.ExactInput,
      shortPath,
      accountAmount
    );

    const expectedAmountOnCreditAccount = expectedAmountBeforeOpenAcc
      .mul(leverageFactor + LEVERAGE_DECIMALS)
      .div(LEVERAGE_DECIMALS);

    const tradePath = await uniV2adapter.getTradePath(
      SwapType.ExactInput,
      expectedAmountOnCreditAccount,
      longPath
    );

    const calldata = await uniV2adapter.getCalldata(tradePath, 0, deployer);

    const expectedDAIAmount = await uniV2adapter.getExpectedAmount(
      SwapType.ExactInput,
      longPath,
      expectedAmountOnCreditAccount
    );

    await expect(
      ts.leveragedActions.openShortUniV2(
        UNISWAP_V2_ROUTER,
        accountAmount,
        expectedAmountBeforeOpenAcc,
        shortPath,
        UniV2helper.getDeadline(),
        {
          amountOutMin: expectedDAIAmount,
          creditManager: ts.creditManagerETH.address,
          leverageFactor,
          swapInterface: AdapterInterface.UniswapV2,
          swapContract: UNISWAP_V2_ROUTER,
          swapCalldata: calldata,
          lpInterface: AdapterInterface.NoSwap,
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
        UNISWAP_V2_ROUTER,
        UNISWAP_V2_ROUTER,
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
    ).to.be.lte(2);

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
      "UniswapV3",
      UNISWAP_V3_ROUTER,
      await ts.creditFilterETH.contractToAdapter(UNISWAP_V3_ROUTER),
      UNISWAP_V3_QUOTER,
      ADDRESS_0x0,
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
      SwapType.ExactInput,
      shortPath,
      accountAmount
    );

    const expectedAmountOnCreditAccount = expectedAmountBeforeOpenAcc
      .mul(leverageFactor + LEVERAGE_DECIMALS)
      .div(LEVERAGE_DECIMALS);

    const uniV2adapter = await UniV2helper.getHelper(
      "UniswapV2",
      UNISWAP_V2_ROUTER,
      await ts.creditFilterETH.contractToAdapter(UNISWAP_V2_ROUTER),
      ADDRESS_0x0,
      deployer
    );

    const tradePath = await uniV2adapter.getTradePath(
      SwapType.ExactInput,
      expectedAmountOnCreditAccount,
      longPath
    );

    const calldata = await uniV2adapter.getCalldata(tradePath, 0, deployer);

    const expectedDAIAmount = await uniV2adapter.getExpectedAmount(
      SwapType.ExactInput,
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
          amountOutMin: expectedDAIAmount,
          creditManager: ts.creditManagerETH.address,
          leverageFactor,
          swapInterface: AdapterInterface.UniswapV2,
          swapContract: UNISWAP_V2_ROUTER,
          swapCalldata: calldata,
          lpInterface: AdapterInterface.NoSwap,
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
        UNISWAP_V2_ROUTER,
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
    ).to.be.lte(2);

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
      "CurevAdapter",
      CURVE_3POOL_ADDRESS,
      await ts.creditFilterETH.contractToAdapter(CURVE_3POOL_ADDRESS),
      3,
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
      SwapType.ExactInput,
      shortPath,
      accountAmountUSDC
    );

    const expectedAmountOnCreditAccount = expectedAmountBeforeOpenAcc
      .mul(leverageFactor + LEVERAGE_DECIMALS)
      .div(LEVERAGE_DECIMALS);

    const uniV3adapter = await UniV3helper.getHelper(
      "UniswapV3",
      UNISWAP_V3_ROUTER,
      await ts.creditFilterDAI.contractToAdapter(UNISWAP_V3_ROUTER),
      UNISWAP_V3_QUOTER,
      ADDRESS_0x0,
      deployer
    );

    const tradePath = await uniV3adapter.getTradePath(
      SwapType.ExactInput,
      expectedAmountOnCreditAccount,
      longPath
    );

    const calldata = await uniV3adapter.getCalldata(tradePath, 0, deployer);

    const expectedUSDCAmount = await uniV3adapter.getExpectedAmount(
      SwapType.ExactInput,
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
          amountOutMin: expectedUSDCAmount,
          creditManager: ts.creditManagerDAI.address,
          leverageFactor,
          swapInterface: AdapterInterface.UniswapV3,
          swapContract: UNISWAP_V3_ROUTER,
          swapCalldata: calldata,
          lpInterface: AdapterInterface.NoSwap,
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

    const expectedPoolBalance = poolBalance.sub(
      expectedAmountBeforeOpenAcc.mul(leverageFactor).div(LEVERAGE_DECIMALS)
    );

    expect(
      (await ts.daiToken.balanceOf(ts.poolDAI.address))
        .mul(PERCENTAGE_FACTOR)
        .div(expectedPoolBalance)
        .sub(PERCENTAGE_FACTOR)
        .abs(),
      "Pool balance"
    ).to.be.lte(2);

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

    // @notice it depends on block (timestamp) so yDAI expected should be calculated immediately after call
    const yDAIexpected = await ts.yearnDAI.callStatic["deposit(uint256)"](
      daiBalance
    );

    await expect(
      ts.leveragedActions.openLP(
        ts.creditManagerDAI.address,
        leverageFactor,
        accountAmount,
        AdapterInterface.YearnV2,
        YEARN_DAI_ADDRESS,
        yDAIexpected,
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

  it("[LA-9]: _openLong & openLP reverts for unknown creditManager", async () => {
    const revertMsg = await errors.REGISTERED_CREDIT_ACCOUNT_MANAGERS_ONLY();

    const coreDeployer = new CoreDeployer({ weth: ts.wethToken.address });
    const tokenDeployer = new TokenDeployer(new TestDeployer());
    await tokenDeployer.loadTokens("Mainnet");

    const priceOracle = await coreDeployer.getPriceOracle();

    for (const sym of ["DAI"]) {
      const tokenAddress = tokenDeployer.tokenAddress(sym);

      const priceFeedContract = tokenDeployer.pricefeed(sym);
      const receipt = await priceOracle.addPriceFeed(
        tokenAddress,
        priceFeedContract
      );
      await receipt.wait();
    }

    const creditManagerDeployer = new CreditManagerDeployer({
      coreDeployer,
      config: {
        ...DEFAULT_CREDIT_MANAGER,
        uniswapAddress: ts.uniswapV2.address,
        allowedTokens: [
          {
            address: ts.daiToken.address,
            liquidationThreshold: UNDERLYING_TOKEN_LIQUIDATION_THRESHOLD / 100,
          },
          {
            address: ts.wethToken.address,
            liquidationThreshold: 80,
          },
        ],
      },
      poolService: ts.poolDAI,
      realNetwork: true,
    });

    const creditFilter2 = await creditManagerDeployer.getCreditFilter();
    const creditManager2 = await creditManagerDeployer.getCreditManager();

    const r1 = await creditFilter2.allowContract(
      CURVE_3POOL_ADDRESS,
      DUMB_ADDRESS
    );
    await r1.wait();

    const r2 = await creditFilter2.allowContract(
      UNISWAP_V3_ROUTER,
      DUMB_ADDRESS2
    );
    await r2.wait();

    const usdcToken = IERC20__factory.connect(
      tokenDeployer.tokenAddress("USDC"),
      deployer
    );

    const r3 = await usdcToken.approve(ts.leveragedActions.address, MAX_INT);
    await r3.wait();

    console.log((await usdcToken.balanceOf(deployer.address)).toString());
    console.log(accountAmount.toString());

    await expect(
      ts.leveragedActions.openShortCurve(
        CURVE_3POOL_ADDRESS,
        1,
        0,
        1000,
        0,

        {
          amountOutMin: BigNumber.from(0),
          creditManager: creditManager2.address,
          leverageFactor,
          swapInterface: AdapterInterface.UniswapV3,
          swapContract: UNISWAP_V3_ROUTER,
          swapCalldata: ADDRESS_0x0,
          lpInterface: AdapterInterface.NoSwap,
          lpContract: ADDRESS_0x0,
        },
        referralCode
      )
    ).to.be.revertedWith(revertMsg);

    await expect(
      ts.leveragedActions.openLP(
        creditManager2.address,
        leverageFactor,
        accountAmount,
        AdapterInterface.YearnV2,
        YEARN_DAI_ADDRESS,
        0,
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
      "CurveAdapter",
      CURVE_3POOL_ADDRESS,
      await ts.creditFilterDAI.contractToAdapter(CURVE_3POOL_ADDRESS),
      3,
      deployer
    );

    const shortPath = [
      tokenDataByNetwork.Mainnet.USDC.address,
      tokenDataByNetwork.Mainnet.DAI.address,
    ];

    const expectedAmountBeforeOpenAcc = await curveAdapter.getExpectedAmount(
      SwapType.ExactInput,
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
          amountOutMin: 0,
          creditManager: ts.creditManagerDAI.address,
          leverageFactor,
          swapInterface: AdapterInterface.UniswapV3,
          swapContract: DUMB_ADDRESS,
          swapCalldata: ADDRESS_0x0,
          lpInterface: AdapterInterface.NoSwap,
          lpContract: ADDRESS_0x0,
        },
        referralCode
      )
    ).to.be.revertedWith(revertMsg);
  });

  it("[LA-11]: action reverts if provided msg.value for non-wethtoken", async () => {
    const revertMsg = await errors.LA_HAS_VALUE_WITH_TOKEN_TRANSFER();
    await expect(
      ts.leveragedActions.openLP(
        ts.creditManagerDAI.address,
        leverageFactor,
        accountAmount,
        AdapterInterface.YearnV2,
        YEARN_DAI_ADDRESS,
        0,
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
        AdapterInterface.YearnV2,
        YEARN_DAI_ADDRESS,
        referralCode,
        0,
        { value: WAD }
      )
    ).to.be.revertedWith(revertMsg);
  });

  it("[LA-13]: _openShort returns unused tokens", async () => {
    const surplus = WAD.mul(50000);

    const uniV3adapter = await UniV3helper.getHelper(
      "UniswapV3",
      UNISWAP_V3_ROUTER,
      await ts.creditFilterDAI.contractToAdapter(UNISWAP_V3_ROUTER),
      UNISWAP_V3_QUOTER,
      ADDRESS_0x0,
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
      SwapType.ExactInput,
      shortPath,
      accountAmount
    );

    const expectedAmountOnCreditAccount = expectedAmountBeforeOpenAcc
      .mul(leverageFactor + LEVERAGE_DECIMALS)
      .div(LEVERAGE_DECIMALS);

    const uniV2adapter = await UniV2helper.getHelper(
      "UniswapV2",
      UNISWAP_V2_ROUTER,
      await ts.creditFilterDAI.contractToAdapter(UNISWAP_V2_ROUTER),
      ADDRESS_0x0,
      deployer
    );

    const tradePath = await uniV2adapter.getTradePath(
      SwapType.ExactInput,
      expectedAmountOnCreditAccount,
      longPath
    );

    const calldata = await uniV2adapter.getCalldata(tradePath, 0, deployer);

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
        amountOutMin: tradePath.expectedAmount,
        creditManager: ts.creditManagerETH.address,
        leverageFactor,
        swapInterface: AdapterInterface.UniswapV2,
        swapContract: UNISWAP_V2_ROUTER,
        swapCalldata: calldata,
        lpInterface: AdapterInterface.NoSwap,
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
      "UnswapV2",
      UNISWAP_V2_ROUTER,
      await ts.creditFilterDAI.contractToAdapter(UNISWAP_V2_ROUTER),
      ADDRESS_0x0,
      deployer
    );

    const accAmount = await uniV2adapter.getExpectedAmount(
      SwapType.ExactOutput,
      shortPath,
      accountAmount
    );

    const expectedAmountBeforeOpenAcc = await uniV2adapter.getExpectedAmount(
      SwapType.ExactInput,
      shortPath,
      accAmount
    );

    const expectedAmountOnCreditAccount = expectedAmountBeforeOpenAcc
      .mul(leverageFactor + LEVERAGE_DECIMALS)
      .div(LEVERAGE_DECIMALS);

    const tradePath = await uniV2adapter.getTradePath(
      SwapType.ExactInput,
      expectedAmountOnCreditAccount,
      longPath
    );

    const calldata = await uniV2adapter.getCalldata(tradePath, 0, deployer);

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
      UNISWAP_V2_ROUTER,
      accAmount,
      expectedAmountBeforeOpenAcc,
      shortPath,
      UniV2helper.getDeadline(),
      {
        amountOutMin: tradePath.expectedAmount,
        creditManager: ts.creditManagerDAI.address,
        leverageFactor,
        swapInterface: AdapterInterface.UniswapV2,
        swapContract: UNISWAP_V2_ROUTER,
        swapCalldata: calldata,
        lpInterface: AdapterInterface.NoSwap,
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

  it("[LA-14]: _openShortUniV2 reverts if path.length <2 ", async () => {
    const revertMsg = await errors.INCORRECT_PATH_LENGTH();

    const longPath = [
      tokenDataByNetwork.Mainnet.DAI.address,
      WETHToken.Mainnet,
    ];

    const uniV2adapter = await UniV2helper.getHelper(
      "UnswapV2",
      UNISWAP_V2_ROUTER,
      await ts.creditFilterDAI.contractToAdapter(UNISWAP_V2_ROUTER),
      ADDRESS_0x0,
      deployer
    );

    const tradePath = await uniV2adapter.getTradePath(
      SwapType.ExactInput,
      BigNumber.from(10000),
      longPath
    );

    const calldata = await uniV2adapter.getCalldata(tradePath, 0, deployer);

    await expect(
      ts.leveragedActions.connect(user).openShortUniV2(
        UNISWAP_V2_ROUTER,
        100,
        200,
        [WETHToken.Mainnet],
        UniV2helper.getDeadline(),
        {
          amountOutMin: tradePath.expectedAmount,
          creditManager: ts.creditManagerDAI.address,
          leverageFactor,
          swapInterface: AdapterInterface.UniswapV2,
          swapContract: UNISWAP_V2_ROUTER,
          swapCalldata: calldata,
          lpInterface: AdapterInterface.NoSwap,
          lpContract: ADDRESS_0x0,
        },
        referralCode,
        { value: 100 }
      )
    ).to.be.revertedWith(revertMsg);

    await expect(
      ts.leveragedActions.connect(user).openShortUniV3(
        UNISWAP_V3_ROUTER,
        {
          path: UniV3helper.pathToUniV3Path([WETHToken.Mainnet]),
          recipient: deployer.address,
          deadline: UniV3helper.getDeadline(),
          amountIn: accountAmount,
          amountOutMinimum: BigNumber.from(0),
        },
        {
          amountOutMin: tradePath.expectedAmount,
          creditManager: ts.creditManagerDAI.address,
          leverageFactor,
          swapInterface: AdapterInterface.UniswapV2,
          swapContract: UNISWAP_V2_ROUTER,
          swapCalldata: calldata,
          lpInterface: AdapterInterface.NoSwap,
          lpContract: ADDRESS_0x0,
        },
        referralCode,
        { value: 100 }
      )
    ).to.be.revertedWith(revertMsg);
  });
});

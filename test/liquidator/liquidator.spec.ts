/*
 * SPDX-License-Identifier: BSL-1.1
 * Gearbox. Generalized leverage protocol, which allows to take leverage and then use it across other DeFi protocols and platforms in a composable way.
 * (c) Gearbox.fi, 2021
 */

// @ts-ignore
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { BigNumber } from "ethers";
import * as dotenv from "dotenv";
import {
  AddressProvider__factory,
  CreditFilter,
  CreditFilter__factory,
  CreditManager,
  CreditManager__factory,
  DataCompressor__factory,
  ERC20__factory,
  ISwapRouter,
  ISwapRouter__factory,
  IUniswapV2Router02,
  IUniswapV2Router02__factory,
  IYVault,
  IYVault__factory,
  LEVERAGE_DECIMALS,
  MAX_INT,
  PoolService,
  PoolService__factory,
  tokenDataByNetwork,
  UNISWAP_V2_ROUTER,
  UNISWAP_V3_ROUTER,
  UniswapV2Adapter__factory,
  WAD,
  WETHGateway__factory,
  WETHToken,
  YEARN_DAI_KOVAN_MOCK,
  YEARN_USDC_KOVAN_MOCK,
} from "@diesellabs/gearbox-sdk";
import { ERC20 } from "../../types/ethers-v5";

describe("Liquidator test", function () {
  this.timeout(0);

  const daiLiquidity = BigNumber.from(10000).mul(WAD);
  const ethLiquidity = BigNumber.from(50).mul(WAD);
  const accountAmount = BigNumber.from(1000).mul(WAD);
  const leverageFactor = 4 * LEVERAGE_DECIMALS;
  const referralCode = 888777;

  let deployer: SignerWithAddress;
  let user: SignerWithAddress;

  let daiToken: ERC20;

  let creditManagerDAI: CreditManager;
  let creditManagerETH: CreditManager;
  let creditFilterDAI: CreditFilter;
  let creditFilterETH: CreditFilter;

  let uniswapV2: IUniswapV2Router02;
  let uniswapV3: ISwapRouter;
  let yearnDAI: IYVault;
  let yearnUSDC: IYVault;

  before(async () => {
    dotenv.config({ path: ".env.local" });

    const accounts = (await ethers.getSigners()) as Array<SignerWithAddress>;
    deployer = accounts[0];
    user = accounts[1];

    const apAddress = process.env.REACT_APP_ADDRESS_PROVIDER;
    if (!apAddress || apAddress === "")
      throw new Error("REACT_APP_ADDRESS_PROVIDER is not set");

    const addressProvider = AddressProvider__factory.connect(
      apAddress,
      deployer
    );
    const dataCompressor = DataCompressor__factory.connect(
      await addressProvider.getDataCompressor(),
      deployer
    );

    const wethGateway = WETHGateway__factory.connect(
      await addressProvider.getWETHGateway(),
      deployer
    );

    const pools = await dataCompressor.getPoolsList();
    let poolDAI: PoolService | undefined = undefined;
    let poolETH: PoolService | undefined = undefined;

    for (let pool of pools) {
      if (
        pool.underlyingToken.toLowerCase() ===
        tokenDataByNetwork.Mainnet.DAI.address.toLowerCase()
      ) {
        poolDAI = PoolService__factory.connect(pool.addr, deployer);
      }
      if (
        pool.underlyingToken.toLowerCase() === WETHToken.Mainnet.toLowerCase()
      ) {
        poolETH = PoolService__factory.connect(pool.addr, deployer);
      }
    }

    const creditManagers = await dataCompressor.getCreditManagersList(
      deployer.address
    );
    for (let cm of creditManagers) {
      if (
        cm.underlyingToken.toLowerCase() ===
        tokenDataByNetwork.Mainnet.DAI.address.toLowerCase()
      ) {
        creditManagerDAI = CreditManager__factory.connect(cm.addr, deployer);
      }
      if (
        cm.underlyingToken.toLowerCase() === WETHToken.Mainnet.toLowerCase()
      ) {
        creditManagerETH = CreditManager__factory.connect(cm.addr, deployer);
      }
    }

    if (!poolDAI || !poolETH || !creditManagerDAI || !creditManagerETH) {
      throw new Error("pool or creditManager incorrect config");
    }

    creditFilterDAI = CreditFilter__factory.connect(
      await creditManagerDAI.creditFilter(),
      deployer
    );

    creditFilterETH = CreditFilter__factory.connect(
      await creditManagerETH.creditFilter(),
      deployer
    );

    uniswapV2 = IUniswapV2Router02__factory.connect(
      UNISWAP_V2_ROUTER,
      deployer
    );
    uniswapV3 = ISwapRouter__factory.connect(UNISWAP_V3_ROUTER, deployer);

    yearnDAI = IYVault__factory.connect(YEARN_DAI_KOVAN_MOCK, deployer);
    yearnUSDC = IYVault__factory.connect(YEARN_USDC_KOVAN_MOCK, deployer);

    daiToken = ERC20__factory.connect(
      tokenDataByNetwork.Mainnet.DAI.address,
      deployer
    ) as ERC20;
    const wethToken = ERC20__factory.connect(WETHToken.Mainnet, deployer);

    const r1 = await daiToken
      .connect(user)
      .approve(creditManagerDAI.address, MAX_INT);
    await r1.wait();

    const r2 = await daiToken.approve(poolDAI.address, MAX_INT);
    await r2.wait();

    const r3 = await poolDAI.addLiquidity(daiLiquidity, deployer.address, 3);
    await r3.wait();

    const poolAmount = await poolETH.availableLiquidity();

    if (poolAmount.lt(ethLiquidity)) {
      const r5 = await wethGateway.addLiquidityETH(
        poolETH.address,
        deployer.address,
        2,
        { value: ethLiquidity.sub(poolAmount) }
      );
      await r5.wait();
    }

    const r6 = await daiToken.connect(user).approve(UNISWAP_V2_ROUTER, MAX_INT);
    await r6.wait();

    const r7 = await daiToken
      .connect(deployer)
      .transfer(user.address, accountAmount.mul(2));
    await r7.wait();
  });

  const openUserAccount = async (
    creditManager: CreditManager,
    creditFilter: CreditFilter
  ) => {
    const amountOnAccount = accountAmount
      .mul(leverageFactor + LEVERAGE_DECIMALS)
      .div(LEVERAGE_DECIMALS);

    const adapter = await creditFilter.contractToAdapter(UNISWAP_V2_ROUTER);

    if (!(await creditManager.hasOpenedCreditAccount(user.address))) {
      const r1 = await creditManager.connect(user).openCreditAccount(
        accountAmount,
        user.address,
        leverageFactor, // 150, x400 = 150 + 150x4.00=750 as result
        referralCode
      );
      await r1.wait();
    }

    const creditAccount = await creditManager.getCreditAccountOrRevert(
      user.address
    );

    const uniV2adapter = UniswapV2Adapter__factory.connect(adapter, user);

    return {
      amountOnAccount,
      creditAccount,
      uniV2adapter,
    };
  };

  const waitToBeLiquidated = (creditManager: CreditManager): Promise<void> => {
    return new Promise<void>((resolve) => {
      creditManager.once(
        creditManager.filters.LiquidateCreditAccount(user.address),
        () => resolve()
      );
    });
  };

  it("[L-1]: liquidator works correctly for DAIU creditManage", async () => {
    const { amountOnAccount, creditAccount, uniV2adapter } =
      await openUserAccount(creditManagerDAI, creditFilterDAI);

    console.log(`Account ${creditAccount} should be liquidated`);

    const path = [tokenDataByNetwork.Mainnet.DAI.address, WETHToken.Mainnet];

    const amount = await daiToken.balanceOf(creditAccount);

    console.log(amount.toString());

    if (amount.gt(1)) {
      const BigLT = await creditFilterDAI.liquidationThresholds(
        daiToken.address
      );

      // Reduce liquidation threshold to 1
      const r0 = await creditFilterDAI
        .connect(deployer)
        .allowToken(WETHToken.Mainnet, BigLT.sub(1));
      await r0.wait();

      const r1 = await uniV2adapter
        .connect(user)
        .swapExactTokensForTokens(
          amount,
          0,
          path,
          deployer.address,
          Date.now() + 3600 * 24
        );

      await r1.wait();
    }

    const previousLT = await creditFilterDAI.liquidationThresholds(
      WETHToken.Mainnet
    );

    // Reduce liquidation threshold to 1
    const r2 = await creditFilterDAI
      .connect(deployer)
      .allowToken(WETHToken.Mainnet, 1);
    await r2.wait();

    console.log("Waiting for liquidator");
    await waitToBeLiquidated(creditManagerDAI);

    //
    // ADD CHECKS HOW CORRECT YOUR LIQUIDATION WAS
    //

    // Reduce lquidation thresold to 1
    const r3 = await creditFilterDAI
      .connect(deployer)
      .allowToken(WETHToken.Mainnet, previousLT);
    await r3.wait();
  });
});

/*
 * SPDX-License-Identifier: BSL-1.1
 * Gearbox. Generalized leverage protocol, which allows to take leverage and then use it across other DeFi protocols and platforms in a composable way.
 * (c) Gearbox.fi, 2021
 */
// @ts-ignore
import { ethers } from "hardhat";
import * as dotenv from "dotenv";
import { CreditManagerTestSuite } from "../../deployer/creditManagerTestSuite";
import {
  AccountFactory,
  AccountFactory__factory,
  AddressProvider,
  AddressProvider__factory,
  CreditFilter,
  CreditFilter__factory,
  CreditManager,
  CreditManager__factory,
  DataCompressor,
  DataCompressor__factory,
  ERC20,
  ERC20__factory,
  ICurvePool,
  ICurvePool__factory,
  ISwapRouter,
  ISwapRouter__factory,
  IUniswapV2Router02,
  IUniswapV2Router02__factory,
  IYVault,
  IYVault__factory,
  LeveragedActions,
  LeveragedActions__factory,
  PoolService,
  PoolService__factory,
  PriceOracle,
  PriceOracle__factory,
  WETHGateway,
  WETHGateway__factory
} from "../../types/ethers-v5";

import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { DUMB_ADDRESS } from "../../core/constants";
import {
  CURVE_3POOL_ADDRESS,
  SUSHISWAP_MAINNET,
  tokenDataByNetwork,
  UNISWAP_V2_ROUTER,
  UNISWAP_V3_ROUTER,
  WETHToken,
  YEARN_DAI_ADDRESS,
  YEARN_USDC_ADDRESS
} from "@diesellabs/gearbox-sdk";

export class MainnetSuite {
  static async getSuite(): Promise<MainnetSuite> {
    dotenv.config({ path: ".env.local" });

    const accounts = (await ethers.getSigners()) as Array<SignerWithAddress>;
    const deployer = accounts[0];

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
    const accountFactory = AccountFactory__factory.connect(
      await addressProvider.getAccountFactory(),
      deployer
    );
    const wethGateway = WETHGateway__factory.connect(
      await addressProvider.getWETHGateway(),
      deployer
    );
    const priceOracle = PriceOracle__factory.connect(
      await addressProvider.getPriceOracle(),
      deployer
    );
    const leveragedActions = LeveragedActions__factory.connect(
      await addressProvider.getLeveragedActions(),
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

    let creditManagerDAI: CreditManager | undefined = undefined;
    let creditManagerETH: CreditManager | undefined = undefined;
    const creditManagers = await dataCompressor.getCreditManagersList(
      DUMB_ADDRESS
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

    const creditFilterDAI = CreditFilter__factory.connect(
      await creditManagerDAI.creditFilter(),
      deployer
    );
    const creditFilterETH = CreditFilter__factory.connect(
      await creditManagerETH.creditFilter(),
      deployer
    );

    const uniswapV2 = IUniswapV2Router02__factory.connect(
      UNISWAP_V2_ROUTER,
      deployer
    );
    const uniswapV3 = ISwapRouter__factory.connect(UNISWAP_V3_ROUTER, deployer);
    const sushiswap = IUniswapV2Router02__factory.connect(
      SUSHISWAP_MAINNET,
      deployer
    );
    const curve3pool = ICurvePool__factory.connect(
      CURVE_3POOL_ADDRESS,
      deployer
    );
    const yearnDAI = IYVault__factory.connect(YEARN_DAI_ADDRESS, deployer);
    const yearnUSDC = IYVault__factory.connect(YEARN_USDC_ADDRESS, deployer);

    const daiToken = ERC20__factory.connect(
      tokenDataByNetwork.Mainnet.DAI.address,
      deployer
    );
    const wethToken = ERC20__factory.connect(WETHToken.Mainnet, deployer);

    return new MainnetSuite({
      addressProvider,
      dataCompressor,
      accountFactory,
      wethGateway,
      priceOracle,
      leveragedActions,
      poolDAI,
      poolETH,
      creditManagerDAI,
      creditFilterDAI,
      creditManagerETH,
      creditFilterETH,
      uniswapV2,
      uniswapV3,
      sushiswap,
      curve3pool,
      yearnDAI,
      yearnUSDC,
      daiToken,
      wethToken,
    });
  }

  public readonly addressProvider: AddressProvider;
  public readonly dataCompressor: DataCompressor;
  public readonly accountFactory: AccountFactory;
  public readonly wethGateway: WETHGateway;
  public readonly priceOracle: PriceOracle;
  public readonly leveragedActions: LeveragedActions;

  public readonly poolDAI: PoolService;
  public readonly poolETH: PoolService;

  public readonly creditManagerDAI: CreditManager;
  public readonly creditFilterDAI: CreditFilter;
  public readonly creditManagerETH: CreditManager;
  public readonly creditFilterETH: CreditFilter;

  public readonly uniswapV2: IUniswapV2Router02;
  public readonly uniswapV3: ISwapRouter;
  public readonly sushiswap: IUniswapV2Router02;
  public readonly curve3pool: ICurvePool;
  public readonly yearnDAI: IYVault;
  public readonly yearnUSDC: IYVault;

  public readonly daiToken: ERC20;
  public readonly wethToken: ERC20;

  constructor(opts: {
    addressProvider: AddressProvider;
    dataCompressor: DataCompressor;
    accountFactory: AccountFactory;
    wethGateway: WETHGateway;
    priceOracle: PriceOracle;
    leveragedActions: LeveragedActions;
    poolDAI: PoolService;
    poolETH: PoolService;
    creditManagerDAI: CreditManager;
    creditFilterDAI: CreditFilter;
    creditManagerETH: CreditManager;
    creditFilterETH: CreditFilter;
    uniswapV2: IUniswapV2Router02;
    uniswapV3: ISwapRouter;
    sushiswap: IUniswapV2Router02;
    curve3pool: ICurvePool;
    yearnDAI: IYVault;
    yearnUSDC: IYVault;
    daiToken: ERC20;
    wethToken: ERC20;
  }) {
    this.addressProvider = opts.addressProvider;
    this.dataCompressor = opts.dataCompressor;
    this.accountFactory = opts.accountFactory;
    this.wethGateway = opts.wethGateway;
    this.priceOracle = opts.priceOracle;
    this.leveragedActions = opts.leveragedActions;
    this.poolDAI = opts.poolDAI;
    this.poolETH = opts.poolETH;
    this.creditManagerDAI = opts.creditManagerDAI;
    this.creditFilterDAI = opts.creditFilterDAI;
    this.creditManagerETH = opts.creditManagerETH;
    this.creditFilterETH = opts.creditFilterETH;
    this.uniswapV2 = opts.uniswapV2;
    this.uniswapV3 = opts.uniswapV3;
    this.sushiswap = opts.sushiswap;
    this.curve3pool = opts.curve3pool;
    this.yearnDAI = opts.yearnDAI;
    this.yearnUSDC = opts.yearnUSDC;
    this.daiToken = opts.daiToken;
    this.wethToken = opts.wethToken;
  }
}

async function makeSuite(): Promise<CreditManagerTestSuite> {
  const ts = new CreditManagerTestSuite({
    coreConfig: {
      weth: WETHToken.Mainnet,
    },
  });
  await ts.getSuite();
  await ts.setupCreditManager();
  return ts;
}

export async function makeCreditManagerSuite(
  name: string,
  testCase: (ts: CreditManagerTestSuite) => void
) {
  const ts = await makeSuite();
  return describe(name, () => testCase(ts));
}

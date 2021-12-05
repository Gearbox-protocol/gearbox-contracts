/*
 * SPDX-License-Identifier: BSL-1.1
 * Gearbox. Generalized leverage protocol, which allows to take leverage and then use it across other DeFi protocols and platforms in a composable way.
 * (c) Gearbox.fi, 2021
 */
// @ts-ignore
import { ethers } from "hardhat";
import { expect } from "../utils/expect";

import {
  AccountFactory__factory,
  ACL,
  ACL__factory,
  AdaptersDeployer,
  AdaptersDeployer__factory,
  AddressProvider,
  AddressProvider__factory,
  ContractsRegister,
  ContractsRegister__factory,
  CreditFilter,
  CreditFilter__factory,
  CreditManager,
  CreditManager__factory,
  DieselToken,
  DieselToken__factory,
  ERC20,
  GearToken,
  GearToken__factory,
  GenesisDeployer,
  GenesisDeployer__factory,
  IAppAddressProvider__factory,
  ICreditAccount__factory,
  IYVault,
  LeveragedActions__factory,
  LinearInterestRateModel__factory,
  PoolDeployer,
  PoolDeployer__factory,
  PoolService,
  PoolService__factory,
  PriceOracle__factory,
  StepVesting__factory,
  TokenDistributor,
  TokenDistributor__factory,
  YearnMock,
  YearnPriceFeed__factory,
} from "../types/ethers-v5";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import {
  AdapterInterface,
  ADDRESS_0x0,
  CURVE_3POOL_ADDRESS,
  MAX_INT,
  PERCENTAGE_FACTOR,
  RAY,
  SECONDS_PER_YEAR,
  SUSHISWAP_MAINNET,
  TokenShare,
  UNISWAP_V2_ROUTER,
  UNISWAP_V3_ROUTER,
  WAD,
  YEARN_DAI_ADDRESS,
  YEARN_USDC_ADDRESS,
} from "@diesellabs/gearbox-sdk";
import {
  DUMB_ADDRESS,
  DUMB_ADDRESS2,
  OWNABLE_REVERT_MSG,
} from "../core/constants";
import { TestDeployer } from "../deployer/testDeployer";
import { BigNumberish, BytesLike } from "ethers";
import { MerkleDistributorInfo, parseAccounts } from "../merkle/parse-accounts";
import { IntegrationsDeployer } from "../deployer/integrationsDeployer";
import { AdapterConfig } from "../core/adapterHelper";

describe("PoolDeployer", function () {
  let deployer: SignerWithAddress;
  let angel: SignerWithAddress;
  let user: SignerWithAddress;
  let friend: SignerWithAddress;
  let independent: SignerWithAddress;

  let testDeployer: TestDeployer;

  let genesisDeployer: GenesisDeployer;
  let poolDeployer: PoolDeployer;

  let tokenA: ERC20;
  let tokenB: ERC20;
  let tokenC: ERC20;
  let tokenD: ERC20;
  let yVaultA: IYVault;
  let yVaultB: YearnMock;

  let contractA: string;
  let contractB: string;

  const treasury = DUMB_ADDRESS;
  const U_optimal = 10000;
  const R_base = 4500;
  const R_slope1 = 1500;
  const R_slope2 = 6500;
  const expectedLiquidityLimit = WAD.mul(1000);
  const minAmount = WAD;
  const maxAmount = WAD.mul(2);
  const maxLeverage = 456;
  const defaultSwapContract = UNISWAP_V2_ROUTER;

  let addressProvider: AddressProvider;
  let acl: ACL;
  let dieselToken: DieselToken;
  let pool: PoolService;
  let creditFilter: CreditFilter;
  let creditManager: CreditManager;

  let adaptersDeployer: AdaptersDeployer;
  let allowedTokens: Array<{
    token: string;
    liquidationThreshold: BigNumberish;
  }> = [];
  const adapters: Array<AdapterConfig> = [
    {
      adapterType: AdapterInterface.UniswapV3,
      targetContract: UNISWAP_V3_ROUTER,
    },
    {
      adapterType: AdapterInterface.UniswapV2,
      targetContract: UNISWAP_V2_ROUTER,
    },
    {
      adapterType: AdapterInterface.UniswapV2,
      targetContract: SUSHISWAP_MAINNET,
    },
    {
      adapterType: AdapterInterface.CurveV1,
      targetContract: CURVE_3POOL_ADDRESS,
    },
  ];

  beforeEach(async () => {
    deployer = (await ethers.getSigners())[0] as SignerWithAddress;
    angel = (await ethers.getSigners())[1] as SignerWithAddress;
    user = (await ethers.getSigners())[2] as SignerWithAddress;
    friend = (await ethers.getSigners())[3] as SignerWithAddress;
    independent = (await ethers.getSigners())[4] as SignerWithAddress;

    testDeployer = new TestDeployer();
    const wethMock = await testDeployer.getWethMock();

    const genesisDeployerFactory = (await ethers.getContractFactory(
      "GenesisDeployer"
    )) as GenesisDeployer__factory;

    tokenA = await testDeployer.getTokenMock("tokenA", "TTA");
    tokenB = await testDeployer.getTokenMock("tokenB", "TTB");
    tokenC = await testDeployer.getTokenMock("tokenC", "TTC");
    tokenD = await testDeployer.getTokenMock("tokenD", "TTD");

    const chainlinkOracleA = await testDeployer.getChainlinkPriceFeedMock(WAD);
    const chainlinkOracleB = await testDeployer.getChainlinkPriceFeedMock(
      WAD.mul(2)
    );
    const chainlinkOracleC = await testDeployer.getChainlinkPriceFeedMock(
      WAD.mul(3)
    );
    const chainlinkOracleD = await testDeployer.getChainlinkPriceFeedMock(
      WAD.mul(4)
    );

    contractA = DUMB_ADDRESS;
    contractB = DUMB_ADDRESS2;

    const miningApprovals = [
      { token: tokenA.address, swapContract: contractA },
      { token: tokenA.address, swapContract: contractB },
    ];

    genesisDeployer = await genesisDeployerFactory.deploy({
      wethToken: wethMock.address,
      treasury,
      miningApprovals,
    });

    addressProvider = AddressProvider__factory.connect(
      await genesisDeployer.addressProvider(),
      deployer
    );

    const priceFeeds: { token: string; priceFeed: string }[] = [
      {
        token: tokenA.address,
        priceFeed: chainlinkOracleA.address,
      },
      {
        token: tokenB.address,
        priceFeed: chainlinkOracleB.address,
      },
      {
        token: tokenC.address,
        priceFeed: chainlinkOracleC.address,
      },
      {
        token: tokenD.address,
        priceFeed: chainlinkOracleD.address,
      },
    ];

    const integrationDeployer = new IntegrationsDeployer();

    yVaultA = await integrationDeployer.getYearnVaultMock(tokenA.address);
    yVaultB = await integrationDeployer.getYearnVaultMock(tokenB.address);

    await yVaultB.addUpdater(deployer.address);
    await yVaultB.setPricePerShare(WAD.mul(2));

    const yearnPriceFeeds: {
      yVault: string;
      lowerBound: BigNumberish;
      upperBound: BigNumberish;
    }[] = [
      {
        yVault: yVaultA.address,
        lowerBound: WAD,
        upperBound: WAD.mul(12).div(10),
      },
      {
        yVault: yVaultB.address,
        lowerBound: WAD.mul(2),
        upperBound: WAD.mul(20).div(8),
      },
    ];

    acl = ACL__factory.connect(await genesisDeployer.acl(), deployer);
    await acl.transferOwnership(genesisDeployer.address);
    await genesisDeployer.addPriceFeeds(priceFeeds, yearnPriceFeeds);

    const poolDeployerFactory = (await ethers.getContractFactory(
      "PoolDeployer"
    )) as PoolDeployer__factory;

    poolDeployer = await poolDeployerFactory.deploy({
      addressProvider: addressProvider.address,
      underlyingToken: tokenA.address,
      U_optimal,
      R_base,
      R_slope1,
      R_slope2,
      expectedLiquidityLimit,
      minAmount,
      maxAmount,
      maxLeverage,
      defaultSwapContract,
    });

    pool = PoolService__factory.connect(await poolDeployer.pool(), deployer);

    dieselToken = DieselToken__factory.connect(
      await pool.dieselToken(),
      deployer
    );

    creditFilter = CreditFilter__factory.connect(
      await poolDeployer.creditFilter(),
      deployer
    );

    creditManager = CreditManager__factory.connect(
      await poolDeployer.creditManager(),
      deployer
    );

    allowedTokens = [
      {
        token: tokenB.address,
        liquidationThreshold: 1200,
      },
      {
        token: tokenC.address,
        liquidationThreshold: 2400,
      },
      {
        token: tokenD.address,
        liquidationThreshold: 9200,
      },
      {
        token: yVaultA.address,
        liquidationThreshold: 1200,
      },
      {
        token: yVaultB.address,
        liquidationThreshold: 2200,
      },
    ];
  });

  it("[PD-1]: Pool Deployer deploys all contracts correctly", async () => {
    expect(await dieselToken.name()).to.be.eq(
      "diesel " + (await tokenA.name())
    );
    expect(await dieselToken.symbol()).to.be.eq("d" + (await tokenA.symbol()));
    expect(await dieselToken.decimals()).to.be.eq(await tokenA.decimals());
    expect(await pool.underlyingToken()).to.be.eq(tokenA.address);
    expect(await pool.expectedLiquidityLimit()).to.be.eq(
      expectedLiquidityLimit
    );

    const lm = LinearInterestRateModel__factory.connect(
      await pool.interestRateModel(),
      deployer
    );
    expect(await lm._U_Optimal_WAD(), "U optimal").to.be.eq(
      WAD.mul(U_optimal).div(PERCENTAGE_FACTOR)
    );
    expect(await lm._R_base_RAY(), "R_base").to.be.eq(
      RAY.mul(R_base).div(PERCENTAGE_FACTOR)
    );
    expect(await lm._R_slope1_RAY()).to.be.eq(
      RAY.mul(R_slope1).div(PERCENTAGE_FACTOR)
    );
    expect(await lm._R_slope2_RAY()).to.be.eq(
      RAY.mul(R_slope2).div(PERCENTAGE_FACTOR)
    );

    expect(await creditManager.minAmount()).to.be.eq(minAmount);
    expect(await creditManager.maxAmount()).to.be.eq(maxAmount);
    expect(await creditManager.maxLeverageFactor()).to.be.eq(maxLeverage);
    expect(await creditManager.creditFilter()).to.be.eq(creditFilter.address);
    expect(await creditManager.defaultSwapContract()).to.be.eq(
      UNISWAP_V2_ROUTER
    );
  });

  it("[PD-2]: Pool Deployer depoloys all contracts correctly", async () => {
    const contractRegister = ContractsRegister__factory.connect(
      await addressProvider.getContractsRegister(),
      deployer
    );

    expect(await contractRegister.isPool(pool.address)).to.be.false;
    expect(await contractRegister.isCreditManager(creditManager.address)).to.be
      .false;

    await acl.transferOwnership(poolDeployer.address);

    await poolDeployer.configure({
      allowedTokens,
    });

    expect(await contractRegister.isPool(pool.address), "isPool").to.be.true;
    expect(
      await contractRegister.isCreditManager(creditManager.address),
      "isCreditManager"
    ).to.be.true;
    expect(await acl.owner()).to.be.eq(deployer.address);
    expect(await creditFilter.creditManager()).to.be.eq(creditManager.address);

    expect(
      await pool.creditManagersCanBorrow(creditManager.address),
      "creditManagerCanBorrow"
    ).to.be.true;
    expect(
      await pool.creditManagersCanRepay(creditManager.address),
      "creditManageCanRepay"
    ).to.be.true;

    for (let at of allowedTokens) {
      expect(await creditFilter.isTokenAllowed(at.token)).to.be.true;
      expect(await creditFilter.liquidationThresholds(at.token)).to.be.eq(
        at.liquidationThreshold
      );
    }
  });

  it("[PD-3]: Adapter deployer works correctly", async () => {
    const leverageActionsFactory = (await ethers.getContractFactory(
      "LeveragedActions"
    )) as LeveragedActions__factory;

    const leveragedActions = await leverageActionsFactory.deploy(
      addressProvider.address
    );
    await leveragedActions.deployed();

    await addressProvider.setLeveragedActions(leveragedActions.address);

    await acl.transferOwnership(poolDeployer.address);

    await poolDeployer.configure({
      allowedTokens,
    });

    // ADAPTERS DEPLOYER

    const adaptersDeployerFactory = (await ethers.getContractFactory(
      "AdaptersDeployer"
    )) as AdaptersDeployer__factory;

    adapters.push(
      {
        // DAI YVault
        adapterType: AdapterInterface.YearnV2,
        targetContract: yVaultA.address,
      },
      {
        // DAI YVault
        adapterType: AdapterInterface.YearnV2,
        targetContract: yVaultB.address,
      }
    );

    adaptersDeployer = await adaptersDeployerFactory.deploy({
      addressProvider: addressProvider.address,
      creditManager: creditManager.address,
      adapters,
    });

    const adaptersContracts: Array<string> = [];

    for (let i = 0; i < adapters.length; i++) {
      const adapt = await adaptersDeployer.adapters(i);
      adaptersContracts.push(adapt.adapter);
      expect(adapt.targetContract).to.be.eq(adapters[i].targetContract);
    }

    await expect(
      adaptersDeployer.connect(user).connectAdapters()
    ).to.be.revertedWith(OWNABLE_REVERT_MSG);

    await acl.transferOwnership(adaptersDeployer.address);
    await adaptersDeployer.connectAdapters();

    for (let i = 0; i < adapters.length; i++) {
      expect(
        await creditFilter.contractToAdapter(adapters[i].targetContract)
      ).to.be.eq(adaptersContracts[i]);
      expect(await creditFilter.allowedAdapters(adaptersContracts[i])).to.be
        .true;
    }

    expect(await acl.owner()).to.be.eq(deployer.address);
  });
});

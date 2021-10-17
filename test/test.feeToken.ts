// @ts-ignore
import { ethers, waffle } from "hardhat";
import { expect } from "../utils/expect";

import {
  CreditFilterMock,
  CreditManager,
  PoolService,
  DieselToken,
  Errors,
  TokenFeeMock,
  TokenMock,
  LeveragedActions__factory,
  YearnMock__factory,
  IUniswapV2Router02__factory,
} from "../types/ethers-v5";
import { CoreDeployer } from "../deployer/coreDeployer";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { PoolDeployer } from "../deployer/poolDeployer";
import { IntegrationsDeployer } from "../deployer/integrationsDeployer";
import { TestDeployer } from "../deployer/testDeployer";
import { PoolTestSuite } from "../deployer/poolTestSuite";
import { CreditManagerTestSuite } from "../deployer/creditManagerTestSuite";
import {
  AdapterInterface,
  ADDRESS_0x0,
  MAX_INT,
  PERCENTAGE_FACTOR,
  RAY,
  WAD,
} from "@diesellabs/gearbox-sdk";
import { STANDARD_INTEREST_MODEL_PARAMS } from "../core/pool";
import { UniV2helper } from "@diesellabs/gearbox-leverage";

const { addLiquidity } = PoolTestSuite;
const fee = 4000; // 40%

describe("CreditManager", function () {
  let ts: CreditManagerTestSuite;

  let deployer: SignerWithAddress;
  let coreDeployer: CoreDeployer;
  let integrationsDeployer: IntegrationsDeployer;
  let poolDeployer: PoolDeployer;
  let testDeployer: TestDeployer;
  let feeToken: TokenFeeMock;

  let poolService: PoolService;
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
    const testDeployer = await new TestDeployer();

    feeToken = await testDeployer.getTokenFeeMock("FEE", "FEE", fee);

    ts = new CreditManagerTestSuite({
      poolConfig: {
        interestModel: STANDARD_INTEREST_MODEL_PARAMS,
        expectedLiquidityLimit: MAX_INT,
        underlyingToken: feeToken.address,
      },
    });

    // const pool = ts.poolDeployer.

    await ts.getSuite();
    // await ts.usePoolMockForCreditManager();
    await ts.setupCreditManager();

    deployer = ts.deployer;
    coreDeployer = ts.coreDeployer;
    integrationsDeployer = ts.integrationsDeployer;
    poolDeployer = ts.poolDeployer;

    poolService = ts.poolService;
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

  it("[FT-1]: deposit opens correct correct tokens back", async () => {
    const amount = WAD.mul(100);
    const expectedAmount = amount
      .mul(PERCENTAGE_FACTOR - fee)
      .div(PERCENTAGE_FACTOR);

    await feeToken.transfer(user.address, amount);
    await feeToken.connect(user).approve(poolService.address, MAX_INT);
    await poolService.connect(user).addLiquidity(amount, user.address, 0);

    expect(await ts.dieselToken.balanceOf(user.address)).to.be.eq(
      expectedAmount
    );
  });

  it("[FT-2]: LeveragedActions.openLP works correct with fee tokens", async () => {
    const amount = WAD.mul(2);
    const expectedAmount = amount
      .mul(5)
      .mul(PERCENTAGE_FACTOR - fee)
      .div(PERCENTAGE_FACTOR)
      .mul(PERCENTAGE_FACTOR - fee)
      .div(PERCENTAGE_FACTOR);

    await feeToken.transfer(user.address, amount);
    await feeToken.connect(user).approve(poolService.address, MAX_INT);

    const leverageActions = await ts.coreDeployer.getLeveragedActions();

    const yearnArtifact = (await ethers.getContractFactory(
      "YearnMock"
    )) as YearnMock__factory;

    const yVault = await yearnArtifact.deploy(feeToken.address);
    await yVault.deployed();

    const adapter = await ts.integrationsDeployer.getYearnAdapter(
      yVault.address
    );

    const priceFeed = await ts.priceOracle.priceFeeds(feeToken.address);

    const yPriceFeed = await integrationsDeployer.getYearnPriceFeed(
      yVault.address,
      priceFeed
    );

    await ts.priceOracle.addPriceFeed(yVault.address, yPriceFeed.address);

    await ts.creditFilter.allowToken(yVault.address, 9000);

    await ts.creditFilter.allowContract(yVault.address, adapter.address);

    await feeToken.connect(user).approve(leverageActions.address, MAX_INT);
    await creditFilter.approveAccountTransfers(leverageActions.address, true);

    await creditFilter
      .connect(user)
      .approveAccountTransfers(leverageActions.address, true);

    await leverageActions
      .connect(user)
      .openLP(
        ts.creditManager.address,
        400,
        amount,
        AdapterInterface.YearnV2,
        yVault.address,
        0,
        0
      );

    const creditAccount = await creditManager.getCreditAccountOrRevert(
      user.address
    );

    expect(await yVault.balanceOf(creditAccount)).to.be.eq(expectedAmount);
  });

  it("[FT-3]: LeveragedActions.openLong works correct with fee tokens", async () => {
    const rate = 10;
    const amount = WAD.mul(2);
    const expectedAmount = amount
      .mul(5)
      .mul(PERCENTAGE_FACTOR - fee)
      .div(PERCENTAGE_FACTOR)
      .mul(PERCENTAGE_FACTOR - fee)
      .div(PERCENTAGE_FACTOR)
      .mul(rate)
      .mul(997)
      .div(1000);

    await feeToken.transfer(user.address, amount);
    await feeToken.connect(user).approve(poolService.address, MAX_INT);

    const leverageActions = await ts.coreDeployer.getLeveragedActions();

    const uniMock = await integrationsDeployer.getUniswapMock();
    const uniAdapter = await integrationsDeployer.getUniswapV2Adapter(
      uniMock.address
    );

    await uniMock.setRate(feeToken.address, ts.tokenA.address, RAY.mul(rate));

    await tokenA.transfer(uniMock.address, amount.mul(100));

    await ts.creditFilter.allowContract(uniMock.address, uniAdapter.address);

    await feeToken.connect(user).approve(leverageActions.address, MAX_INT);

    const currentBlockchainTime = await ethers.provider.getBlock("latest");

    const calldata =
      IUniswapV2Router02__factory.createInterface().encodeFunctionData(
        "swapExactTokensForTokens",
        [
          amount,
          amount.mul(rate).mul(997).div(1000),
          [feeToken.address, tokenA.address],
          deployer.address,
          currentBlockchainTime.timestamp + 3600,
        ]
      );

    await creditFilter
      .connect(user)
      .approveAccountTransfers(leverageActions.address, true);

    await leverageActions.connect(user).openLong(
      amount,
      {
        creditManager: ts.creditManager.address,
        leverageFactor: 400,
        swapInterface: AdapterInterface.UniswapV2,
        swapContract: uniMock.address,
        swapCalldata: "0x" + calldata.substr(10),
        lpInterface: AdapterInterface.NoSwap,
        lpContract: ADDRESS_0x0,
        amountOutMin: 0,
      },
      0
    );

    const creditAccount = await creditManager.getCreditAccountOrRevert(
      user.address
    );

    expect(await tokenA.balanceOf(creditAccount)).to.be.eq(expectedAmount);
  });
});

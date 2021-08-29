/*
 * SPDX-License-Identifier: BSL-1.1
 * Gearbox. Generalized leverage protocol, which allows to take leverage and then use it across other DeFi protocols and platforms in a composable way.
 * (c) Gearbox.fi, 2021
 */

import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";

import {
  CreditFilterMock,
  CreditManager,
  DieselToken,
  ERC20__factory,
  Errors,
  IUniswapV2Router02__factory,
  IYVault__factory,
  MockPoolService,
  TokenMock,
  YearnAdapter,
} from "../../types/ethers-v5";
import { CoreDeployer } from "../../deployer/coreDeployer";
import { PoolDeployer } from "../../deployer/poolDeployer";
import { IntegrationsDeployer } from "../../deployer/integrationsDeployer";
import { TestDeployer } from "../../deployer/testDeployer";
import { CreditManagerTestSuite } from "../../deployer/creditManagerTestSuite";
import { tokenDataByNetwork } from "../../core/token";
import {
  MAX_INT,
  UNDERLYING_TOKEN_LIQUIDATION_THRESHOLD,
  WAD,
} from "@diesellabs/gearbox-sdk";
import { UNISWAP_V2_ROUTER_ADDRESS, WETH_TOKEN } from "./helper";

const yVault = "0xdA816459F1AB5631232FE5e97a05BBBb94970c95";
const yToken = tokenDataByNetwork.Mainnet.DAI.address;
const yTokenPriceFeed = tokenDataByNetwork.Mainnet.DAI.priceFeed;

describe("Yearn Integration test", function () {
  this.timeout(0);

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
  let yAdapter: YearnAdapter;

  before(async () => {
    const ts = new CreditManagerTestSuite({
      coreConfig: {
        weth: WETH_TOKEN,
      },
      showLogs: true,
    });
    await ts.getSuite();
    await ts.setupCreditManager();


    deployer = ts.deployer;
    coreDeployer = ts.coreDeployer;
    integrationsDeployer = ts.integrationsDeployer;
    poolDeployer = ts.poolDeployer;
    testDeployer = ts.testDeployer;

    creditManager = ts.creditManager as CreditManager;

    liquidityProvider = ts.liquidityProvider;
    user = ts.user;
    liquidator = ts.liquidator;
    friend = ts.friend;

    dieselToken = ts.dieselToken;
    underlyingToken = ts.underlyingToken;
    tokenA = ts.tokenA;
    errors = ts.errors;

    const receiptA = await ts.creditFilter.allowToken(
      yToken,
      UNDERLYING_TOKEN_LIQUIDATION_THRESHOLD
    );

    await receiptA.wait();

    const receiptB = await ts.creditFilter.allowToken(
      yVault,
      UNDERLYING_TOKEN_LIQUIDATION_THRESHOLD
    );

    await receiptB.wait();

    const receipt1 = await ts.priceOracle.addPriceFeed(yToken, yTokenPriceFeed);
    await receipt1.wait();

    const yVaultPriceFeed = await integrationsDeployer.getYearnPriceFeed(
      yVault,
      yTokenPriceFeed
    );

    await ts.priceOracle.addPriceFeed(yVault, yVaultPriceFeed.address);

    yAdapter = await ts.integrationsDeployer.getYearnAdapter(yVault);
    await ts.openDefaultCreditAccount();

    const wethToken = await coreDeployer.getWethTokenAddress();

    const uniswapV2 = IUniswapV2Router02__factory.connect(
      UNISWAP_V2_ROUTER_ADDRESS,
      deployer
    );

    await deployer.sendTransaction({ to: wethToken, value: WAD });

    const wethTokenC = ERC20__factory.connect(wethToken, deployer);
    const receipt2 = await wethTokenC.approve(
      UNISWAP_V2_ROUTER_ADDRESS,
      MAX_INT
    );
    await receipt2.wait();

    const receipt3 = await uniswapV2
      .connect(deployer)
      .swapExactTokensForTokens(
        WAD,
        0,
        [wethToken, yToken],
        deployer.address,
        Math.floor(Date.now()/1000 + 24*3600),
        { gasLimit: 3000000 }
      );

    await receipt3.wait();

    const daiTokenC = ERC20__factory.connect(yToken, deployer);
    const receipt4 = await daiTokenC.approve(creditManager.address, MAX_INT);
    await receipt4.wait();

    const receipt5 = await creditManager.addCollateral(
      user.address,
      yToken,
      await daiTokenC.balanceOf(deployer.address)
    );

    await receipt5.wait();
  });

  it("[Yearn]: openCreditAccount transfers correct total amount of tokens to new credit account", async function () {
    // Open default credit account
    const receipt1 = await yAdapter
      .connect(user)
      .depositAll({ gasLimit: 3000000 });
    await receipt1.wait();

    const creditAccount = await creditManager.getCreditAccountOrRevert(
      user.address
    );
    const yVaultTolenC = ERC20__factory.connect(yVault, deployer);
    console.log((await yVaultTolenC.balanceOf(creditAccount)).toString());
  });
});

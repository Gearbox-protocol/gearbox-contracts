// @ts-ignore
import { ethers } from "hardhat";
import { expect } from "../utils/expect";

import {
  CreditAccount,
  CreditFilter,
  CreditFilterMock,
  CreditManagerMockForFilter,
  Errors,
  IPriceOracle,
  TokenMock,
} from "../types/ethers-v5";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { PoolDeployer } from "../deployer/poolDeployer";
import { TestDeployer } from "../deployer/testDeployer";
import {
  CHI_THRESHOLD_DEFAULT,
  DEFAULT_CREDIT_MANAGER,
  DUMB_ADDRESS,
  DUMB_ADDRESS2,
  HF_CHECK_INTERVAL_DEFAULT,
  UNDERLYING_TOKEN_LIQUIDATION_THRESHOLD,
} from "../core/constants";
import { CreditManagerDeployer } from "../deployer/creditManagerDeployer";
import { CreditManagerTestSuite } from "../deployer/creditManagerTestSuite";
import { BigNumber } from "ethers";
import {
  ADDRESS_0x0,
  MAX_INT,
  PERCENTAGE_FACTOR,
  RAY,
  WAD,
} from "@diesellabs/gearbox-sdk";
import { PoolTestSuite } from "../deployer/poolTestSuite";

const { amount, borrowedAmount } = CreditManagerTestSuite;

describe("CreditFilter", function () {
  this.timeout(0);

  let ts: CreditManagerTestSuite;
  let deployer: SignerWithAddress;
  let user: SignerWithAddress;
  let friend: SignerWithAddress;
  let poolDeployer: PoolDeployer;
  let creditManagerDeployer: CreditManagerDeployer;
  let testDeployer: TestDeployer;
  let creditFilter: CreditFilterMock;
  let priceOracle: IPriceOracle;
  let tokenA: TokenMock;
  let underlyingToken: TokenMock;
  let creditManagerMockForFilter: CreditManagerMockForFilter;
  let errors: Errors;

  beforeEach(async () => {
    ts = new CreditManagerTestSuite();
    await ts.getSuite();

    creditManagerDeployer = new CreditManagerDeployer({
      config: {
        ...DEFAULT_CREDIT_MANAGER,
        allowedTokens: [],
        uniswapAddress: (await ts.integrationsDeployer.getUniswapMock())
          .address,
      },
      coreDeployer: ts.coreDeployer,
      poolService: ts.poolService,
    });

    deployer = ts.deployer;
    user = ts.user;
    friend = ts.friend;
    poolDeployer = ts.poolDeployer;
    // creditManagerDeployer = ts.creditManagerDeployer;
    creditFilter = (await creditManagerDeployer.getCreditFilter(
      true
    )) as unknown as CreditFilterMock;
    priceOracle = ts.priceOracle;
    testDeployer = ts.testDeployer;
    tokenA = ts.tokenA;
    underlyingToken = ts.underlyingToken;
    errors = ts.errors;
    creditManagerMockForFilter =
      await ts.testDeployer.getCreditManagerMockForFilter();
  });

  const setupChainlinkMock = async () => {
    const chainlinkMock = await ts.testDeployer.getChainlinkPriceFeedMock(
      BigNumber.from(1).mul(WAD)
    );

    await priceOracle.addPriceFeed(
      underlyingToken.address,
      chainlinkMock.address
    );

    await priceOracle.addPriceFeed(tokenA.address, chainlinkMock.address);
    return chainlinkMock;
  };

  const setupCreditAccount = async (): Promise<CreditAccount> => {
    const creditAccount = await ts.testDeployer.getCreditAccount();
    await creditAccount.initialize();
    await creditAccount.connectTo(deployer.address, borrowedAmount, RAY);
    await underlyingToken.transfer(
      creditAccount.address,
      amount.add(borrowedAmount)
    );
    return creditAccount;
  };

  it("[CF-1]: allowToken, allowContract, setupFastCheckParameters, connectCreditManager reverts for all non configurator calls", async () => {
    const revertMsg = await errors.ACL_CALLER_NOT_CONFIGURATOR();

    await expect(
      creditFilter
        .connect(user)
        .allowToken(tokenA.address, UNDERLYING_TOKEN_LIQUIDATION_THRESHOLD)
    ).to.be.revertedWith(revertMsg);

    await expect(
      creditFilter.connect(user).allowContract(tokenA.address, DUMB_ADDRESS)
    ).to.be.revertedWith(revertMsg);

    await expect(
      creditFilter.connect(user).setFastCheckParameters(100, 100)
    ).to.be.revertedWith(revertMsg);

    await expect(
      creditFilter.connect(user).forbidContract(DUMB_ADDRESS)
    ).to.be.revertedWith(revertMsg);

    await expect(
      creditFilter.connect(user).forbidToken(DUMB_ADDRESS)
    ).to.be.revertedWith(revertMsg);

    await expect(
      creditFilter.connect(user).connectCreditManager(DUMB_ADDRESS)
    ).to.be.revertedWith(revertMsg);

    await expect(
      creditFilter.connect(user).allowPlugin(DUMB_ADDRESS, true)
    ).to.be.revertedWith(revertMsg);
  });

  it("[CF-2]: allowToken, forbidToken reverts to add token with zero addresses", async () => {
    const revertMsg = await errors.ZERO_ADDRESS_IS_NOT_ALLOWED();
    await expect(
      creditFilter.allowToken(
        ADDRESS_0x0,
        UNDERLYING_TOKEN_LIQUIDATION_THRESHOLD
      )
    ).to.be.revertedWith(revertMsg);

    await expect(
      creditFilter.allowContract(ADDRESS_0x0, DUMB_ADDRESS)
    ).to.be.revertedWith(revertMsg);

    await expect(
      creditFilter.allowContract(DUMB_ADDRESS, ADDRESS_0x0)
    ).to.be.revertedWith(revertMsg);

    await expect(creditFilter.forbidContract(ADDRESS_0x0)).to.be.revertedWith(
      revertMsg
    );
  });

  it("[CF-3]: allowToken reverts for incorrect liquidation threshold", async () => {
    const revertMsg = await errors.CF_INCORRECT_LIQUIDATION_THRESHOLD();
    await expect(
      creditFilter.allowToken(
        tokenA.address,
        UNDERLYING_TOKEN_LIQUIDATION_THRESHOLD + 1
      )
    ).to.be.revertedWith(revertMsg);
    await expect(creditFilter.allowToken(tokenA.address, 0)).to.be.revertedWith(
      revertMsg
    );
  });

  it("[CF-4]: allowToken correctly adds one token to list and emits TokenAllowedEvent", async () => {
    expect(await creditFilter.allowedTokensCount()).to.be.eq(1);
    expect(await creditFilter.allowedTokens(0)).to.be.hexEqual(
      underlyingToken.address
    );

    const liquidationThreshold = UNDERLYING_TOKEN_LIQUIDATION_THRESHOLD - 100;

    await setupChainlinkMock();

    await expect(creditFilter.allowToken(tokenA.address, liquidationThreshold))
      .to.emit(creditFilter, "TokenAllowed")
      .withArgs(tokenA.address, liquidationThreshold);

    expect(await creditFilter.allowedTokensCount()).to.be.eq(2);
    expect(await creditFilter.allowedTokens(1)).to.be.hexEqual(tokenA.address);
    expect(await creditFilter.liquidationThresholds(tokenA.address)).to.be.eq(
      liquidationThreshold
    );
    expect(await creditFilter.tokenMasksMap(underlyingToken.address)).to.be.eq(
      1 << 0
    );
    expect(await creditFilter.tokenMasksMap(tokenA.address)).to.be.eq(1 << 1);
  });

  it("[CF-5]: allowToken reverts to add more than 256 tokens, but could change liquidation threshold", async () => {
    const revertMsg = await errors.CF_TOO_MUCH_ALLOWED_TOKENS();

    const liquidationThreshold = UNDERLYING_TOKEN_LIQUIDATION_THRESHOLD - 100;

    const jobs: Array<Promise<void>> = [];

    const chainlinkMock = await setupChainlinkMock();

    for (let i = 1; i < 256; i++) {
      const deployTokenAndAllow = new Promise<void>(async (resolve) => {
        const token = await ts.testDeployer.getTokenMock("name", "symbol");
        const receipt = await ts.priceOracle.addPriceFeed(
          token.address,
          chainlinkMock.address
        );
        await receipt.wait();
        const receipt2 = await creditFilter.allowToken(
          token.address,
          liquidationThreshold
        );
        await receipt2.wait();
        resolve();
      });
      jobs.push(deployTokenAndAllow);
    }

    await Promise.all(jobs);

    const throwToken = await ts.testDeployer.getTokenMock("name", "symbol");
    await priceOracle.addPriceFeed(throwToken.address, chainlinkMock.address);
    await expect(
      creditFilter.allowToken(throwToken.address, liquidationThreshold)
    ).to.be.revertedWith(revertMsg);

    await creditFilter.allowToken(underlyingToken.address, 10);
    expect(
      await creditFilter.liquidationThresholds(underlyingToken.address)
    ).to.be.eq(10);
  });

  it("[CF-6]: allowToken just update liquidation threshold if called twice", async () => {
    expect(await creditFilter.allowedTokensCount()).to.be.eq(1);
    expect(await creditFilter.allowedTokens(0)).to.be.hexEqual(
      underlyingToken.address
    );

    await setupChainlinkMock();

    const liquidationThreshold = UNDERLYING_TOKEN_LIQUIDATION_THRESHOLD - 100;

    await creditFilter.allowToken(tokenA.address, liquidationThreshold);

    const liquidationThreshold2 = UNDERLYING_TOKEN_LIQUIDATION_THRESHOLD - 500;
    await creditFilter.allowToken(tokenA.address, liquidationThreshold2);

    expect(await creditFilter.allowedTokensCount()).to.be.eq(2);
    expect(await creditFilter.liquidationThresholds(tokenA.address)).to.be.eq(
      liquidationThreshold2
    );
  });

  it("[CF-7]: revertIfTokenNotAllowed reverts if token is not allowed", async () => {
    const revertMsg = await errors.CF_TOKEN_IS_NOT_ALLOWED();
    await expect(
      creditFilter.revertIfTokenNotAllowed(DUMB_ADDRESS)
    ).to.be.revertedWith(revertMsg);
  });

  it("[CF-8]: constructor adds underlying token to allowed list with UNDERLYING_TOKEN_LIQUIDATION_THRESHOLD", async () => {
    const underlyingTokenAddress =
      await poolDeployer.getUnderlyingTokenAddress();
    expect(await creditFilter.allowedTokensCount()).to.be.eq(1);
    expect(await creditFilter.allowedTokens(0)).to.be.hexEqual(
      underlyingTokenAddress
    );

    // Check that contract doesn't revert on underlying token asset
    await creditFilter.revertIfTokenNotAllowed(underlyingTokenAddress);
    expect(
      await creditFilter.liquidationThresholds(underlyingTokenAddress)
    ).to.be.eq(UNDERLYING_TOKEN_LIQUIDATION_THRESHOLD);
  });

  it("[CF-9]: allowContract adds new contract to array it called once", async () => {
    expect(await creditFilter.allowedContractsCount()).to.be.eq(0);
    await creditFilter.allowContract(DUMB_ADDRESS, deployer.address);
    expect(await creditFilter.allowedContractsCount()).to.be.eq(1);
    expect(await creditFilter.allowedContracts(0)).to.be.eq(DUMB_ADDRESS);
    expect(await creditFilter.contractToAdapter(DUMB_ADDRESS)).to.be.eq(
      deployer.address
    );
    // await creditFilter.revertIfAdapterNotAllowed(deployer.address);
  });

  it("[CF-10]: allowContract doesn't add contract to array if called twice and update adapter address and remove previous from allowed list", async () => {
    const revertMsg = await errors.CF_ADAPTERS_ONLY();

    expect(await creditFilter.allowedContractsCount()).to.be.eq(0);
    await creditFilter.allowContract(DUMB_ADDRESS, deployer.address);
    await creditFilter.allowContract(DUMB_ADDRESS, user.address);
    expect(await creditFilter.allowedContractsCount()).to.be.eq(1);
    expect(await creditFilter.allowedContracts(0)).to.be.eq(DUMB_ADDRESS);
    expect(await creditFilter.contractToAdapter(DUMB_ADDRESS)).to.be.eq(
      user.address
    );
  });

  it("[CF-11]: allowToken reverts if token has no balanceOf method", async () => {
    // creditFilter.address is taken as contract without fallback function and balanceOf functions
    await expect(
      creditFilter.allowToken(creditFilter.address, 100)
    ).to.be.revertedWith(
      "function selector was not recognized and there's no fallback function"
    );
  });

  it("[CF-12]: allowContract emits ContractAllowed event", async () => {
    await expect(creditFilter.allowContract(DUMB_ADDRESS, user.address))
      .to.emit(creditFilter, "ContractAllowed")
      .withArgs(DUMB_ADDRESS, user.address);
  });

  it("[CF-13]: connectCreditManager can be called only once", async () => {
    const revertMsg = await errors.CF_CREDIT_MANAGER_IS_ALREADY_SET();

    const creditManager = await creditManagerDeployer.getCreditManager();

    await expect(
      creditFilter.connectCreditManager(creditManager.address)
    ).to.be.revertedWith(revertMsg);
  });

  it("[CF-14]: connectCreditManager correctly connects if all price feeds are provided", async () => {
    await setupChainlinkMock();
    await creditFilter.allowToken(
      tokenA.address,
      UNDERLYING_TOKEN_LIQUIDATION_THRESHOLD
    );
    const underlyingToken = await poolDeployer.getUnderlyingToken();

    // set price oracle to "oracle"
    await priceOracle.addPriceFeed(
      underlyingToken.address,
      (
        await creditManagerDeployer.getUnderlyingPriceFeedMock(100)
      ).address
    );
    await priceOracle.addPriceFeed(
      tokenA.address,
      (
        await creditManagerDeployer.getUnderlyingPriceFeedMock(100)
      ).address
    );

    const creditManager = await creditManagerDeployer.getCreditManager();
    expect(await creditFilter.creditManager()).to.be.eq(creditManager.address);

    expect(await creditFilter.poolService()).to.be.eq(
      await creditManager.poolService()
    );
  });

  it("[CF-15]: allowToken reverts if token has no price feed", async () => {
    const revertMsg = await errors.PO_PRICE_FEED_DOESNT_EXIST();

    await setupChainlinkMock();

    await expect(
      creditFilter.allowToken(ts.tokenForbidden.address, 100)
    ).to.be.revertedWith(revertMsg);
  });

  it("[CF-16]: connectCreditManager reverts if different underlying token provided", async () => {
    const revertMsg = await errors.CF_UNDERLYING_TOKEN_FILTER_CONFLICT();

    await expect(
      creditFilter.connectCreditManager(creditManagerMockForFilter.address)
    ).to.be.revertedWith(revertMsg);
  });

  it("[CF-17]: calcTotalValue computes total balance correctly", async () => {
    const underlyingToken = await poolDeployer.getUnderlyingToken();

    // set price oracle to "oracle"
    await priceOracle.addPriceFeed(
      underlyingToken.address,
      (
        await creditManagerDeployer.getUnderlyingPriceFeedMock(WAD)
      ).address
    );

    const initBalance = 1000;
    await underlyingToken.mint(friend.address, initBalance);

    expect(await underlyingToken.balanceOf(friend.address)).to.be.eq(
      initBalance
    );

    const tokenA = await testDeployer.getTokenMock("TokenA", "AAA");
    const tokenB = await testDeployer.getTokenMock("TokenB", "BBB");
    const tokenC = await testDeployer.getTokenMock("TokenC", "CCC");
    const chainlinkMockAETH = await testDeployer.getChainlinkPriceFeedMock(
      WAD.mul(123)
    );

    const chainlinkMockBETH = await testDeployer.getChainlinkPriceFeedMock(
      WAD.div(1000).mul(456)
    );

    const chainlinkMockCETH = await testDeployer.getChainlinkPriceFeedMock(
      WAD.div(1000000).mul(789)
    );

    await priceOracle.addPriceFeed(tokenA.address, chainlinkMockAETH.address);
    await priceOracle.addPriceFeed(tokenB.address, chainlinkMockBETH.address);
    await priceOracle.addPriceFeed(tokenC.address, chainlinkMockCETH.address);

    await tokenA.mint(friend.address, 1e10);
    await tokenB.mint(friend.address, 1e10);
    await tokenC.mint(friend.address, 1e10);

    await creditFilter.allowToken(
      tokenA.address,
      UNDERLYING_TOKEN_LIQUIDATION_THRESHOLD
    );
    await creditFilter.allowToken(tokenB.address, PERCENTAGE_FACTOR / 2);
    await creditFilter.allowToken(tokenC.address, PERCENTAGE_FACTOR / 4);

    expect(await creditFilter.calcTotalValue(friend.address)).to.be.eq(
      BigNumber.from(0)
    );

    await creditFilter.setEnabledTokens(friend.address, 1);

    expect(await creditFilter.calcTotalValue(friend.address)).to.be.eq(
      BigNumber.from(1000)
    );

    await creditFilter.setEnabledTokens(friend.address, MAX_INT);
    expect(await creditFilter.calcTotalValue(friend.address)).to.be.eq(
      BigNumber.from("1234567891000")
    );
  });

  it("[CF-18]: calcThresholdWeightedTotalValue computes liquidation balance correctly", async () => {
    const wethToken = await ts.coreDeployer.getWETHMock();

    const underlyingToken = await poolDeployer.getUnderlyingToken();

    // set price oracle to "oracle"
    await priceOracle.addPriceFeed(
      underlyingToken.address,
      (
        await creditManagerDeployer.getUnderlyingPriceFeedMock(WAD)
      ).address
    );

    const initBalance = 1000;
    await underlyingToken.mint(friend.address, initBalance);

    const tokenA = await testDeployer.getTokenMock("TokenA", "AAA");
    const tokenB = await testDeployer.getTokenMock("TokenB", "BBB");
    const tokenC = await testDeployer.getTokenMock("TokenC", "CCC");

    // tokenA has liquidationThreshold = 100%
    const chainlinkMockAETH = await testDeployer.getChainlinkPriceFeedMock(
      WAD.mul(123 * 2)
    );

    // tokenB has liquidationThreshold = 50%, we multiply it x2 to get the same result
    const chainlinkMockBETH = await testDeployer.getChainlinkPriceFeedMock(
      WAD.div(1000).mul(456 * 4)
    );

    // tokenC has liquidationThreshold = 25%, we multiply it x4 to get the same result
    const chainlinkMockCETH = await testDeployer.getChainlinkPriceFeedMock(
      WAD.div(1000000).mul(789 * 8)
    );

    await priceOracle.addPriceFeed(tokenA.address, chainlinkMockAETH.address);
    await priceOracle.addPriceFeed(tokenB.address, chainlinkMockBETH.address);
    await priceOracle.addPriceFeed(tokenC.address, chainlinkMockCETH.address);

    await tokenA.mint(friend.address, 1e10);
    await tokenB.mint(friend.address, 1e10);
    await tokenC.mint(friend.address, 1e10);

    await creditFilter.allowToken(tokenA.address, PERCENTAGE_FACTOR / 2);
    await creditFilter.allowToken(tokenB.address, PERCENTAGE_FACTOR / 4);
    await creditFilter.allowToken(tokenC.address, PERCENTAGE_FACTOR / 8);

    const initBalanceWeighted = BigNumber.from(initBalance)
      .mul(UNDERLYING_TOKEN_LIQUIDATION_THRESHOLD)
      .div(PERCENTAGE_FACTOR);

    expect(
      await creditFilter.calcThresholdWeightedValue(friend.address)
    ).to.be.eq(BigNumber.from(0));

    await creditFilter.setEnabledTokens(friend.address, 1);

    expect(
      await creditFilter.calcThresholdWeightedValue(friend.address)
    ).to.be.eq(BigNumber.from(initBalanceWeighted));

    await creditFilter.setEnabledTokens(friend.address, MAX_INT);

    expect(
      await creditFilter.calcThresholdWeightedValue(friend.address)
    ).to.be.eq(BigNumber.from("1234567890000").add(initBalanceWeighted));
  });

  it("[CF-18]: [Random test] calcTotalBalanceConverted computes total balance correctly", async () => {
    await creditFilter.setEnabledTokens(friend.address, MAX_INT);

    await priceOracle.addPriceFeed(
      underlyingToken.address,
      (
        await creditManagerDeployer.getUnderlyingPriceFeedMock(WAD)
      ).address
    );

    const initBalance = 1000;
    await underlyingToken.mint(friend.address, initBalance);

    let totalValue = BigNumber.from(initBalance);
    let twv = BigNumber.from(
      BigNumber.from(initBalance)
        .mul(UNDERLYING_TOKEN_LIQUIDATION_THRESHOLD)
        .div(PERCENTAGE_FACTOR)
    );

    for (let i = 0; i < 20; i++) {
      const token = await testDeployer.getTokenMock(`Token_${i}`, `${i}`);

      const price = Math.floor(Math.random() * 1e6); // [0;1e6]
      const balance = Math.floor(Math.random() * 1e6); // [0;1e6]

      const priceBN = WAD.div(1000).mul(price);
      const balanceBN = WAD.div(1000).mul(balance);

      const liquidationThreshold = Math.floor(
        Math.random() * UNDERLYING_TOKEN_LIQUIDATION_THRESHOLD
      );

      const chainlinkMock = await testDeployer.getChainlinkPriceFeedMock(
        priceBN
      );
      await priceOracle.addPriceFeed(token.address, chainlinkMock.address);
      await token.mint(friend.address, balanceBN);

      await creditFilter.allowToken(token.address, liquidationThreshold);
      totalValue = totalValue.add(priceBN.mul(balanceBN).div(WAD));
      twv = twv.add(
        priceBN
          .mul(balanceBN)
          .mul(liquidationThreshold)
          .div(WAD)
          .div(PERCENTAGE_FACTOR)
      );
      expect(await creditFilter.calcTotalValue(friend.address)).to.be.eq(
        totalValue
      );
      expect(
        await creditFilter.calcThresholdWeightedValue(friend.address)
      ).to.be.eq(twv);
    }
  });

  it("[CF-19]: initEnabledTokens set enabled tokens to 1 and fastCheckCounter to 1", async () => {
    await creditManagerMockForFilter.connectFilter(
      creditFilter.address,
      underlyingToken.address
    );

    await creditFilter.connectCreditManager(creditManagerMockForFilter.address);

    await creditFilter.setEnabledTokens(DUMB_ADDRESS, 100);
    expect(await creditFilter.enabledTokens(DUMB_ADDRESS)).to.be.eq(100);
    await creditManagerMockForFilter.initEnabledTokens(DUMB_ADDRESS);
    expect(await creditFilter.enabledTokens(DUMB_ADDRESS)).to.be.eq(1);
    expect(await creditFilter.fastCheckCounter(DUMB_ADDRESS)).to.be.eq(1);
  });

  it("[CF-20]: checkCollateralChange, initEnabledTokens, checkAndEnableToken reverts if called non-creditManager computes correctly", async () => {
    const revertMsgCM = await errors.CF_CREDIT_MANAGERS_ONLY();
    const revertMsgAdapter = await errors.CF_ADAPTERS_ONLY();

    await expect(
      creditFilter.checkCollateralChange(
        DUMB_ADDRESS,
        DUMB_ADDRESS,
        DUMB_ADDRESS,
        1,
        1
      ),
      "checkCollateralChange"
    ).to.be.revertedWith(revertMsgAdapter);

    await expect(
      creditFilter.checkMultiTokenCollateral(
        DUMB_ADDRESS,
        [],
        [],
        [DUMB_ADDRESS],
        [DUMB_ADDRESS]
      ),
      "checkMultiTokenCollateral"
    ).to.be.revertedWith(revertMsgAdapter);

    await expect(
      creditFilter.initEnabledTokens(DUMB_ADDRESS),
      "initEnabledTokens"
    ).to.be.revertedWith(revertMsgCM);

    await expect(
      creditFilter.checkAndEnableToken(DUMB_ADDRESS, DUMB_ADDRESS),
      "checkAndEnableToken"
    ).to.be.revertedWith(revertMsgCM);

    await expect(
      creditFilter.updateUnderlyingTokenLiquidationThreshold(),
      "updateUnderlyingTokenLiquidationThreshold"
    ).to.be.revertedWith(revertMsgCM);
  });
  //
  it("[CF-21]: constructor sets initial parameters correctly", async () => {
    const addressProvider = await ts.coreDeployer.getAddressProvider();

    expect(await creditFilter.priceOracle(), "PriceOracle").to.be.eq(
      await addressProvider.getPriceOracle()
    );

    expect(await creditFilter.wethAddress(), "Weth address").to.be.eq(
      await addressProvider.getWethToken()
    );

    expect(await creditFilter.underlyingToken(), "Underlying token").to.be.eq(
      await ts.poolService.underlyingToken()
    );

    expect(await creditFilter.chiThreshold(), "Chi threshold").to.be.eq(
      CHI_THRESHOLD_DEFAULT
    );

    expect(
      await creditFilter.hfCheckInterval(),
      "Hf check intervals default"
    ).to.be.eq(HF_CHECK_INTERVAL_DEFAULT);

    expect(
      await creditFilter.liquidationThresholds(underlyingToken.address),
      "Liquidation threshold for underlying token"
    ).to.be.eq(UNDERLYING_TOKEN_LIQUIDATION_THRESHOLD);
  });

  it("[CF-22]: checkCollateralChange and checkAndEnableToken reverts if tokenOut is not allowed", async () => {
    const revertMsg = await errors.CF_TOKEN_IS_NOT_ALLOWED();

    await creditManagerMockForFilter.connectFilter(
      creditFilter.address,
      underlyingToken.address
    );

    await creditFilter.connectCreditManager(creditManagerMockForFilter.address);

    await creditFilter.allowContract(
      DUMB_ADDRESS,
      creditManagerMockForFilter.address
    );

    await creditFilter.allowToken(underlyingToken.address, 160);

    await expect(
      creditManagerMockForFilter.checkCollateralChange(
        DUMB_ADDRESS,
        underlyingToken.address,
        DUMB_ADDRESS,
        1,
        1
      )
    ).to.be.revertedWith(revertMsg);

    await expect(
      creditManagerMockForFilter.checkAndEnableToken(DUMB_ADDRESS, DUMB_ADDRESS)
    ).to.be.revertedWith(revertMsg);
  });

  it("[CF-23]: checkAndEnableToken enables token", async () => {
    await creditManagerMockForFilter.connectFilter(
      creditFilter.address,
      underlyingToken.address
    );

    await creditFilter.allowContract(DUMB_ADDRESS, deployer.address);

    await priceOracle.addPriceFeed(
      underlyingToken.address,
      (
        await creditManagerDeployer.getUnderlyingPriceFeedMock(WAD)
      ).address
    );

    await priceOracle.addPriceFeed(
      tokenA.address,
      (
        await creditManagerDeployer.getUnderlyingPriceFeedMock(WAD)
      ).address
    );

    await creditFilter.allowToken(tokenA.address, 1000);

    expect(await creditFilter.enabledTokens(DUMB_ADDRESS)).to.be.eq(0);

    await creditFilter.connectCreditManager(creditManagerMockForFilter.address);

    await creditManagerMockForFilter.checkAndEnableToken(
      DUMB_ADDRESS,
      underlyingToken.address
    );

    expect(await creditFilter.enabledTokens(DUMB_ADDRESS)).to.be.eq(1);

    await creditManagerMockForFilter.checkAndEnableToken(
      DUMB_ADDRESS,
      tokenA.address
    );

    expect(await creditFilter.enabledTokens(DUMB_ADDRESS)).to.be.eq(3);
  });

  it("[CF-24]: checkCollateralChange enables tokenOut token and sets fastCheckBlock if chi >98%", async () => {
    await creditManagerMockForFilter.connectFilter(
      creditFilter.address,
      underlyingToken.address
    );

    await creditFilter.allowContract(DUMB_ADDRESS, deployer.address);

    await priceOracle.addPriceFeed(
      underlyingToken.address,
      (
        await creditManagerDeployer.getUnderlyingPriceFeedMock(WAD)
      ).address
    );

    await priceOracle.addPriceFeed(
      tokenA.address,
      (
        await creditManagerDeployer.getUnderlyingPriceFeedMock(WAD)
      ).address
    );

    await creditFilter.allowToken(tokenA.address, 1000);

    expect(await creditFilter.enabledTokens(DUMB_ADDRESS)).to.be.eq(0);

    await creditFilter.connectCreditManager(creditManagerMockForFilter.address);

    await creditManagerMockForFilter.initEnabledTokens(DUMB_ADDRESS);

    await creditFilter.checkCollateralChange(
      DUMB_ADDRESS,
      underlyingToken.address,
      tokenA.address,
      WAD.div(2),
      WAD.div(2)
    );

    expect(
      await creditFilter.enabledTokens(DUMB_ADDRESS),
      "Incorrect enabled tokens"
    ).to.be.eq(3); // two bits enable: 11
    expect(
      await creditFilter.fastCheckCounter(DUMB_ADDRESS),
      "Incorrect fastCheck delay"
    ).to.be.eq(2);
  });

  it("[CF-25]: checkCollateralChange reverts for non-fastcheck and Hf<1 after operation", async () => {
    const revertMsg = await errors.CF_OPERATION_LOW_HEALTH_FACTOR();

    await creditManagerMockForFilter.connectFilter(
      creditFilter.address,
      underlyingToken.address
    );
    await creditFilter.connectCreditManager(creditManagerMockForFilter.address);

    await creditManagerMockForFilter.setLinearCumulative(RAY);

    await creditFilter.allowContract(DUMB_ADDRESS, deployer.address);

    await priceOracle.addPriceFeed(
      underlyingToken.address,
      (
        await creditManagerDeployer.getUnderlyingPriceFeedMock(WAD)
      ).address
    );

    await priceOracle.addPriceFeed(
      tokenA.address,
      (
        await creditManagerDeployer.getUnderlyingPriceFeedMock(WAD)
      ).address
    );

    await creditFilter.allowToken(
      tokenA.address,
      UNDERLYING_TOKEN_LIQUIDATION_THRESHOLD - 1
    );

    expect(await creditFilter.enabledTokens(DUMB_ADDRESS)).to.be.eq(0);

    const creditAccount = await setupCreditAccount();

    await expect(
      creditFilter.checkCollateralChange(
        creditAccount.address,
        underlyingToken.address,
        tokenA.address,
        WAD.mul(CHI_THRESHOLD_DEFAULT).div(100).sub(1),
        WAD
      )
    ).to.be.revertedWith(revertMsg);
  });

  it("[CF-26]: calcCreditAccountAccruedInterested computes Account accrued interest correctly", async () => {
    const ciAtOpen = RAY;
    const ciAtClose = RAY.mul(2);

    await creditManagerMockForFilter.connectFilter(
      creditFilter.address,
      underlyingToken.address
    );
    await creditFilter.connectCreditManager(creditManagerMockForFilter.address);

    await creditManagerMockForFilter.setLinearCumulative(ciAtClose);

    const creditAccount = await ts.testDeployer.getCreditAccount();
    await creditAccount.initialize();
    await creditAccount.connectTo(deployer.address, borrowedAmount, ciAtOpen);

    expect(
      await creditFilter.calcCreditAccountAccruedInterest(creditAccount.address)
    ).to.be.eq(borrowedAmount.mul(2));
  });

  it("[CF-27]: calcCreditAccountHealthFactor computes health factor correct", async () => {
    const ciAtOpen = RAY;
    const ciAtClose = RAY.mul(2);

    await creditManagerMockForFilter.connectFilter(
      creditFilter.address,
      underlyingToken.address
    );
    await creditFilter.connectCreditManager(creditManagerMockForFilter.address);

    await creditManagerMockForFilter.setLinearCumulative(ciAtClose);

    const creditAccount = await ts.testDeployer.getCreditAccount();
    await creditAccount.initialize();
    await creditAccount.connectTo(deployer.address, borrowedAmount, ciAtOpen);
    await underlyingToken.transfer(
      creditAccount.address,
      amount.add(borrowedAmount)
    );

    await priceOracle.addPriceFeed(
      underlyingToken.address,
      (
        await creditManagerDeployer.getUnderlyingPriceFeedMock(WAD)
      ).address
    );

    const thresholdWeightedTotalValue = amount
      .add(borrowedAmount)
      .mul(UNDERLYING_TOKEN_LIQUIDATION_THRESHOLD)
      .div(PERCENTAGE_FACTOR);

    const calcBorrowedAmountWithInerest = borrowedAmount
      .mul(ciAtClose)
      .div(ciAtOpen);

    const expectedHealthFactor = thresholdWeightedTotalValue
      .mul(PERCENTAGE_FACTOR)
      .div(calcBorrowedAmountWithInerest);

    const healthFactor0 = await creditFilter.calcCreditAccountHealthFactor(
      creditAccount.address
    );

    expect(healthFactor0).to.be.eq(0);

    await creditFilter.setEnabledTokens(creditAccount.address, MAX_INT);

    const healthFactor = await creditFilter.calcCreditAccountHealthFactor(
      creditAccount.address
    );
    expect(healthFactor).to.be.eq(expectedHealthFactor);
  });

  it("[CF-28]: getCreditAccountTokenById returns correct token, amount, tv & twv", async () => {
    const chainlinkMock = await testDeployer.getChainlinkPriceFeedMock(
      BigNumber.from(10).mul(WAD),
      18
    );
    await priceOracle.addPriceFeed(
      underlyingToken.address,
      chainlinkMock.address
    );

    const [token, amount, tv, twv] =
      await creditFilter.getCreditAccountTokenById(DUMB_ADDRESS, 0);
    expect(token).to.be.eq(underlyingToken.address);
    expect(amount).to.be.eq(0);
    expect(tv).to.be.eq(0);
    expect(twv).to.be.eq(0);

    const testAmount = 1543;

    await underlyingToken.transfer(DUMB_ADDRESS, testAmount);
    const [token2, amount2, tv2, twv2] =
      await creditFilter.getCreditAccountTokenById(DUMB_ADDRESS, 0);
    expect(token2).to.be.eq(underlyingToken.address);
    expect(amount2).to.be.eq(testAmount);
    expect(tv2).to.be.eq(testAmount);
    expect(twv2).to.be.eq(testAmount * UNDERLYING_TOKEN_LIQUIDATION_THRESHOLD);

    // ToDo: Add one more token
  });

  it("[CF-30]: setupFastCheckParameters set parameters correctly and emits event", async () => {
    const newChi = (await creditFilter.chiThreshold()).toNumber() + 5;
    const newFastCheckDelay =
      (await creditFilter.hfCheckInterval()).toNumber() - 1;

    await expect(creditFilter.setFastCheckParameters(newChi, newFastCheckDelay))
      .to.emit(creditFilter, "NewFastCheckParameters")
      .withArgs(newChi, newFastCheckDelay);

    expect(await creditFilter.chiThreshold()).to.be.eq(newChi);
    expect(await creditFilter.hfCheckInterval()).to.be.eq(newFastCheckDelay);
  });

  it("[CF-31]: forbidContract reverts if contract is not in allowed list", async () => {
    const revertMsg = await errors.CF_CONTRACT_IS_NOT_IN_ALLOWED_LIST();
    await expect(creditFilter.forbidContract(DUMB_ADDRESS)).to.be.revertedWith(
      revertMsg
    );
  });

  it("[CF-32]: forbidContract removes adapter and contract from allowedContractsSet", async () => {
    const revertMsg = await errors.CF_CONTRACT_IS_NOT_IN_ALLOWED_LIST();

    const DUMB_ADAPTER = DUMB_ADDRESS;
    const DUMB_CONTRACT = DUMB_ADDRESS2;

    const len = await creditFilter.allowedContractsCount();
    await creditFilter.allowContract(DUMB_CONTRACT, DUMB_ADAPTER);

    expect(await creditFilter.allowedContractsCount()).to.be.eq(
      len.toNumber() + 1
    );
    expect(
      await creditFilter.allowedContracts(len),
      "target contracts wasn't added"
    ).to.be.eq(DUMB_CONTRACT);
    expect(
      await creditFilter.contractToAdapter(DUMB_CONTRACT),
      "contract adapter wasn't added"
    ).to.be.eq(DUMB_ADAPTER);

    expect(await creditFilter.allowedAdapters(DUMB_ADAPTER)).to.be.eq(true);

    //
    // FORBID
    //

    await expect(creditFilter.forbidContract(DUMB_CONTRACT))
      .to.emit(creditFilter, "ContractForbidden")
      .withArgs(DUMB_CONTRACT);

    expect(
      await creditFilter.allowedContractsCount(),
      "allowedContractCount wasn't updated"
    ).to.be.eq(len);
    expect(
      await creditFilter.allowedAdapters(DUMB_ADAPTER),
      "allowedAdapters wasn't disabled"
    ).to.be.eq(false);

    expect(
      await creditFilter.contractToAdapter(DUMB_CONTRACT),
      "contractToAdapter wasn't set to address(0)"
    ).to.be.eq(ADDRESS_0x0);
  });

  it("[CF-33]: checkMultiTokenCollateral enables all tokenOutTokens and use fastCheck", async () => {
    const tokenA = await testDeployer.getTokenMock("TokenA", "TTA");
    const tokenB = await testDeployer.getTokenMock("TokenA", "TTA");
    const tokenC = await testDeployer.getTokenMock("TokenA", "TTA");

    const chainlinkMock = await setupChainlinkMock();
    await priceOracle.addPriceFeed(tokenA.address, chainlinkMock.address);
    await priceOracle.addPriceFeed(tokenB.address, chainlinkMock.address);
    await priceOracle.addPriceFeed(tokenC.address, chainlinkMock.address);

    await creditFilter.allowToken(tokenA.address, 9000);
    await creditFilter.allowToken(tokenB.address, 9000);
    await creditFilter.allowToken(tokenC.address, 9000);

    const creditAccount = await setupCreditAccount();
    const fakeContract = DUMB_ADDRESS2;

    await creditFilter.allowContract(fakeContract, deployer.address);

    expect(await creditFilter.fastCheckCounter(creditAccount.address)).to.be.eq(
      0
    );

    await creditFilter.checkMultiTokenCollateral(
      creditAccount.address,

      [0],
      [1, 1],
      [tokenA.address],
      [tokenB.address, tokenC.address]
    );

    // expercted tokenMask
    // 1100 [tokenC][tokenB][tokenA][underlyingToken]
    // Underlying token is not enalbed cause we didn't call initEnableAccounts
    expect(await creditFilter.enabledTokens(creditAccount.address)).to.be.eq(
      parseInt("1100", 2)
    );

    expect(await creditFilter.fastCheckCounter(creditAccount.address)).to.be.eq(
      1
    );
    await creditFilter.checkMultiTokenCollateral(
      creditAccount.address,

      [0],
      [1, 1],
      [tokenA.address],
      [tokenB.address, tokenC.address]
    );
    expect(await creditFilter.fastCheckCounter(creditAccount.address)).to.be.eq(
      2
    );
  });

  it("[CF-34]: checkMultiTokenCollateral check fullHealthFactor if it doesn't pass fastCheck", async () => {
    const revertMsg = await errors.CF_OPERATION_LOW_HEALTH_FACTOR();
    await ts.usePoolMockForCreditManager();
    await ts.setupCreditManager();

    const tokenA = await testDeployer.getTokenMock("TokenA", "TTA");
    const tokenB = await testDeployer.getTokenMock("TokenB", "TTB");
    const tokenC = await testDeployer.getTokenMock("TokenC", "TTC");

    const chainlinkMock = await setupChainlinkMock();
    await ts.priceOracle.addPriceFeed(tokenA.address, chainlinkMock.address);
    await ts.priceOracle.addPriceFeed(tokenB.address, chainlinkMock.address);
    await ts.priceOracle.addPriceFeed(tokenC.address, chainlinkMock.address);

    await ts.creditFilter.allowToken(tokenA.address, 9000);
    await ts.creditFilter.allowToken(tokenB.address, 9000);
    await ts.creditFilter.allowToken(tokenC.address, 9000);

    const { addLiquidity } = PoolTestSuite;
    // Send my to be able for lending
    await underlyingToken
      .connect(ts.liquidityProvider)
      .transfer(ts.mockPoolService.address, addLiquidity);

    await ts.openDefaultCreditAccount();
    const creditAccount = await ts.creditManager.getCreditAccountOrRevert(
      user.address
    );
    const fakeContract = DUMB_ADDRESS2;
    await ts.creditFilter.allowContract(fakeContract, deployer.address);

    for (let i = 1; i < 3; i++) {
      await ts.creditFilter.checkMultiTokenCollateral(
        creditAccount,

        [0],
        [1, 1],
        [tokenA.address],
        [tokenB.address, tokenC.address]
      );
    }

    expect(
      await ts.creditFilter.fastCheckCounter(creditAccount),
      "fastCheckCounter"
    ).to.be.eq(3);

    await ts.creditFilter.checkMultiTokenCollateral(
      creditAccount,

      [1],
      [0, 0],
      [tokenA.address],
      [tokenB.address, tokenC.address]
    );

    expect(await ts.creditFilter.fastCheckCounter(creditAccount)).to.be.eq(1);
  });

  it("[CF-35]: forbid token updates state correctly", async () => {
    const tokenA = await testDeployer.getTokenMock("TokenA", "TTA");
    const tokenB = await testDeployer.getTokenMock("TokenB", "TTB");

    const chainlinkMock = await setupChainlinkMock();
    await priceOracle.addPriceFeed(tokenA.address, chainlinkMock.address);
    await priceOracle.addPriceFeed(tokenB.address, chainlinkMock.address);

    await creditFilter.allowToken(tokenA.address, 9000);
    await creditFilter.allowToken(tokenB.address, 9000);

    await creditFilter.forbidToken(tokenB.address);
    expect(await creditFilter.isTokenAllowed(tokenB.address)).to.be.false;
  });

  it("[CF-36]: checkAndEnableToken reverts if token forbidden", async () => {
    const revertMsg = await errors.CF_TOKEN_IS_NOT_ALLOWED();

    const tokenA = await testDeployer.getTokenMock("TokenA", "TTA");

    const chainlinkMock = await setupChainlinkMock();
    await priceOracle.addPriceFeed(tokenA.address, chainlinkMock.address);
    await creditFilter.allowToken(tokenA.address, 9000);

    await creditFilter.forbidToken(tokenA.address);

    await creditManagerMockForFilter.connectFilter(
      creditFilter.address,
      underlyingToken.address
    );
    await creditFilter.connectCreditManager(creditManagerMockForFilter.address);
    await expect(
      creditManagerMockForFilter.checkAndEnableToken(
        DUMB_ADDRESS,
        tokenA.address
      )
    ).to.be.revertedWith(revertMsg);
  });

  it("[CF-37]: calcMaxPossibleDrop calculates values correctly", async () => {
    const percentage = BigNumber.from(9841);
    const percentFactor = BigNumber.from(PERCENTAGE_FACTOR);
    const times = 5;
    const expected = percentFactor
      .mul(percentage) // 1
      .mul(percentage) // 2
      .div(percentFactor)
      .mul(percentage) // 3
      .div(percentFactor)
      .mul(percentage) // 4
      .div(percentFactor)
      .mul(percentage) // 5
      .div(percentFactor)
      .div(percentFactor);

    expect(await creditFilter.calcMaxPossibleDrop(percentage, times)).to.be.eq(
      expected
    );
  });

  it("[CF-38]: updateUnderlyingTokenLiquidationThreshold updates parameters correctly", async () => {
    await creditManagerMockForFilter.connectFilter(
      creditFilter.address,
      underlyingToken.address
    );
    await creditFilter.connectCreditManager(creditManagerMockForFilter.address);

    const liquidationDiscount = 9500;
    const feeLiquidation = 500;

    await creditManagerMockForFilter.setFeeLiquidation(feeLiquidation);
    await creditManagerMockForFilter.setLiquidationDiscount(
      liquidationDiscount
    );

    await creditManagerMockForFilter.updateUnderlyingTokenLiquidationThreshold();
    expect(
      await creditFilter.liquidationThresholds(underlyingToken.address)
    ).to.be.eq(liquidationDiscount - feeLiquidation);
  });

  it("[CF-39]: updateUnderlyingTokenLiquidationThreshold updates parameters correctly", async () => {
    const revertMsg =
      await errors.CF_SOME_LIQUIDATION_THRESHOLD_MORE_THAN_NEW_ONE();

    await creditManagerMockForFilter.connectFilter(
      creditFilter.address,
      underlyingToken.address
    );
    await creditFilter.connectCreditManager(creditManagerMockForFilter.address);

    const chainlinkMock = await setupChainlinkMock();
    await priceOracle.addPriceFeed(tokenA.address, chainlinkMock.address);
    await creditFilter.allowToken(
      tokenA.address,
      UNDERLYING_TOKEN_LIQUIDATION_THRESHOLD
    );

    const liquidationDiscount = 9500;
    const feeLiquidation = 500;

    await creditManagerMockForFilter.setFeeLiquidation(feeLiquidation);
    await creditManagerMockForFilter.setLiquidationDiscount(
      liquidationDiscount
    );

    await expect(
      creditManagerMockForFilter.updateUnderlyingTokenLiquidationThreshold()
    ).to.be.revertedWith(revertMsg);
  });

  it("[CF-40]: it keep one-to-one relationship between contracts and adapters", async () => {
    const revertMsg = await errors.CF_ADAPTER_CAN_BE_USED_ONLY_ONCE();
    await creditFilter.allowContract(DUMB_ADDRESS, user.address);
    await expect(
      creditFilter.allowContract(DUMB_ADDRESS2, user.address)
    ).to.be.revertedWith(revertMsg);
  });

  it("[CF-41]: checkMultiTokenCollateral reverts for incorrect arrays length", async () => {
    const revertMsg = await errors.INCORRECT_ARRAY_LENGTH();

    const creditAccount = await setupCreditAccount();
    const fakeContract = DUMB_ADDRESS2;

    await creditFilter.allowContract(fakeContract, deployer.address);

    expect(await creditFilter.fastCheckCounter(creditAccount.address)).to.be.eq(
      0
    );

    await expect(
      creditFilter.checkMultiTokenCollateral(
        creditAccount.address,

        [0, 1],
        [1, 1],
        [tokenA.address],
        [tokenA.address, tokenA.address]
      )
    ).to.be.revertedWith(revertMsg);

    await expect(
      creditFilter.checkMultiTokenCollateral(
        creditAccount.address,

        [0],
        [1],
        [tokenA.address],
        [tokenA.address, tokenA.address]
      )
    ).to.be.revertedWith(revertMsg);
  });

  it("[CF-42]: checkCollateralChange reverts for non-fastcheck and Hf<1 after operation", async () => {
    const revertMsg = await errors.INCORRECT_ARRAY_LENGTH();

    await creditManagerMockForFilter.connectFilter(
      creditFilter.address,
      underlyingToken.address
    );
    await creditFilter.connectCreditManager(creditManagerMockForFilter.address);

    await creditManagerMockForFilter.setLinearCumulative(RAY);

    await creditFilter.allowContract(DUMB_ADDRESS, deployer.address);

    await priceOracle.addPriceFeed(
      underlyingToken.address,
      (
        await creditManagerDeployer.getUnderlyingPriceFeedMock(WAD)
      ).address
    );

    await priceOracle.addPriceFeed(
      tokenA.address,
      (
        await creditManagerDeployer.getUnderlyingPriceFeedMock(WAD)
      ).address
    );

    await creditFilter.allowToken(
      tokenA.address,
      UNDERLYING_TOKEN_LIQUIDATION_THRESHOLD - 1
    );

    expect(await creditFilter.enabledTokens(DUMB_ADDRESS)).to.be.eq(0);

    const creditAccount = await setupCreditAccount();

    await expect(
      creditFilter.checkMultiTokenCollateral(
        creditAccount.address,
        [0, 0],
        [1],
        [underlyingToken.address],
        [tokenA.address]
      )
    ).to.be.revertedWith(revertMsg);
  });

  it("[CF-43]: approveAccountTransfer approve transfers", async () => {
    const revertMsg = await errors.CF_TRANSFER_IS_NOT_ALLOWED();
    expect(
      await creditFilter.allowanceForAccountTransfers(
        DUMB_ADDRESS,
        deployer.address
      )
    ).to.be.false;
    await expect(
      creditFilter.revertIfAccountTransferIsNotAllowed(
        DUMB_ADDRESS,
        deployer.address
      )
    ).to.be.revertedWith(revertMsg);

    await expect(creditFilter.approveAccountTransfers(DUMB_ADDRESS, true))
      .to.emit(creditFilter, "TransferAccountAllowed")
      .withArgs(DUMB_ADDRESS, deployer.address, true);

    expect(
      await creditFilter.allowanceForAccountTransfers(
        DUMB_ADDRESS,
        deployer.address
      )
    ).to.be.true;
    await creditFilter.revertIfAccountTransferIsNotAllowed(
      DUMB_ADDRESS,
      deployer.address
    );

    await creditFilter.approveAccountTransfers(DUMB_ADDRESS, false);
    expect(
      await creditFilter.allowanceForAccountTransfers(
        DUMB_ADDRESS,
        deployer.address
      )
    ).to.be.false;
    await expect(
      creditFilter.revertIfAccountTransferIsNotAllowed(
        DUMB_ADDRESS,
        deployer.address
      )
    ).to.be.revertedWith(revertMsg);
  });

  it("[CF-44]: allowPlugin allows revertIfAccountTransferIsNotAllowed works without allowance", async () => {
    const revertMsg = await errors.CF_TRANSFER_IS_NOT_ALLOWED();
    await expect(
      creditFilter.revertIfAccountTransferIsNotAllowed(
        DUMB_ADDRESS,
        deployer.address
      )
    ).to.be.revertedWith(revertMsg);

    await expect(creditFilter.allowPlugin(DUMB_ADDRESS, true))
      .to.emit(creditFilter, "TransferPluginAllowed")
      .withArgs(DUMB_ADDRESS, true);

    await expect(creditFilter.allowPlugin(DUMB_ADDRESS2, true))
      .to.emit(creditFilter, "TransferPluginAllowed")
      .withArgs(DUMB_ADDRESS2, true);

    await creditFilter.revertIfAccountTransferIsNotAllowed(
      DUMB_ADDRESS,
      deployer.address
    );

    await expect(
      creditFilter.revertIfAccountTransferIsNotAllowed(
        DUMB_ADDRESS,
        DUMB_ADDRESS2
      )
    ).to.be.revertedWith(revertMsg);

    await expect(creditFilter.allowPlugin(DUMB_ADDRESS, false))
      .to.emit(creditFilter, "TransferPluginAllowed")
      .withArgs(DUMB_ADDRESS, false);

    await expect(
      creditFilter.revertIfAccountTransferIsNotAllowed(
        DUMB_ADDRESS,
        deployer.address
      )
    ).to.be.revertedWith(revertMsg);
  });
});

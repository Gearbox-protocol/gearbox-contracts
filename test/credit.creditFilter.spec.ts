// @ts-ignore
import { ethers } from "hardhat";
import { solidity } from "ethereum-waffle";
import * as chai from "chai";

import {
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
  ADDRESS_0x0,
  DUMB_ADDRESS,
  MAX_INT,
  PERCENTAGE_FACTOR,
  RAY,
  UNDERLYING_TOKEN_LIQUIDATION_THRESHOLD,
  WAD,
} from "../model/_constants";
import { CreditManagerDeployer } from "../deployer/creditManagerDeployer";
import { CreditManagerTestSuite } from "../deployer/creditManagerTestSuite";
import { STANDARD_VA_MANAGER } from "../deployer/creditManagerType";
import { BigNumber } from "ethers";

chai.use(solidity);
const { expect } = chai;

const { amount, borrowedAmount } = CreditManagerTestSuite;

describe("CreditFilter", function () {
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

  beforeEach(async function () {
    ts = new CreditManagerTestSuite({ allowedContracts: [] });
    await ts.getSuite();

    creditManagerDeployer = new CreditManagerDeployer({
      config: {
        ...STANDARD_VA_MANAGER,
        allowedTokens: [],
        uniswapAddress: await ts.integrationsDeployer.getUniswapAddress(),
      },
      coreDeployer: ts.coreDeployer,
      poolService: ts.poolService,
      uniswapAddress: await ts.integrationsDeployer.getUniswapAddress(),
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

  it("[CF-1]: allowToken, allowContract, setupFastCheckParameters reverts for all non configurator calls", async function () {
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
        creditFilter.connect(user).setupFastCheckParameters(100, 100)
    ).to.be.revertedWith(revertMsg);
  });

  it("[CF-2]: allowToken reverts to add token with zero addresses", async function () {
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
  });

  it("[CF-3]: allowToken reverts for incorrect liquidation threshold", async function () {
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

  it("[CF-4]: allowToken correctly adds one token to list and emits TokenAllowedEvent", async function () {
    expect(await creditFilter.allowedTokensCount()).to.be.eq(1);
    expect(await creditFilter.allowedTokens(0)).to.be.hexEqual(
      underlyingToken.address
    );

    const liquidationThreshold = UNDERLYING_TOKEN_LIQUIDATION_THRESHOLD - 100;

    await expect(creditFilter.allowToken(tokenA.address, liquidationThreshold))
        .to.emit(creditFilter, "TokenAllowed")
        .withArgs(tokenA.address, liquidationThreshold);

    expect(await creditFilter.allowedTokensCount()).to.be.eq(2);
    expect(await creditFilter.allowedTokens(1)).to.be.hexEqual(tokenA.address);
    expect(
      await creditFilter.tokenLiquidationThresholds(tokenA.address)
    ).to.be.eq(liquidationThreshold);
    expect(await creditFilter.tokenMasksMap(underlyingToken.address)).to.be.eq(1<<0);
    expect(await creditFilter.tokenMasksMap(tokenA.address)).to.be.eq(1<<1);
  });

  it("[CF-5]: allowToken reverts to add more than 256 tokens", async function () {

    const revertMsg = await errors.CF_TOO_MUCH_ALLOWED_TOKENS()
    const liquidationThreshold = UNDERLYING_TOKEN_LIQUIDATION_THRESHOLD - 100;

    for(let i=1; i<256; i++) {
      const salt = "0x" + "0".repeat(i>15 ? 62: 63) + i.toString(16);
      const tokenAddress = ethers.utils.getCreate2Address(DUMB_ADDRESS, salt, salt)
      await expect(creditFilter.allowToken(tokenAddress, liquidationThreshold))
    }

    await expect(creditFilter.allowToken(deployer.address, liquidationThreshold)).to.be.revertedWith(revertMsg)

  });

  it("[CF-6]: allowToken just update liquidation threshold if called twice", async function () {
    expect(await creditFilter.allowedTokensCount()).to.be.eq(1);
    expect(await creditFilter.allowedTokens(0)).to.be.hexEqual(
      underlyingToken.address
    );

    const liquidationThreshold = UNDERLYING_TOKEN_LIQUIDATION_THRESHOLD - 100;

    await creditFilter.allowToken(tokenA.address, liquidationThreshold);

    const liquidationThreshold2 = UNDERLYING_TOKEN_LIQUIDATION_THRESHOLD - 500;
    await creditFilter.allowToken(tokenA.address, liquidationThreshold2);

    expect(await creditFilter.allowedTokensCount()).to.be.eq(2);
    expect(
      await creditFilter.tokenLiquidationThresholds(tokenA.address)
    ).to.be.eq(liquidationThreshold2);
  });

  it("[CF-7]: revertIfTokenNotAllowed reverts if token is not allowed", async function () {
    const revertMsg = await errors.CF_TOKEN_IS_NOT_ALLOWED();
    await expect(
      creditFilter.revertIfTokenNotAllowed(DUMB_ADDRESS)
    ).to.be.revertedWith(revertMsg);
  });

  it("[CF-8]: constructor adds underlying token to allowed list with UNDERLYING_TOKEN_LIQUIDATION_THRESHOLD", async function () {
    const underlyingTokenAddress =
      await poolDeployer.getUnderlyingTokenAddress();
    expect(await creditFilter.allowedTokensCount()).to.be.eq(1);
    expect(await creditFilter.allowedTokens(0)).to.be.hexEqual(
      underlyingTokenAddress
    );

    // Check that contract doesn't revert on underlying token asset
    await creditFilter.revertIfTokenNotAllowed(underlyingTokenAddress);
    expect(
      await creditFilter.tokenLiquidationThresholds(underlyingTokenAddress)
    ).to.be.eq(UNDERLYING_TOKEN_LIQUIDATION_THRESHOLD);
  });

  it("[CF-9]: allowContract adds new contract to array it called once", async function () {
    expect(await creditFilter.allowedContractsCount()).to.be.eq(0)
    await creditFilter.allowContract(DUMB_ADDRESS, deployer.address)
    expect(await creditFilter.allowedContractsCount()).to.be.eq(1)
    expect(await creditFilter.allowedContracts(0)).to.be.eq(DUMB_ADDRESS)
    expect(await creditFilter.contractToAdapter(DUMB_ADDRESS)).to.be.eq(deployer.address)
    await creditFilter.revertIfAdapterNotAllowed(deployer.address)

  });

  it("[CF-10]: allowContract doesn't add contract to array if called twice and update adapter address and remove previous from allowed list", async function () {

    const revertMsg = await errors.CF_ADAPTERS_ONLY();

    expect(await creditFilter.allowedContractsCount()).to.be.eq(0)
    await creditFilter.allowContract(DUMB_ADDRESS, deployer.address)
    await creditFilter.allowContract(DUMB_ADDRESS, user.address)
    expect(await creditFilter.allowedContractsCount()).to.be.eq(1)
    expect(await creditFilter.allowedContracts(0)).to.be.eq(DUMB_ADDRESS)
    expect(await creditFilter.contractToAdapter(DUMB_ADDRESS)).to.be.eq(user.address)

    await expect(creditFilter.revertIfAdapterNotAllowed(deployer.address)).to.be.revertedWith(revertMsg);


  });

  it("[CF-11]: revertIfAdapterNotAllowed reverts if contract is not allowed", async function () {
    const revertMsg = await errors.CF_ADAPTERS_ONLY();
    await expect(
      creditFilter.revertIfAdapterNotAllowed(DUMB_ADDRESS)
    ).to.be.revertedWith(revertMsg);
  });

  it("[CF-12]: allowContract emits ContractAllowed event", async function () {
    await expect(creditFilter.allowContract(DUMB_ADDRESS, user.address))
        .to.emit(creditFilter, "ContractAllowed")
        .withArgs(DUMB_ADDRESS, user.address)
  });

  it("[CF-13]: connectCreditManager can be called only once", async function () {
    const revertMsg = await errors.IMMUTABLE_CONFIG_CHANGES_FORBIDDEN();

    await creditManagerMockForFilter.connectFilter(
      creditFilter.address,
      underlyingToken.address
    );
    await expect(
      creditManagerMockForFilter.connectFilter(
        creditFilter.address,
        underlyingToken.address
      )
    ).to.be.revertedWith(revertMsg);
  });

  it("[CF-14]: connectCreditManager correctly connects if all price feeds are provided", async function () {
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

    await creditManagerMockForFilter.connectFilter(
      creditFilter.address,
      underlyingToken.address
    );
    expect(await creditFilter.creditManager()).to.be.eq(
      creditManagerMockForFilter.address
    );

    expect(await creditFilter.poolService()).to.be.eq(await creditManagerMockForFilter.poolService());

  });

  it("[CF-15]: finalizeConfig reverts if not all token has price feeds are provided", async function () {
    const revertMsg = await errors.PO_PRICE_FEED_DOESNT_EXIST();
    await creditFilter.allowToken(
      tokenA.address,
      UNDERLYING_TOKEN_LIQUIDATION_THRESHOLD
    );
    await expect(
      creditManagerMockForFilter.connectFilter(
        creditFilter.address,
        underlyingToken.address
      )
    ).to.be.revertedWith(revertMsg);
  });

  it("[CF-16]: connectCreditManager reverts if different underlying token provided", async function () {
    const revertMsg =
      await errors.CF_UNDERLYING_TOKEN_FILTER_CONFLICT();

    await expect(
      creditManagerMockForFilter.connectFilter(
        creditFilter.address,
        DUMB_ADDRESS
      )
    ).to.be.revertedWith(revertMsg);
  });

  it("[CF-17]: calcTotalValue computes total balance correctly", async function () {
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

  it("[CF-18]: calcThresholdWeightedTotalValue computes liquidation balance correctly", async function () {
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

  it("[CF-18]: [Random test] calcTotalBalanceConverted computes total balance correctly", async function () {
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

  it("[CF-19]: initEnabledTokens set enabled tokens to 1", async function () {
    await creditManagerMockForFilter.connectFilter(
      creditFilter.address,
      underlyingToken.address
    );

    await creditFilter.setEnabledTokens(DUMB_ADDRESS, 100);
    expect(await creditFilter.enabledTokens(DUMB_ADDRESS)).to.be.eq(100);
    await creditManagerMockForFilter.initEnabledTokens(DUMB_ADDRESS);
    expect(await creditFilter.enabledTokens(DUMB_ADDRESS)).to.be.eq(1);
  });

  it("[CF-20]: checkCollateralChange,  setCollateralProtection reverts if called non-creditManager computes correctly", async function () {
    const revertMsgCM = await errors.CF_CREDIT_MANAGERS_ONLY();
    const revertMsgAdapter = await errors.CF_ADAPTERS_ONLY();

    await expect(
      creditFilter.checkCollateralChange(
        DUMB_ADDRESS,
        DUMB_ADDRESS,
        DUMB_ADDRESS,
        1,
        1
      )
    ).to.be.revertedWith(revertMsgAdapter);

    await expect(
      creditFilter.initEnabledTokens(DUMB_ADDRESS)
    ).to.be.revertedWith(revertMsgCM);


  });


  // it("[CF-21]: setCollateralProtection sets collateral protection correctly", async function () {
  // });
  //
  it("[CF-22]: checkCollateralChange reverts if tokenOut is not allowed", async function () {
    const revertMsg = await errors.CF_TOKEN_IS_NOT_ALLOWED();

    await creditManagerMockForFilter.connectFilter(
      creditFilter.address,
      underlyingToken.address
    );

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
  });

  it("[CF-23]: checkCollateralChange enables tokenOut token and sets fastCheckBlock if chi >98%", async function () {
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

    const receipt = await creditFilter.checkCollateralChange(
      DUMB_ADDRESS,
      underlyingToken.address,
      tokenA.address,
      WAD.div(2),
      WAD.div(2)
    );

    expect(await creditFilter.enabledTokens(DUMB_ADDRESS)).to.be.eq(2);
    expect(await creditFilter.fastCheckBlock(DUMB_ADDRESS)).to.be.eq(receipt.blockNumber);
  });


  /// 24-25

  it("[CF-26]: calcCreditAccountAccruedInterested computes Account accrued interest correctly", async function () {
    const ciAtOpen = RAY;
    const ciAtClose = RAY.mul(2);

    await creditManagerMockForFilter.connectFilter(
      creditFilter.address,
      underlyingToken.address
    );

    await creditManagerMockForFilter.setLinearCumulative(ciAtClose);

    const va = await ts.testDeployer.getCreditAccount();
    await va.initialize(deployer.address);
    await va.setGenericParameters(borrowedAmount, ciAtOpen);

    expect(
      await creditFilter.calcCreditAccountAccruedInterest(va.address)
    ).to.be.eq(borrowedAmount.mul(2));
  });

  it("[CF-27]: calcCreditAccountHealthFactor computes health factor correct", async function () {
    const ciAtOpen = RAY;
    const ciAtClose = RAY.mul(2);

    await creditManagerMockForFilter.connectFilter(
      creditFilter.address,
      underlyingToken.address
    );

    await creditManagerMockForFilter.setLinearCumulative(ciAtClose);

    const creditAccount = await ts.testDeployer.getCreditAccount();
    await creditAccount.initialize(deployer.address);
    await creditAccount.setGenericParameters(borrowedAmount, ciAtOpen);
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

  // 28..29

  it("[CF-30]:getCreditAccountTokenById returns correct token, amount, tv & twv", async function () {
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
});

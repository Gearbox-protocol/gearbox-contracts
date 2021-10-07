// @ts-ignore
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { WAD } from "@diesellabs/gearbox-sdk";
import { expect } from "../utils/expect";

import { CoreDeployer } from "../deployer/coreDeployer";
import { TestDeployer } from "../deployer/testDeployer";
import {
  ChainlinkPriceFeedMock,
  ContractsRegister,
  DieselToken,
  DieselToken__factory,
  Errors,
  IPriceOracle,
  PriceOracle,
  TokenMock,
  WETHMock,
} from "../types/ethers-v5";

import { DUMB_ADDRESS } from "../core/constants";

const amount = WAD.mul(4);
const tokenAWETHRate = WAD.mul(244).div(1000);
const tokenBWETHRate = WAD.mul(1120).div(1000);

describe("PriceOracle", function () {
  let trader: SignerWithAddress;
  let coreDeployer: CoreDeployer;
  let testDeployer: TestDeployer;
  let contractsRegister: ContractsRegister;
  let priceOracle: IPriceOracle;
  let tokenA: TokenMock;
  let tokenB: TokenMock;
  let chainlinkOracleA: ChainlinkPriceFeedMock;
  let chainlinkOracleB: ChainlinkPriceFeedMock;
  let wethToken: WETHMock;
  let errors: Errors;

  beforeEach(async function () {
    trader = (await ethers.getSigners())[1];
    coreDeployer = new CoreDeployer({
      treasury: "mock",
      weth: "mock",
    });
    testDeployer = new TestDeployer();
    contractsRegister = await coreDeployer.getContractsRegister();
    priceOracle = await coreDeployer.getPriceOracle();
    errors = await testDeployer.getErrors();

    tokenA = await testDeployer.getTokenMock("TokenA", "AAA");
    tokenB = await testDeployer.getTokenMock("TokenB", "BBB");

    chainlinkOracleA = await testDeployer.getChainlinkPriceFeedMock(
      tokenAWETHRate
    );
    chainlinkOracleB = await testDeployer.getChainlinkPriceFeedMock(
      tokenBWETHRate
    );
    wethToken = await coreDeployer.getWETHMock();
  });

  it("[PO-1]: getLastPrice return 1 WAD for the same tokens", async function () {
    expect(
      await priceOracle.getLastPrice(tokenA.address, tokenA.address)
    ).to.be.eq(WAD);
  });

  //NewPriceFeed(address indexed token, address indexed priceFeed);
  it("[PO-2]: getLastPrice return 1 WAD for the same tokens", async function () {
    expect(
      await priceOracle.getLastPrice(tokenA.address, tokenA.address)
    ).to.be.eq(WAD);
  });

  it("[PO-3]: addPriceFeed reverts on tokens with digits > 18", async function () {
    const revertMsg =
      await errors.PO_TOKENS_WITH_DECIMALS_MORE_18_ISNT_ALLOWED();

    const mockTokenArtifact = (await ethers.getContractFactory(
      "DieselToken"
    )) as DieselToken__factory;

    const mockToken = (await mockTokenArtifact.deploy(
      "19dec",
      "19DEC",
      19
    )) as DieselToken;
    await mockToken.deployed();

    await expect(
      priceOracle.addPriceFeed(mockToken.address, chainlinkOracleA.address)
    ).to.be.revertedWith(revertMsg);
  });

  it("[PO-4]: addPriceFeed emits NewPriceFeed", async function () {
    await expect(
      priceOracle.addPriceFeed(tokenA.address, chainlinkOracleA.address)
    )
      .to.emit(priceOracle, "NewPriceFeed")
      .withArgs(tokenA.address, chainlinkOracleA.address);
  });

  it("[PO-5]: addPriceFeed updated pricefeed correctly", async function () {
    await priceOracle.addPriceFeed(tokenA.address, chainlinkOracleA.address);
    await priceOracle.addPriceFeed(tokenA.address, chainlinkOracleB.address);

    expect(
      await priceOracle.getLastPrice(tokenA.address, wethToken.address)
    ).to.be.eq(tokenBWETHRate);
  });

  it("[PO-6]: getLastPrice returns correct price for TokenA-WETH pairs", async function () {
    await priceOracle.addPriceFeed(tokenA.address, chainlinkOracleA.address);
    expect(
      await priceOracle.getLastPrice(tokenA.address, wethToken.address)
    ).to.be.eq(tokenAWETHRate);

    expect(
      await priceOracle.getLastPrice(wethToken.address, tokenA.address)
    ).to.be.eq(WAD.mul(WAD).div(tokenAWETHRate));
  });

  it("[PO-7]: getLastPrice returns correct price for TokenA-TokenB pairs", async function () {
    await priceOracle.addPriceFeed(tokenA.address, chainlinkOracleA.address);
    await priceOracle.addPriceFeed(tokenB.address, chainlinkOracleB.address);

    expect(
      await priceOracle.getLastPrice(tokenA.address, tokenB.address)
    ).to.be.eq(WAD.mul(tokenAWETHRate).div(tokenBWETHRate));

    expect(
      await priceOracle.getLastPrice(tokenB.address, tokenA.address)
    ).to.be.eq(WAD.mul(tokenBWETHRate).div(tokenAWETHRate));
  });

  it("[PO-8]: convert returns correct results of converting token A => token B", async function () {
    await priceOracle.addPriceFeed(tokenA.address, chainlinkOracleA.address);
    await priceOracle.addPriceFeed(tokenB.address, chainlinkOracleB.address);

    expect(
      await priceOracle.convert(amount, tokenA.address, tokenB.address)
    ).to.be.eq(amount.mul(tokenAWETHRate).div(tokenBWETHRate));
  });

  it("[PO-9]: getLastPrice reverts on unknown token", async function () {
    const revertMsg = await errors.PO_PRICE_FEED_DOESNT_EXIST();

    await expect(
      priceOracle.getLastPrice(DUMB_ADDRESS, tokenA.address)
    ).to.be.revertedWith(revertMsg);
  });

  it("[PO-10]: addPriceFeed reverts for oracles with decimals != 18", async function () {
    const revertMsg = await errors.PO_AGGREGATOR_DECIMALS_SHOULD_BE_18();

    chainlinkOracleA = await testDeployer.getChainlinkPriceFeedMock(
      tokenAWETHRate,
      6
    );
    await expect(
      priceOracle.addPriceFeed(tokenA.address, chainlinkOracleA.address)
    ).to.be.revertedWith(revertMsg);
  });
});

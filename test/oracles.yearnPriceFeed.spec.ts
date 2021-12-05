// @ts-ignore
import { ethers } from "hardhat";
import { WAD } from "@diesellabs/gearbox-sdk";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { CoreDeployer } from "../deployer/coreDeployer";
import { IntegrationsDeployer } from "../deployer/integrationsDeployer";
import { TestDeployer } from "../deployer/testDeployer";
import {
  Errors, TokenMock,
  YearnMock,
  YearnPriceFeed
} from "../types/ethers-v5";
import { expect } from "../utils/expect";


describe("YearnPriceFeed", function () {
  let deployer: SignerWithAddress;
  let trader: SignerWithAddress;
  let coreDeployer: CoreDeployer;
  let testDeployer: TestDeployer;
  let token: TokenMock;
  let yVault: YearnMock;
  let yearnPriceFeed: YearnPriceFeed;
  let errors: Errors;

  beforeEach(async function () {
    deployer = (await ethers.getSigners())[0];
    trader = (await ethers.getSigners())[1];
    coreDeployer = new CoreDeployer({
      treasury: "mock",
      weth: "mock",
    });

    const addressProvider = await coreDeployer.getAddressProvider();

    await coreDeployer.getACL();

    testDeployer = new TestDeployer();
    const integrationsDeployer = new IntegrationsDeployer({});

    const priceFeed = await testDeployer.getChainlinkPriceFeedMock(WAD, 18);

    token = await testDeployer.getTokenMock("USDC", "USDC");
    yVault = await integrationsDeployer.getYearnVaultMock(token.address);
    await yVault.addUpdater(deployer.address);
    yearnPriceFeed = await integrationsDeployer.getYearnPriceFeed(
      addressProvider.address,
      yVault.address,
      priceFeed.address,
      12,
      300
    );

    errors = await testDeployer.getErrors();
  });

  it("[YPF-1]: setLimiter reverts if called not by configurator", async function () {
    const revertMsg = await errors.ACL_CALLER_NOT_CONFIGURATOR();

    await expect(
      yearnPriceFeed.connect(trader).setLimiter(10, 10)
    ).to.be.revertedWith(revertMsg);
  });

  it("[YPF-2]: setLimiter sets parameters correctly", async function () {
    const tx = await yearnPriceFeed.setLimiter(12, 33);

    expect(await yearnPriceFeed.lowerBound()).to.be.eq(12);
    expect(await yearnPriceFeed.upperBound()).to.be.eq(33);
  });

  it("[YPF-3]: setLimiter reverts of pricePerShare is out of bounds", async function () {
    const revertMsg = await errors.YPF_PRICE_PER_SHARE_OUT_OF_RANGE();
    await yearnPriceFeed.setLimiter(12, 3300);
    await yVault.setPricePerShare(11);
    await expect(yearnPriceFeed.latestRoundData()).to.be.revertedWith(
      revertMsg
    );

    await yVault.setPricePerShare(3301);
    await expect(yearnPriceFeed.latestRoundData()).to.be.revertedWith(
      revertMsg
    );
  });


});

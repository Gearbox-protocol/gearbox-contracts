// @ts-ignore
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { expect } from "../utils/expect";

import { CoreDeployer } from "../deployer/coreDeployer";
import { TestDeployer } from "../deployer/testDeployer";
import { Errors, IYVault, TokenMock, YearnMock, YearnPriceFeed } from "../types/ethers-v5";
import { IntegrationsDeployer } from "../deployer/integrationsDeployer";
import { SECONDS_PER_YEAR, WAD } from "@diesellabs/gearbox-sdk";

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
    await yVault.addUpdater(deployer.address)
    yearnPriceFeed = await integrationsDeployer.getYearnPriceFeed(
      addressProvider.address,
      yVault.address,
      priceFeed.address
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

    const block = await deployer.provider?.getBlock(tx?.blockHash || "")

    expect(await yearnPriceFeed.lowerBound()).to.be.eq(12);
    expect(await yearnPriceFeed.maxExpectedAPY()).to.be.eq(33);
    expect(await yearnPriceFeed.timestampLimiter()).to.be.eq(block?.timestamp)
  });

  it("[YPF-3]: setLimiter reverts of pricePerShare less than lower bound", async function () {
    const revertMsg = await errors.YPF_PRICE_PER_SHARE_OUT_OF_RANGE();
    await yearnPriceFeed.setLimiter(12, 3300);
    await yVault.setPricePerShare(11);
    await expect(yearnPriceFeed.latestRoundData()).to.be.revertedWith(revertMsg);
  });

  it("[YPF-4]: setLimiter reverts of pricePerShare more than lower bound + k * t", async function () {
    const revertMsg = await errors.YPF_PRICE_PER_SHARE_OUT_OF_RANGE();
    const tx = await yearnPriceFeed.setLimiter(12, 3300);

    const block = await deployer.provider?.getBlock(tx?.blockHash || "")



    const oneYearLater = block!.timestamp + SECONDS_PER_YEAR-1;
    await ethers.provider.send("evm_mine", [oneYearLater]);

    await yVault.setPricePerShare(15);
    await yearnPriceFeed.latestRoundData()

    await yVault.setPricePerShare(66);
    await expect(yearnPriceFeed.latestRoundData()).to.be.revertedWith(revertMsg);
  });


});

// @ts-ignore
import { ethers } from "hardhat";
import { BigNumber } from "ethers";
import { expect } from "../utils/expect";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";

import { ChainlinkPriceFeedMock } from "../types/ethers-v5";
import { IntegrationsDeployer } from "../deployer/integrationsDeployer";
import { TestDeployer } from "../deployer/testDeployer";

const rate = BigNumber.from(11);
const roundId = 80;

describe("ChainlinkPriceFeedMock", function () {
  let deployer: SignerWithAddress;
  let user: SignerWithAddress;
  let integrationsDeployer: IntegrationsDeployer;
  let testDeployer: TestDeployer;
  let chainlinkPriceFeedMock: ChainlinkPriceFeedMock;

  beforeEach(async function () {
    deployer = (await ethers.getSigners())[0];
    user = (await ethers.getSigners())[1];

    integrationsDeployer = new IntegrationsDeployer();
    testDeployer = new TestDeployer();

    chainlinkPriceFeedMock = await testDeployer.getChainlinkPriceFeedMock(rate);
  });

  it("decimals, description and version returns correct values", async function () {
    expect(await chainlinkPriceFeedMock.decimals()).to.be.eq(18);
    expect(await chainlinkPriceFeedMock.description()).to.be.eq("price oracle");
    expect(await chainlinkPriceFeedMock.version()).to.be.eq(1);
  });

  it("getRoundData returns expected mock data", async function () {
    const blockNum = await ethers.provider.getBlockNumber();

    const [_roundId, answer, startedAt, updatedAt, answeredInRound] =
      await chainlinkPriceFeedMock.getRoundData(roundId);

    expect(_roundId).to.be.eq(roundId);
    expect(answer).to.be.eq(rate);
    expect(startedAt).to.be.eq(blockNum - 1);
    expect(updatedAt).to.be.eq(blockNum - 1);
    expect(answeredInRound).to.be.eq(roundId - 2);
  });

  it("latestRoundData returns expected mock data", async function () {
    const blockNum = await ethers.provider.getBlockNumber();
    const [_roundId, answer, startedAt, updatedAt, answeredInRound] =
      await chainlinkPriceFeedMock.latestRoundData();

    expect(_roundId).to.be.eq(roundId);
    expect(answer).to.be.eq(rate);
    expect(startedAt).to.be.eq(blockNum - 1);
    expect(updatedAt).to.be.eq(blockNum - 1);
    expect(answeredInRound).to.be.eq(roundId - 2);
  });

  it("setPrice changes rate", async function () {
    const newRate = rate.mul(2);
    await chainlinkPriceFeedMock.setPrice(newRate);

    const blockNum = await ethers.provider.getBlockNumber();

    const [_roundId, answer, startedAt, updatedAt, answeredInRound] =
      await chainlinkPriceFeedMock.latestRoundData();

    expect(_roundId).to.be.eq(roundId);
    expect(answer).to.be.eq(newRate);
    expect(startedAt).to.be.eq(blockNum - 1);
    expect(updatedAt).to.be.eq(blockNum - 1);
    expect(answeredInRound).to.be.eq(roundId - 2);
  });
});

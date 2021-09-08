// @ts-ignore
import { ethers, waffle } from "hardhat";
import { expect } from "../utils/expect";
import * as chai from "chai";

import { CoreDeployer } from "../deployer/coreDeployer";
import { TestDeployer } from "../deployer/testDeployer";
import { AddressProvider, Errors } from "../types/ethers-v5";
import { DUMB_ADDRESS, OWNABLE_REVERT_MSG } from "../core/constants";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { formatBytes32String } from "ethers/lib/utils";

describe("Address Provider", function () {
  let deployer: SignerWithAddress;
  let user: SignerWithAddress;
  let coreDeployer: CoreDeployer;
  let testDeployer: TestDeployer;
  let addressProvider: AddressProvider;
  let errors: Errors;

  beforeEach(async function () {
    deployer = (await ethers.getSigners())[0];
    user = (await ethers.getSigners())[1];
    coreDeployer = new CoreDeployer({
      treasury: "mock",
      weth: "mock",
    });
    testDeployer = new TestDeployer();

    addressProvider = await coreDeployer.getAddressProvider();
    errors = await testDeployer.getErrors();
  });

  // ToDo: Ownable test for coveing all methods
  // ToDo: test that it emits events correctly

  it("[AP-1]: getAddress reverts if contact not found", async function () {
    const error = await errors.AS_ADDRESS_NOT_FOUND();
    await expect(addressProvider.getAccountFactory()).to.be.revertedWith(error);
  });

  it("[AP-2]: _setAddress emits event correctly", async function () {
    const bytes = formatBytes32String("CONTRACTS_REGISTER");

    await expect(addressProvider.setContractsRegister(DUMB_ADDRESS))
      .to.emit(addressProvider, "AddressSet")
      .withArgs(bytes, DUMB_ADDRESS);
  });

  it("[AP-3]: setACL correctly sets ACL", async function () {
    await addressProvider.setACL(DUMB_ADDRESS);
    const getAddress = await addressProvider.getACL();
    expect(getAddress).to.be.hexEqual(DUMB_ADDRESS);
  });

  it("[AP-4]: setContractsRegister correctly sets ContractsRegister", async function () {
    await addressProvider.setContractsRegister(DUMB_ADDRESS);
    const getAddress = await addressProvider.getContractsRegister();
    expect(getAddress).to.be.hexEqual(DUMB_ADDRESS);
  });

  it("[AP-5]: setPriceOracle correctly sets PriceOracle", async function () {
    await addressProvider.setPriceOracle(DUMB_ADDRESS);
    const getAddress = await addressProvider.getPriceOracle();
    expect(getAddress).to.be.hexEqual(DUMB_ADDRESS);
  });

  it("[AP-6]: setAccountFactory correctly sets AccountFactory", async function () {
    await addressProvider.setAccountFactory(DUMB_ADDRESS);
    const getAddress = await addressProvider.getAccountFactory();
    expect(getAddress).to.be.hexEqual(DUMB_ADDRESS);
  });

  it("[AP-7]: setLeveragedAction correctly sets LeveragedActions", async function () {
    await addressProvider.setLeveragedActions(DUMB_ADDRESS);
    const getAddress = await addressProvider.getLeveragedActions();
    expect(getAddress).to.be.hexEqual(DUMB_ADDRESS);
  });

  it("[AP-8]: setDataCompressor correctly sets DataCompressor", async function () {
    await addressProvider.setDataCompressor(DUMB_ADDRESS);
    const getAddress = await addressProvider.getDataCompressor();
    expect(getAddress).to.be.hexEqual(DUMB_ADDRESS);
  });

  it("[AP-11]: setTreasuryContract correctly sets TreasuryContract", async function () {
    await addressProvider.setTreasuryContract(DUMB_ADDRESS);
    const getAddress = await addressProvider.getTreasuryContract();
    expect(getAddress).to.be.hexEqual(DUMB_ADDRESS);
  });

  it("[AP-12]: setGearToken correctly sets GearToken", async function () {
    await addressProvider.setGearToken(DUMB_ADDRESS);
    const getAddress = await addressProvider.getGearToken();
    expect(getAddress).to.be.hexEqual(DUMB_ADDRESS);
  });

  it("[AP-13]: setWethToken correctly sets WethToken", async function () {
    await addressProvider.setWethToken(DUMB_ADDRESS);
    const getAddress = await addressProvider.getWethToken();
    expect(getAddress).to.be.hexEqual(DUMB_ADDRESS);
  });

  it("[AP-14]: setWETHGateway correctly sets WethGateway", async function () {
    await addressProvider.setWETHGateway(DUMB_ADDRESS);
    const getAddress = await addressProvider.getWETHGateway();
    expect(getAddress).to.be.hexEqual(DUMB_ADDRESS);
  });

  it("[AP-15]: set functions revert if called by non-owner", async function () {
    await expect(
      addressProvider.connect(user).setACL(DUMB_ADDRESS)
    ).to.be.revertedWith(OWNABLE_REVERT_MSG);

    await expect(
      addressProvider.connect(user).setContractsRegister(DUMB_ADDRESS)
    ).to.be.revertedWith(OWNABLE_REVERT_MSG);

    await expect(
      addressProvider.connect(user).setPriceOracle(DUMB_ADDRESS)
    ).to.be.revertedWith(OWNABLE_REVERT_MSG);

    await expect(
      addressProvider.connect(user).setAccountFactory(DUMB_ADDRESS)
    ).to.be.revertedWith(OWNABLE_REVERT_MSG);

    await expect(
      addressProvider.connect(user).setDataCompressor(DUMB_ADDRESS)
    ).to.be.revertedWith(OWNABLE_REVERT_MSG);

    await expect(
      addressProvider.connect(user).setTreasuryContract(DUMB_ADDRESS)
    ).to.be.revertedWith(OWNABLE_REVERT_MSG);

    await expect(
      addressProvider.connect(user).setGearToken(DUMB_ADDRESS)
    ).to.be.revertedWith(OWNABLE_REVERT_MSG);

    await expect(
      addressProvider.connect(user).setWethToken(DUMB_ADDRESS)
    ).to.be.revertedWith(OWNABLE_REVERT_MSG);

    await expect(
      addressProvider.connect(user).setWETHGateway(DUMB_ADDRESS)
    ).to.be.revertedWith(OWNABLE_REVERT_MSG);

    await expect(
      addressProvider.connect(user).setLeveragedActions(DUMB_ADDRESS)
    ).to.be.revertedWith(OWNABLE_REVERT_MSG);
  });
});

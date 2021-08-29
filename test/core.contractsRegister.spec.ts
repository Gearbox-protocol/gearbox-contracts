// @ts-ignore
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { expect } from "../utils/expect";

import { CoreDeployer } from "../deployer/coreDeployer";
import { TestDeployer } from "../deployer/testDeployer";
import { DUMB_ADDRESS } from "../core/constants";
import { ContractsRegister, Errors } from "../types/ethers-v5";

describe("ContractsRegister", function () {
  let deployer: SignerWithAddress;
  let trader: SignerWithAddress;
  let coreDeployer: CoreDeployer;
  let testDeployer: TestDeployer;
  let contractsRegister: ContractsRegister;
  let errors: Errors;

  beforeEach(async function () {
    deployer = (await ethers.getSigners())[0];
    trader = (await ethers.getSigners())[1];
    coreDeployer = new CoreDeployer({
      treasury: "mock",
      weth: "mock",
    });
    testDeployer = new TestDeployer();

    contractsRegister = await coreDeployer.getContractsRegister();
    errors = await testDeployer.getErrors();
  });

  it("[CR-1]: addPools, addCreditManager reverts if called by configurator", async function () {
    const revertMsg = await errors.ACL_CALLER_NOT_CONFIGURATOR();

    await expect(
      contractsRegister.connect(trader).addPool(DUMB_ADDRESS)
    ).to.be.revertedWith(revertMsg);

    await expect(
      contractsRegister.connect(trader).addCreditManager(DUMB_ADDRESS)
    ).to.be.revertedWith(revertMsg);
  });

  it("[CR-2]: addPool reverts if pool is already exists", async function () {
    const error = await errors.CR_POOL_ALREADY_ADDED();
    await contractsRegister.addPool(DUMB_ADDRESS);
    await expect(contractsRegister.addPool(DUMB_ADDRESS)).to.be.revertedWith(
      error
    );
  });

  it("[CR-3]: addPool correctly adds pool", async function () {
    await contractsRegister.connect(deployer).addPool(DUMB_ADDRESS);

    // Checking pool count
    expect(await contractsRegister.getPoolsCount()).to.be.eq(1);

    const getAddress = await contractsRegister.pools(0);
    expect(getAddress).to.be.hexEqual(DUMB_ADDRESS);
    expect(await contractsRegister.isPool(DUMB_ADDRESS)).to.be.eq(true);
  });

  it("[CR-4]: addPool emits event NewPoolAdded", async function () {
    await expect(contractsRegister.connect(deployer).addPool(DUMB_ADDRESS))
      .to.emit(contractsRegister, "NewPoolAdded")
      .withArgs(DUMB_ADDRESS);
  });

  it("[CR-5]: addCreditManager  reverts if address is already exists", async function () {
    const error = await errors.CR_CREDIT_MANAGER_ALREADY_ADDED();
    await contractsRegister.addCreditManager(DUMB_ADDRESS);
    await expect(
      contractsRegister.addCreditManager(DUMB_ADDRESS)
    ).to.be.revertedWith(error);
  });

  it("[CR-6]: addCreditManager correctly adds creditManager", async function () {
    await contractsRegister.connect(deployer).addCreditManager(DUMB_ADDRESS);

    // Checking pool count
    expect(await contractsRegister.getCreditManagersCount()).to.be.eq(1);

    const getAddress = await contractsRegister.creditManagers(0);
    expect(getAddress).to.be.hexEqual(DUMB_ADDRESS);
    expect(await contractsRegister.isCreditManager(DUMB_ADDRESS)).to.be.true;
  });

  it("[CR-7]: addCreditManager emits event NewCreditManagerAdded", async function () {
    await expect(contractsRegister.addCreditManager(DUMB_ADDRESS))
      .to.emit(contractsRegister, "NewCreditManagerAdded")
      .withArgs(DUMB_ADDRESS);
  });
});

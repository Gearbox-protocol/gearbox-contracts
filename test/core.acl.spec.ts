// @ts-ignore
import { ethers } from "hardhat";
import { expect } from "../utils/expect";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";

import { CoreDeployer } from "../deployer/coreDeployer";
import { TestDeployer } from "../deployer/testDeployer";
import { ACL, Errors } from "../types/ethers-v5";
import { DUMB_ADDRESS, OWNABLE_REVERT_MSG } from "../core/constants";


describe("ACL", function () {
  let deployer: SignerWithAddress;
  let user: SignerWithAddress;
  let coreDeployer: CoreDeployer;
  let testDeployer: TestDeployer;
  let ACL: ACL;
  let errors: Errors;

  beforeEach(async function () {
    deployer = (await ethers.getSigners())[0];
    user = (await ethers.getSigners())[1];
    coreDeployer = new CoreDeployer({
      treasury: "mock",
      weth: "mock",
    });
    testDeployer = new TestDeployer();

    ACL = await coreDeployer.getACL();
    errors = await testDeployer.getErrors();
  });

  it("[ACL-1]: addPausableAdmin, addUnpausableAdmin, removePausableAdmin, removeUnpausableAdmin reverts if called by non-owner", async function () {
    await expect(
      ACL.connect(user).addPausableAdmin(DUMB_ADDRESS)
    ).to.be.revertedWith(OWNABLE_REVERT_MSG);

    await expect(
      ACL.connect(user).addUnpausableAdmin(DUMB_ADDRESS)
    ).to.be.revertedWith(OWNABLE_REVERT_MSG);

    await expect(
      ACL.connect(user).removePausableAdmin(DUMB_ADDRESS)
    ).to.be.revertedWith(OWNABLE_REVERT_MSG);

    await expect(
      ACL.connect(user).removeUnpausableAdmin(DUMB_ADDRESS)
    ).to.be.revertedWith(OWNABLE_REVERT_MSG);
  });

  it("[ACL-2]: addPausableAdmin correctly adds pool", async function () {
    // Check that pausable admin is not set
    expect(await ACL.isPausableAdmin(DUMB_ADDRESS)).to.be.false;

    await expect(ACL.connect(deployer).addPausableAdmin(DUMB_ADDRESS))
      .to.emit(ACL, "PausableAdminAdded")
      .withArgs(DUMB_ADDRESS);

    // Check that pausable admin is set after
    expect(await ACL.isPausableAdmin(DUMB_ADDRESS)).to.be.true;
  });

  it("[ACL-3]: removePausableAdmin removes pausable adming", async function () {
    await ACL.addPausableAdmin(DUMB_ADDRESS);
    expect(await ACL.isPausableAdmin(DUMB_ADDRESS)).to.be.true;

    await expect(ACL.removePausableAdmin(DUMB_ADDRESS))
      .to.emit(ACL, "PausableAdminRemoved")
      .withArgs(DUMB_ADDRESS);

    expect(await ACL.isPausableAdmin(DUMB_ADDRESS)).to.be.false;
  });

  it("[ACL-4]: addUnpausableAdmin correctly adds pool", async function () {
    await expect(ACL.connect(deployer).addUnpausableAdmin(DUMB_ADDRESS))
      .to.emit(ACL, "UnpausableAdminAdded")
      .withArgs(DUMB_ADDRESS);

    // Checking pool counts
    expect(await ACL.isUnpausableAdmin(DUMB_ADDRESS)).to.be.true;
  });

  it("[ACL-5]: removeUnpausableAdmin removes unpausable adming", async function () {
    await ACL.addUnpausableAdmin(DUMB_ADDRESS);
    expect(await ACL.isUnpausableAdmin(DUMB_ADDRESS)).to.be.true;

    await expect(ACL.removeUnpausableAdmin(DUMB_ADDRESS))
      .to.emit(ACL, "UnpausableAdminRemoved")
      .withArgs(DUMB_ADDRESS);
    expect(await ACL.isUnpausableAdmin(DUMB_ADDRESS)).to.be.false;
  });

  it("[ACL-6]: isConfigurator works properly", async function () {
    expect(await ACL.isConfigurator(deployer.address)).to.be.true;
    expect(await ACL.isConfigurator(DUMB_ADDRESS)).to.be.false;
  });
});

// @ts-ignore
import { ethers } from "hardhat";
import { expect } from "../utils/expect";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";

import { CoreDeployer } from "../deployer/coreDeployer";
import { TestDeployer } from "../deployer/testDeployer";
import { ACL, ACLTraitTest, Errors } from "../types/ethers-v5";

import {
  PAUSABLE_NOT_PAUSED_REVERT_MSG,
  PAUSABLE_REVERT_MSG,
} from "../core/constants";

describe("ACLTrait", function () {
  let deployer: SignerWithAddress;
  let user: SignerWithAddress;
  let coreDeployer: CoreDeployer;
  let testDeployer: TestDeployer;
  let acl: ACL;
  let ACLTraitTest: ACLTraitTest;
  let errors: Errors;

  beforeEach(async function () {
    deployer = (await ethers.getSigners())[0];
    user = (await ethers.getSigners())[1];
    coreDeployer = new CoreDeployer({
      treasury: "mock",
      weth: "mock",
    });
    testDeployer = new TestDeployer();
    acl = await coreDeployer.getACL();
    const addressProvider = await coreDeployer.getAddressProvider();
    ACLTraitTest = await testDeployer.getACLTraitTest(addressProvider.address);
    errors = await testDeployer.getErrors();
  });

  it("[ACLT-1]: pause, unpause can be called only by pausableAdmin / unpausableAdmin", async function () {
    const revertMsg = await errors.ACL_CALLER_NOT_PAUSABLE_ADMIN();

    await expect(ACLTraitTest.pause()).to.be.revertedWith(revertMsg);
    await expect(ACLTraitTest.unpause()).to.be.revertedWith(revertMsg);
  });

  it("[ACLT-2]: unpause reverts if called pausable admin", async function () {
    const revertMsg = await errors.ACL_CALLER_NOT_PAUSABLE_ADMIN();
    await acl.addPausableAdmin(deployer.address);
    await expect(ACLTraitTest.unpause()).to.be.revertedWith(revertMsg);
  });

  it("[ACLT-3]: whenPaused reverts if contract is not paused, whenNotPaused works well", async function () {
    await ACLTraitTest.accessWhenNotPaused();

    await expect(ACLTraitTest.accessWhenPaused()).to.be.revertedWith(
      PAUSABLE_NOT_PAUSED_REVERT_MSG
    );
  });

  it("[ACLT-4]: whenNotPaused reverts if contract paused, whenPaused works well", async function () {
    await acl.addPausableAdmin(deployer.address);

    await ACLTraitTest.pause();
    await ACLTraitTest.accessWhenPaused();

    await expect(ACLTraitTest.accessWhenNotPaused()).to.be.revertedWith(
      PAUSABLE_REVERT_MSG
    );
  });

  it("[ACLT-5]: unpause correctly cancelled pause state", async function () {
    await acl.addPausableAdmin(deployer.address);
    await acl.addUnpausableAdmin(deployer.address);

    await ACLTraitTest.pause();
    await ACLTraitTest.unpause();

    await ACLTraitTest.accessWhenNotPaused();
  });

  it("[ACLT-6]: pause emits Paused event", async function () {
    await acl.addPausableAdmin(deployer.address);

    await expect(ACLTraitTest.pause())
      .to.emit(ACLTraitTest, "Paused")
      .withArgs(deployer.address);
  });

  it("[ACLT-7]: unpause emits Unpaused event", async function () {
    await acl.addPausableAdmin(deployer.address);
    await acl.addUnpausableAdmin(deployer.address);

    await ACLTraitTest.pause();
    await expect(ACLTraitTest.unpause())
      .to.emit(ACLTraitTest, "Unpaused")
      .withArgs(deployer.address);
  });

  it("[ACLT-8]: configuratorOnly reverts if not configurator only", async function () {
    const revertMsg = await errors.ACL_CALLER_NOT_CONFIGURATOR();

    await ACLTraitTest.connect(deployer).accessConfiguratorOnly();
    await expect(
      ACLTraitTest.connect(user).accessConfiguratorOnly()
    ).to.be.revertedWith(revertMsg);
  });
});

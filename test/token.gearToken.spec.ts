/*
 * SPDX-License-Identifier: BSL-1.1
 * Gearbox. Generalized leverage protocol, which allows to take leverage and then use it across other DeFi protocols and platforms in a composable way.
 * (c) Gearbox.fi, 2021
 */
// @ts-ignore
import { ethers } from "hardhat";
import { expect } from "../utils/expect";

import { GearToken } from "../types/ethers-v5";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";

import { CoreDeployer } from "../deployer/coreDeployer";
import { ADDRESS_0x0 } from "@diesellabs/gearbox-sdk";

describe("GearToken", function () {
  let deployer: SignerWithAddress;
  let user: SignerWithAddress;
  let miner: SignerWithAddress;

  let coreDeployer: CoreDeployer;

  let gearToken: GearToken;

  beforeEach(async () => {
    deployer = (await ethers.getSigners())[0] as SignerWithAddress;
    user = (await ethers.getSigners())[1] as SignerWithAddress;
    miner = (await ethers.getSigners())[2] as SignerWithAddress;

    coreDeployer = new CoreDeployer({});
    gearToken = await coreDeployer.getGearToken(deployer.address);
    await gearToken.setMiner(miner.address);
  });

  it("[GT-1]: token can be sent by miner or manager only", async () => {
    const revertMsg = "Gear::transfers are forbidden";
    await gearToken.transfer(miner.address, 10000);
    await gearToken.connect(miner).transfer(user.address, 1000);
    await expect(
      gearToken.connect(user).transfer(miner.address, 100)
    ).to.be.revertedWith(revertMsg);
  });

  it("[GT-2]: token can be sent by anyone after transfers are allowed", async () => {
    await gearToken.transfer(miner.address, 10000);
    await gearToken.connect(miner).transfer(user.address, 1000);
    expect(await gearToken.transfersAllowed()).to.be.false;
    await expect(gearToken.allowTransfers()).to.emit(gearToken, "TransferAllowed");
    await gearToken.connect(miner).transfer(miner.address, 100);
    expect(await gearToken.transfersAllowed()).to.be.true;
  });

  it("[GT-3]: allowTransfers, setMiner, transferOwnership reverts for non-manager", async () => {
    const revertMsg = "Gear::caller is not the manager";

    await expect(
      gearToken.connect(miner).setMiner(miner.address)
    ).to.be.revertedWith(revertMsg);

    await expect(gearToken.connect(miner).allowTransfers()).to.be.revertedWith(
      revertMsg
    );

    await expect(
      gearToken.connect(miner).transferOwnership(user.address)
    ).to.be.revertedWith(revertMsg);
  });
  it("[GT-4]: setMiner sets miner correctly", async () => {
    expect(await gearToken.miner()).to.be.eq(miner.address);
    await expect(gearToken.connect(deployer).setMiner(user.address))
      .to.emit(gearToken, "MinerSet").withArgs(user.address);

    expect(await gearToken.miner()).to.be.eq(user.address);
  });

  it("[GT-5]: transferOwnership reverts for address(0)", async () => {
    const revertMsg = "Zero address is not allowed";

    await expect(
      gearToken.connect(deployer).transferOwnership(ADDRESS_0x0)
    ).to.be.revertedWith(revertMsg);
  });

  it("[GT-6]: transferOwnership changes manager", async () => {
    expect(await gearToken.miner()).to.be.eq(miner.address);
    await expect(gearToken.connect(deployer).transferOwnership(user.address))
      .to.emit(gearToken, "OwnershipTransferred")
      .withArgs(deployer.address, user.address);

    expect(await gearToken.manager()).to.be.eq(user.address);
  });
});

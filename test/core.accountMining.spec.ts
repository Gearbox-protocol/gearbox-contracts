/*
 * SPDX-License-Identifier: BSL-1.1
 * Gearbox. Generalized leverage protocol, which allows to take leverage and then use it across other DeFi protocols and platforms in a composable way.
 * (c) Gearbox.fi, 2021
 */
// @ts-ignore
import { ethers } from "hardhat";
import { expect } from "../utils/expect";

import {
  AccountFactory,
  AccountMining,
  Errors,
  GearToken,
} from "../types/ethers-v5";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { WAD } from "@diesellabs/gearbox-sdk";

import { CoreDeployer } from "../deployer/coreDeployer";
import { MerkleDistributorInfo, parseAccounts } from "../merkle/parse-accounts";

const reward = WAD.mul(10);

describe("AccountMining", function () {
  let deployer: SignerWithAddress;
  let user: SignerWithAddress;
  let friend: SignerWithAddress;

  let coreDeployer: CoreDeployer;
  let accountFactory: AccountFactory;

  let gearToken: GearToken;
  let merkle: MerkleDistributorInfo;
  let accountMining: AccountMining;

  let errors: Errors;

  beforeEach(async () => {
    deployer = (await ethers.getSigners())[0] as SignerWithAddress;
    user = (await ethers.getSigners())[1] as SignerWithAddress;
    friend = (await ethers.getSigners())[2] as SignerWithAddress;

    coreDeployer = new CoreDeployer({});
    accountFactory = await coreDeployer.getAccountFactory();
    merkle = parseAccounts([deployer.address, user.address]);
    gearToken = await coreDeployer.getGearToken(deployer.address);

    accountMining = await coreDeployer.getAccountMining(
      gearToken.address,
      merkle.merkleRoot,
      reward
    );
    await gearToken.setMiner(accountMining.address);
    await gearToken.transfer(accountMining.address, WAD.mul(20000));
  });

  it("[AM-1]: account from list can mine account and get reward", async () => {
    const accountsQty = await accountFactory.countCreditAccounts();

    const claim = merkle.claims[user.address];

    expect(
      await accountMining.connect(user).isClaimed(claim.index),
      "Is claimed"
    ).to.be.false;

    await accountMining
      .connect(user)
      .claim(claim.index, claim.salt, claim.proof);

    expect(await accountFactory.countCreditAccounts()).to.be.eq(
      accountsQty.toNumber() + 1
    );

    expect(await gearToken.balanceOf(user.address)).to.be.eq(reward);

    expect(
      await accountMining.connect(user).isClaimed(claim.index),
      "Is claimed after"
    ).to.be.true;
  });

  it("[AM-2]: account cant claim twice", async () => {
    const revertMsg = "MerkleDistributor: Account is already mined.";

    const claim = merkle.claims[user.address];
    await accountMining
      .connect(user)
      .claim(claim.index, claim.salt, claim.proof);

    await expect(
      accountMining.connect(user).claim(claim.index, claim.salt, claim.proof)
    ).to.be.revertedWith(revertMsg);
  });

  it("[AM-3]: it reverts with index for another user", async () => {
    const revertMsg = "MerkleDistributor: Invalid proof.";

    const claim = merkle.claims[user.address];

    await expect(
      accountMining
        .connect(deployer)
        .claim(claim.index, claim.salt, claim.proof)
    ).to.be.revertedWith(revertMsg);
  });

  it("[AM-4]: it reverts if merkeProof lenght is zero", async () => {
    const revertMsg = "MerkleDistributor: Invalid proof.";

    const claim = merkle.claims[user.address];

    await expect(
      accountMining.connect(deployer).claim(claim.index, claim.salt, [])
    ).to.be.revertedWith(revertMsg);
  });
});

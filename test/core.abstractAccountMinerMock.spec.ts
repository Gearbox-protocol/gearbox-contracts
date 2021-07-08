// @ts-ignore
import { ethers } from 'hardhat';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { solidity } from 'ethereum-waffle';
import * as chai from 'chai';

import { CoreDeployer } from '../deployer/coreDeployer';
import { TestDeployer } from '../deployer/testDeployer';
import { AccountMinerMock, Errors } from '../types/ethers-v5';

chai.use(solidity);
const { expect } = chai;

describe("AccountMinerMock", function () {
  let deployer: SignerWithAddress;
  let user: SignerWithAddress;
  let coreDeployer: CoreDeployer;
  let testDeployer: TestDeployer;
  let accountMiner: AccountMinerMock;
  let errors: Errors;

  beforeEach(async function () {
    deployer = (await ethers.getSigners())[0];
    user = (await ethers.getSigners())[1];
    coreDeployer = new CoreDeployer({
      accountMinerType: "mock",
      treasury: "mock",
      weth: "mock",
    });

    testDeployer = new TestDeployer();

    const addressProvider = await coreDeployer.getAddressProvider();
    await addressProvider.setAccountFactory(deployer.address);

    accountMiner = ((await coreDeployer.getAccountMiner(
      "mock", false
    )) as undefined) as AccountMinerMock;
    errors = await testDeployer.getErrors();
  });


  it("[AMM-5]: mineAccount reverts for non-factory calls", async function () {
    const revertMsg = await errors.AM_ACCOUNT_FACTORY_ONLY();
    await expect(
      accountMiner.connect(user).mineAccount(deployer.address)
    ).to.be.revertedWith(revertMsg);
  });

  it("[AMM-6]: mineAccount can be called by account factory", async function () {
    await accountMiner.mineAccount(deployer.address);
  });
});

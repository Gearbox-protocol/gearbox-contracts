// @ts-ignore
import { ethers } from "hardhat";
import { expect } from "../utils/expect";

import { CoreDeployer } from "../deployer/coreDeployer";
import { TestDeployer } from "../deployer/testDeployer";
import { AccountMinerOwnFunds, Errors } from "../types/ethers-v5";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { DEPLOYMENT_COST } from "../core/constants";
import { formatBytes32String } from "ethers/lib/utils";

describe("AccountMineOwnFunds", function () {
  let deployer: SignerWithAddress;
  let user: SignerWithAddress;
  let coreDeployer: CoreDeployer;
  let testDeployer: TestDeployer;
  let accountMiner: AccountMinerOwnFunds;
  let errors: Errors;

  const _mineAccountSetup = async () => {
    // Provide enough funds to compensate user action
    await deployer.sendTransaction({
      to: accountMiner.address,
      value: DEPLOYMENT_COST,
    });
  };

  beforeEach(async function () {
    deployer = (await ethers.getSigners())[0];
    user = (await ethers.getSigners())[1];
    coreDeployer = new CoreDeployer({
      accountMinerType: "own",
      treasury: "mock",
      weth: "mock",
    });
    testDeployer = new TestDeployer();

    const addressProvider = await coreDeployer.getAddressProvider();
    await addressProvider.setAccountFactory(deployer.address);
    accountMiner = (await coreDeployer.getAccountMiner(
      "own",
      false
    )) as AccountMinerOwnFunds;

    errors = await testDeployer.getErrors();
  });

  it("[AMOF-1]: mineAccount reverts if was called not by account factory", async function () {
    const revertMsg = await errors.AM_ACCOUNT_FACTORY_ONLY();
    await expect(
      accountMiner.connect(user).mineAccount(user.address)
    ).to.be.revertedWith(revertMsg);
  });

  it("[AMOF-2]: accountMiner receive() emits BalanceAdded event with receives funds", async function () {
    await expect(
      deployer.sendTransaction({
        to: accountMiner.address,
        value: DEPLOYMENT_COST,
      })
    )
      .to.emit(accountMiner, "BalanceAdded")
      .withArgs(deployer.address, DEPLOYMENT_COST);
  });

  it("[AMOF-3]: mineAccount correctly pays DEPLOYMENT_COST to msg.sender", async function () {
    await _mineAccountSetup();
    expect(await accountMiner.mineAccount(user.address)).to.changeEtherBalance(
      user,
      DEPLOYMENT_COST
    );
  });

  it("[AMOF-5]: kind returns 'own'", async function () {
    const kindBytes = formatBytes32String("own");
    expect(await accountMiner.kind()).to.be.eq(kindBytes);
  });
});

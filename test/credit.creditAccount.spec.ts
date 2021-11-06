// @ts-ignore
import { ethers } from "hardhat";
import { expect } from "../utils/expect";
import * as chai from "chai";

import { TestDeployer } from "../deployer/testDeployer";
import { CreditAccount, Errors } from "../types/ethers-v5";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { CoreDeployer } from "../deployer/coreDeployer";
import { DUMB_ADDRESS, OWNABLE_REVERT_MSG } from "../core/constants";
import { MAX_INT } from "@diesellabs/gearbox-sdk";

describe("CreditAccount", function () {
  let deployer: SignerWithAddress;
  let user: SignerWithAddress;
  let coreDeployer: CoreDeployer;
  let testDeployer: TestDeployer;
  let creditAccount: CreditAccount;
  let errors: Errors;

  beforeEach(async () => {
    deployer = (await ethers.getSigners())[0] as SignerWithAddress;
    user = (await ethers.getSigners())[1];
    coreDeployer = new CoreDeployer({
      treasury: "mock",
      weth: "mock",
    });
    testDeployer = new TestDeployer();
    creditAccount = await testDeployer.getCreditAccount();
    await creditAccount.initialize();

    errors = await testDeployer.getErrors();
  });

  it("[CA-1]: initialize reverts if called by non-owner", async () => {
    const revertMsg = await errors.CA_FACTORY_ONLY();

    await expect(
      creditAccount.connect(user).connectTo(DUMB_ADDRESS, 1, 1)
    ).to.be.revertedWith(revertMsg);
  });

  it("[CA-2]:  updateBorrowedAmount, approveTokenForContract, transfer reverts if call non credit Manager", async () => {
    const revertMsg = await errors.CA_CONNECTED_CREDIT_MANAGER_ONLY();

    await expect(
      creditAccount.connect(user).updateParameters(1,2)
    ).to.be.revertedWith(revertMsg);

    await expect(
      creditAccount.connect(user).approveToken(DUMB_ADDRESS, DUMB_ADDRESS)
    ).to.be.revertedWith(revertMsg);

    await expect(
      creditAccount.connect(user).safeTransfer(DUMB_ADDRESS, DUMB_ADDRESS, 12)
    ).to.be.revertedWith(revertMsg);
  });

  it("[CA-3]: connectTo set parameters correctly", async () => {
    await creditAccount.connectTo(deployer.address, 100, 200);
    expect(await creditAccount.borrowedAmount()).to.be.eq(100);
    expect(await creditAccount.cumulativeIndexAtOpen()).to.be.eq(200);
  });

  it("[CA-4]: updateBorrowAmount updates correctly", async () => {
    await creditAccount.connectTo(deployer.address, 100, 200);
    await creditAccount.updateParameters(454, 3455);
    expect(await creditAccount.borrowedAmount()).to.be.eq(454);
    expect(await creditAccount.cumulativeIndexAtOpen()).to.be.eq(3455);
  });

  it("[CA-5]: approveTokenForContract sets MAX allowance for provided token", async () => {
    await creditAccount.connectTo(deployer.address, 1, 1);
    const tokenMock = await testDeployer.getTokenMock("TEST", "TEST");

    await creditAccount.approveToken(tokenMock.address, DUMB_ADDRESS);
    expect(
      await tokenMock.allowance(creditAccount.address, DUMB_ADDRESS)
    ).to.be.eq(MAX_INT);
  });

  it("[CA-6]: transfer transfers tokens correctly", async () => {
    await creditAccount.connectTo(deployer.address, 1, 1);

    const amountTransfer = 1000;
    const tokenMock = await testDeployer.getTokenMock("TEST", "TEST");
    await tokenMock.mint(creditAccount.address, 10000);

    const creditAccountBalanceBefore = await tokenMock.balanceOf(
      creditAccount.address
    );
    const userBalanceBefore = await tokenMock.balanceOf(user.address);

    await creditAccount.safeTransfer(
      tokenMock.address,
      user.address,
      amountTransfer
    );

    expect(await tokenMock.balanceOf(creditAccount.address)).to.be.eq(
      creditAccountBalanceBefore.sub(amountTransfer)
    );
    expect(await tokenMock.balanceOf(user.address)).to.be.eq(
      userBalanceBefore.add(amountTransfer)
    );
  });

  it("[CA-7]: connectTo() sets creditManager & since parameters correctly", async () => {
    const receipt = await creditAccount.connectTo(user.address, 101, 202);

    expect(await creditAccount.since()).to.be.eq(receipt.blockNumber);
    expect(await creditAccount.borrowedAmount()).to.be.eq(101);
    expect(await creditAccount.cumulativeIndexAtOpen()).to.be.eq(202);
    expect(await creditAccount.creditManager()).to.be.eq(user.address);
  });
});

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

  beforeEach(async function () {
    deployer = (await ethers.getSigners())[0] as SignerWithAddress;
    user = (await ethers.getSigners())[1];
    coreDeployer = new CoreDeployer({
      accountMinerType: "mock",
      treasury: "mock",
      weth: "mock",
    });
    testDeployer = new TestDeployer();
    creditAccount = await testDeployer.getCreditAccount();

    errors = await testDeployer.getErrors();
  });

  it("[CA-1]: initialize reverts if called by non-owner", async function () {
    await expect(
      creditAccount.connect(user).initialize(DUMB_ADDRESS)
    ).to.be.revertedWith(OWNABLE_REVERT_MSG);
  });

  it("[CA-2]: setGenericParameters, updateBorrowedAmount, approveTokenForContract, transfer reverts if call non credit Manager", async function () {
    const revertMsg = await errors.CA_CREDIT_MANAGER_ONLY();
    await expect(
      creditAccount.connect(user).setGenericParameters(100, 100)
    ).to.be.revertedWith(revertMsg);

    await expect(
      creditAccount.connect(user).updateBorrowedAmount(12)
    ).to.be.revertedWith(revertMsg);

    await expect(
      creditAccount.connect(user).approveToken(DUMB_ADDRESS, DUMB_ADDRESS)
    ).to.be.revertedWith(revertMsg);

    await expect(
      creditAccount.connect(user).transfer(DUMB_ADDRESS, DUMB_ADDRESS, 12)
    ).to.be.revertedWith(revertMsg);
  });

  it("[CA-3]: setGenericParameters set parameters correctly", async function () {
    await creditAccount.initialize(deployer.address);
    await creditAccount.setGenericParameters(100, 200);
    expect(await creditAccount.borrowedAmount()).to.be.eq(100);
    expect(await creditAccount.cumulativeIndexAtOpen()).to.be.eq(200);
  });

  it("[CA-4]: updateBorrowAmount updates correctly", async function () {
    await creditAccount.initialize(deployer.address);
    await creditAccount.setGenericParameters(100, 200);
    await creditAccount.updateBorrowedAmount(454);
    expect(await creditAccount.borrowedAmount()).to.be.eq(454);
  });

  it("[CA-5]: approveTokenForContract sets MAX allowance for provided token", async function () {
    await creditAccount.initialize(deployer.address);
    const tokenMock = await testDeployer.getTokenMock("TEST", "TEST");

    await creditAccount.approveToken(tokenMock.address, DUMB_ADDRESS);
    expect(
      await tokenMock.allowance(creditAccount.address, DUMB_ADDRESS)
    ).to.be.eq(MAX_INT);
  });

  it("[CA-6]: transfer transfers tokens correctly", async function () {
    await creditAccount.initialize(deployer.address);

    const amountTransfer = 1000;
    const tokenMock = await testDeployer.getTokenMock("TEST", "TEST");
    await tokenMock.mint(creditAccount.address, 10000);

    const creditAccountBalanceBefore = await tokenMock.balanceOf(
      creditAccount.address
    );
    const userBalanceBefore = await tokenMock.balanceOf(user.address);

    await creditAccount.transfer(
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

  it("[CA-7]: initalize() sets creditManager & since parameters correctly", async function () {
    const receipt = await creditAccount.initialize(user.address);

    expect(await creditAccount.since()).to.be.eq(receipt.blockNumber);
    expect(await creditAccount.creditManager()).to.be.eq(user.address);
  });
});

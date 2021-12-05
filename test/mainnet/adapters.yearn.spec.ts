/*
 * SPDX-License-Identifier: BSL-1.1
 * Gearbox. Generalized leverage protocol, which allows to take leverage and then use it across other DeFi protocols and platforms in a composable way.
 * (c) Gearbox.fi, 2021
 */

import { YearnHelper } from "@diesellabs/gearbox-leverage";
import {
  LEVERAGE_DECIMALS, MAX_INT, PERCENTAGE_FACTOR,
  SwapType,
  tokenDataByNetwork,
  WAD,
  YEARN_DAI_ADDRESS
} from "@diesellabs/gearbox-sdk";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { BigNumber } from "ethers";
import { TestDeployer } from "../../deployer/testDeployer";
import {
  Errors,
  IYVault__factory,
  YearnAdapter__factory
} from "../../types/ethers-v5";
import { expect } from "../../utils/expect";
import { waitForTransaction } from "../../utils/transaction";
import { MainnetSuite } from "./helper";


describe("YEARN adapter (Mainnet test)", function () {
  this.timeout(0);

  const accountAmount = BigNumber.from(1000).mul(WAD);
  const leverageFactor = 4 * LEVERAGE_DECIMALS;
  const referralCode = 888777;

  let ts: MainnetSuite;
  let deployer: SignerWithAddress;
  let user: SignerWithAddress;
  let liquidator: SignerWithAddress;
  let friend: SignerWithAddress;

  let errors: Errors;

  before(async () => {
    ts = await MainnetSuite.getSuite();
    deployer = ts.deployer
    user = ts.user
    liquidator = ts.liquidator
    friend = ts.friend

    const testDeployer = new TestDeployer();
    errors = await testDeployer.getErrors();


  });

  const openUserAccount = async () => {
    const amountOnAccount = accountAmount
      .mul(leverageFactor + LEVERAGE_DECIMALS)
      .div(LEVERAGE_DECIMALS);

    const adapter = await ts.creditFilterDAI.contractToAdapter(
      YEARN_DAI_ADDRESS
    );

    const yearnHelper = await YearnHelper.getHelper(
      "Yearn DAI",
      YEARN_DAI_ADDRESS,
      adapter,
      deployer
    );

    await waitForTransaction(ts.daiToken.transfer(user.address, accountAmount));


    if (!(await ts.creditManagerDAI.hasOpenedCreditAccount(user.address))) {
      await waitForTransaction(ts.creditManagerDAI.connect(user).openCreditAccount(
        accountAmount,
        user.address,
        leverageFactor,
        referralCode
      ));

    }

    const creditAccount = await ts.creditManagerDAI.getCreditAccountOrRevert(
      user.address
    );

    expect(
      (await ts.daiToken.balanceOf(creditAccount)).sub(amountOnAccount),
      "openUserAccount amountOnAccount"
    ).to.be.lte(2);

    const adapterContract = YearnAdapter__factory.connect(adapter, user);

    const yVault = IYVault__factory.connect(YEARN_DAI_ADDRESS, deployer);

    await waitForTransaction(ts.daiToken.approve(yVault.address, MAX_INT))

    return {
      amountOnAccount,
      creditAccount,
      yearnHelper,
      adapter: adapterContract,
      yVault,
    };
  };


  it("[YA-1]: deposit() converts whole DAI amount to yDAI", async () => {
    const { amountOnAccount, creditAccount, yearnHelper, adapter, yVault } =
      await openUserAccount();

    const yDAIAmount = await yearnHelper.getExpectedAmount(
      SwapType.ExactInput,
      [tokenDataByNetwork.Mainnet.DAI.address, YEARN_DAI_ADDRESS],
      amountOnAccount
    );

    await waitForTransaction(adapter["deposit()"]());


    expect(await ts.daiToken.balanceOf(creditAccount)).to.be.eq(0);

    expect(
      (await yVault.balanceOf(creditAccount))
        .mul(PERCENTAGE_FACTOR)
        .div(yDAIAmount)
        .sub(PERCENTAGE_FACTOR)
        .abs()
    ).lte(2);

    await ts.repayUserAccount(amountOnAccount);
  });

  for (let func of ["deposit(uint256)", "deposit(uint256,address)"]) {
    it(`[YA-2]: ${func} converts exact DAI amount to yDAI`, async () => {
      const { amountOnAccount, creditAccount, yearnHelper, adapter, yVault } =
        await openUserAccount();



      const amountToDeposit = amountOnAccount.div(2);

      const yDAIAmount = await yearnHelper.getExpectedAmount(
        SwapType.ExactInput,
        [tokenDataByNetwork.Mainnet.DAI.address, YEARN_DAI_ADDRESS],
        amountToDeposit
      );

      await waitForTransaction(
        func === "deposit(uint256)"
          ? adapter["deposit(uint256)"](amountToDeposit)
          : adapter["deposit(uint256,address)"](
            amountToDeposit,
            friend.address
          ));


      const sharesAdapter =
        func === "deposit(uint256)"
          ? await adapter.callStatic["deposit(uint256)"](amountToDeposit)
          : await adapter.callStatic["deposit(uint256,address)"](
            amountToDeposit,
            friend.address
          );


      const sharesVault =
        func === "deposit(uint256)"
          ? await yVault.callStatic["deposit(uint256)"](amountToDeposit)
          : await yVault.callStatic["deposit(uint256,address)"](
            amountToDeposit,
            friend.address
          );

      expect(sharesAdapter).to.be.eq(sharesVault);

      expect(
        (await ts.daiToken.balanceOf(creditAccount))
          .sub(amountOnAccount.sub(amountToDeposit))
          .abs()
      ).to.be.lte(2);

      expect(
        (await yVault.balanceOf(creditAccount))
          .mul(PERCENTAGE_FACTOR)
          .div(yDAIAmount)
          .sub(PERCENTAGE_FACTOR)
          .abs()
      ).lte(2);


      await ts.repayUserAccount(amountOnAccount);
    });
  }

  it("[YA-3]: withdraw() converts whole yDAI amount to DAI", async () => {
    const { amountOnAccount, creditAccount, yearnHelper, adapter, yVault } =
      await openUserAccount();

    const amountToDeposit = amountOnAccount.div(2);

    const expected_yDAIAmount = await yearnHelper.getExpectedAmount(
      SwapType.ExactInput,
      [tokenDataByNetwork.Mainnet.DAI.address, YEARN_DAI_ADDRESS],
      amountToDeposit
    );

    await waitForTransaction(adapter["deposit(uint256)"](amountToDeposit));

    const daiBalance = await ts.daiToken.balanceOf(creditAccount);
    const yDAIBalance = await adapter.balanceOf(creditAccount);

    expect(
      daiBalance.sub(amountOnAccount.sub(amountToDeposit)).abs(),
      "DAI balance after deposit"
    ).to.be.lte(2);

    expect(
      yDAIBalance
        .mul(PERCENTAGE_FACTOR)
        .div(expected_yDAIAmount)
        .sub(PERCENTAGE_FACTOR)
        .abs(),
      "yDAI balance after deposit"
    ).to.be.lte(2);

    await adapter["withdraw()"]();

    const daiBalance2 = await ts.daiToken.balanceOf(creditAccount);

    expect(
      daiBalance2
        .mul(PERCENTAGE_FACTOR)
        .div(amountOnAccount)
        .sub(PERCENTAGE_FACTOR),
      "DAI balance after withdraw"
    ).to.be.lte(2);

    await ts.repayUserAccount(amountOnAccount);
  });

  for (let func of [
    "withdraw(uint256)",
    "withdraw(uint256,address)",
    "withdraw(uint256,address,uint)",
  ]) {
    it(`[YA-4]: ${func} converts exact yDAI amount to DAI`, async () => {
      const { amountOnAccount, creditAccount, yearnHelper, adapter, yVault } =
        await openUserAccount();

      const amountToDeposit = amountOnAccount.div(2);

      const expected_yDAIAmount = await yearnHelper.getExpectedAmount(
        SwapType.ExactInput,
        [tokenDataByNetwork.Mainnet.DAI.address, YEARN_DAI_ADDRESS],
        amountToDeposit
      );

      // Deposit money to YEARN
      await waitForTransaction(yVault["deposit(uint256)"](amountToDeposit));

      // Deposit money to YEARN
      await waitForTransaction(adapter["deposit(uint256)"](amountToDeposit));

      const yDAIBalance = await adapter.balanceOf(creditAccount);
      const amountToWithdraw = yDAIBalance.div(2);

      switch (func) {
        case "withdraw(uint256)":
          const sharesAdapter = await adapter.callStatic["withdraw(uint256)"](
            amountToWithdraw
          );

          const sharesVault = await yVault.callStatic["withdraw(uint256)"](
            amountToWithdraw
          );

          expect(sharesAdapter).to.be.eq(sharesVault);

          await waitForTransaction(adapter["withdraw(uint256)"](amountToWithdraw));
          break;
        case "withdraw(uint256,address)":
          const sharesAdapter2 = await adapter.callStatic[
            "withdraw(uint256,address)"
          ](amountToWithdraw, friend.address);
          const sharesVault2 = await yVault.callStatic[
            "withdraw(uint256,address)"
          ](amountToWithdraw, friend.address);

          expect(sharesAdapter2).to.be.eq(sharesVault2);

          await waitForTransaction(adapter["withdraw(uint256,address)"](
            amountToWithdraw,
            friend.address
          ));

          break;
        case "withdraw(uint256,address,uint)":
          const sharesAdapter3 = await adapter.callStatic[
            "withdraw(uint256,address,uint256)"
          ](amountToWithdraw, friend.address, 10);
          const sharesVault3 = await yVault.callStatic[
            "withdraw(uint256,address,uint256)"
          ](amountToWithdraw, friend.address, 10);

          expect(sharesAdapter3).to.be.eq(sharesVault3);

          await waitForTransaction(adapter["withdraw(uint256,address,uint256)"](
            amountToWithdraw,
            friend.address,
            10
          ));

          break;
      }

      const yDAIBalanceAfter = await yVault.balanceOf(creditAccount);
      expect(
        yDAIBalanceAfter.sub(yDAIBalance.div(2)).abs(),
        "yDAI balance updated correctly"
      ).to.be.lt(2);

      const daiBalance2 = await ts.daiToken.balanceOf(creditAccount);

      expect(
        daiBalance2
          .mul(PERCENTAGE_FACTOR)
          .div(amountOnAccount)
          .sub(PERCENTAGE_FACTOR),
        "DAI balance after withdraw"
      ).to.be.lte(2);

      await ts.repayUserAccount(amountOnAccount);
    });
  }

  it("[YA-4]: price_share manipulation", async () => {
    const { amountOnAccount, yVault } =
      await openUserAccount();
    await ts.repayUserAccount(amountOnAccount);

    const price = await yVault.pricePerShare();
    const daiBalance = await ts.daiToken.balanceOf(deployer.address);
    console.log(`Price: ${price}, Balance: ${daiBalance.div(WAD)}`);


    // await waitForTransaction(ts.daiToken.transfer(yVault.address, daiBalance.div(2)));

    //yVault["deposit()"]());

    const price2 = await yVault.pricePerShare();
    const daiBalance2 = await ts.daiToken.balanceOf(deployer.address);

    console.log(`Price: ${price2}, Balance: ${daiBalance2}`);


  });
});

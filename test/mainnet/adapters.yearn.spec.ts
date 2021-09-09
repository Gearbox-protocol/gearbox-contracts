/*
 * SPDX-License-Identifier: BSL-1.1
 * Gearbox. Generalized leverage protocol, which allows to take leverage and then use it across other DeFi protocols and platforms in a composable way.
 * (c) Gearbox.fi, 2021
 */

// @ts-ignore
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { expect } from "../../utils/expect";

import {
  CurveV1Adapter__factory,
  Errors,
  YearnAdapter__factory,
} from "../../types/ethers-v5";
import { TestDeployer } from "../../deployer/testDeployer";
import { CURVE_3POOL_ADDRESS, MainnetSuite, YEARN_DAI_ADDRESS } from "./helper";
import { MAX_INT, PERCENTAGE_FACTOR, WAD } from "@diesellabs/gearbox-sdk";
import { BigNumber } from "ethers";
import { LEVERAGE_DECIMALS } from "../../core/constants";
import { tokenDataByNetwork } from "../../core/token";
import { ERC20__factory } from "@diesellabs/gearbox-sdk/lib/types";
import { CurveHelper } from "../../integrations/curveHelper";
import { YearnHelper } from "../../integrations/yearnHelper";

describe("YEARN adapter", function () {
  this.timeout(0);

  const daiLiquidity = BigNumber.from(10000).mul(WAD);
  const ethLiquidity = BigNumber.from(50).mul(WAD);
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
    const accounts = (await ethers.getSigners()) as Array<SignerWithAddress>;
    deployer = accounts[0];
    user = accounts[1];
    liquidator = accounts[2];
    friend = accounts[3];

    const testDeployer = new TestDeployer();
    errors = await testDeployer.getErrors();
    const r1 = await ts.daiToken.approve(ts.creditManagerDAI.address, MAX_INT);
    await r1.wait();
    const r2 = await ts.daiToken.approve(ts.poolDAI.address, MAX_INT);
    await r2.wait();
    const r3 = await ts.poolDAI.addLiquidity(daiLiquidity, deployer.address, 3);
    await r3.wait();
    const r4 = await ts.daiToken.approve(ts.leveragedActions.address, MAX_INT);
    await r4.wait();

    const poolAmount = await ts.poolETH.availableLiquidity();

    if (poolAmount.lt(ethLiquidity)) {
      const r5 = await ts.wethGateway.addLiquidityETH(
        ts.poolETH.address,
        deployer.address,
        2,
        { value: ethLiquidity.sub(poolAmount) }
      );
      await r5.wait();
    }
  });

  const openUserAccount = async () => {
    const amountOnAccount = accountAmount
      .mul(leverageFactor + LEVERAGE_DECIMALS)
      .div(LEVERAGE_DECIMALS);

    const adapter = await ts.creditFilterDAI.contractToAdapter(
      YEARN_DAI_ADDRESS
    );

    const yearnHelper = await YearnHelper.getHelper(
      YEARN_DAI_ADDRESS,
      deployer
    );

    const r1 = await ts.creditManagerDAI.openCreditAccount(
      accountAmount,
      user.address,
      leverageFactor,
      referralCode
    );
    await r1.wait();

    const creditAccount = await ts.creditManagerDAI.getCreditAccountOrRevert(
      user.address
    );

    expect(
      (await ts.daiToken.balanceOf(creditAccount)).sub(amountOnAccount),
      "openUserAccount amountOnAccount"
    ).to.be.lte(2);

    const adapterContract = YearnAdapter__factory.connect(adapter, user);

    const yDAItoken = ERC20__factory.connect(YEARN_DAI_ADDRESS, deployer);

    return {
      amountOnAccount,
      creditAccount,
      yearnHelper,
      adapter: adapterContract,
      yDAItoken,
    };
  };

  const repayUserAccount = async (amountOnAccount: BigNumber) => {
    await ts.daiToken.transfer(user.address, amountOnAccount);
    await ts.daiToken
      .connect(user)
      .approve(ts.creditManagerDAI.address, MAX_INT);

    await ts.creditManagerDAI.connect(user).repayCreditAccount(friend.address);
  };

  it("[YA-1]: deposit() converts whole DAI amount to yDAI", async () => {
    const { amountOnAccount, creditAccount, yearnHelper, adapter, yDAItoken } =
      await openUserAccount();

    const yDAIAmount = await yearnHelper.getExpectedAmount(
      "ExactTokensToTokens",
      [tokenDataByNetwork.Mainnet.DAI.address, YEARN_DAI_ADDRESS],
      amountOnAccount
    );

    const r2 = await adapter["deposit()"]();
    await r2.wait();

    expect(await ts.daiToken.balanceOf(creditAccount)).to.be.eq(0);

    expect(
      (await yDAItoken.balanceOf(creditAccount))
        .mul(PERCENTAGE_FACTOR)
        .div(yDAIAmount)
        .sub(PERCENTAGE_FACTOR)
        .abs()
    ).lte(2);

    await repayUserAccount(amountOnAccount);
  });

  for (let func of ["deposit(uint256)", "deposit(uint256,address)"]) {
    it(`[YA-2]: ${func} converts exact DAI amount to yDAI`, async () => {
      const {
        amountOnAccount,
        creditAccount,
        yearnHelper,
        adapter,
        yDAItoken,
      } = await openUserAccount();

      const amountToDeposit = amountOnAccount.div(2);

      const yDAIAmount = await yearnHelper.getExpectedAmount(
        "ExactTokensToTokens",
        [tokenDataByNetwork.Mainnet.DAI.address, YEARN_DAI_ADDRESS],
        amountToDeposit
      );

      const r2 =
        func === "deposit(uint256)"
          ? await adapter["deposit(uint256)"](amountToDeposit)
          : await adapter["deposit(uint256,address)"](
              amountToDeposit,
              friend.address
            );
      await r2.wait();

      expect(
        (await ts.daiToken.balanceOf(creditAccount))
          .sub(amountOnAccount.sub(amountToDeposit))
          .abs()
      ).to.be.lte(2);

      expect(
        (await yDAItoken.balanceOf(creditAccount))
          .mul(PERCENTAGE_FACTOR)
          .div(yDAIAmount)
          .sub(PERCENTAGE_FACTOR)
          .abs()
      ).lte(2);

      await repayUserAccount(amountOnAccount);
    });
  }

  it("[YA-3]: withdraw() converts whole yDAI amount to DAI", async () => {
    const { amountOnAccount, creditAccount, yearnHelper, adapter, yDAItoken } =
      await openUserAccount();

    const amountToDeposit = amountOnAccount.div(2);

    const expected_yDAIAmount = await yearnHelper.getExpectedAmount(
      "ExactTokensToTokens",
      [tokenDataByNetwork.Mainnet.DAI.address, YEARN_DAI_ADDRESS],
      amountToDeposit
    );

    const r2 = await adapter["deposit(uint256)"](amountToDeposit);
    await r2.wait();

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

    console.log((await adapter.balanceOf(creditAccount)).toString());

    const daiBalance2 = await ts.daiToken.balanceOf(creditAccount);

    expect(
      daiBalance2
        .mul(PERCENTAGE_FACTOR)
        .div(amountOnAccount)
        .sub(PERCENTAGE_FACTOR),
      "DAI balance after withdraw"
    ).to.be.lte(2);

    await repayUserAccount(amountOnAccount);
  });
});

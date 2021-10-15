/*
 * SPDX-License-Identifier: BSL-1.1
 * Gearbox. Generalized leverage protocol, which allows to take leverage and then use it across other DeFi protocols and platforms in a composable way.
 * (c) Gearbox.fi, 2021
 */

// @ts-ignore
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { expect } from "../../utils/expect";

import { Errors, YearnAdapter } from "../../types/ethers-v5";
import { TestDeployer } from "../../deployer/testDeployer";
import { MainnetSuite } from "./helper";
import { LEVERAGE_DECIMALS, MAX_INT, WAD } from "@diesellabs/gearbox-sdk";
import { BigNumber } from "ethers";


describe("CreditManager test (Mainnet test)", function () {
  this.timeout(0);

  const daiLiquidity = BigNumber.from(10000).mul(WAD);
  const accountAmount = BigNumber.from(100).mul(WAD);
  const leverageFactor = 4 * LEVERAGE_DECIMALS;

  let ts: MainnetSuite;
  let deployer: SignerWithAddress;
  let user: SignerWithAddress;
  let liquidator: SignerWithAddress;
  let friend: SignerWithAddress;

  let errors: Errors;
  let yAdapter: YearnAdapter;

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
  });

  it("M:[CM-1]: it opens creditAccount correctly", async function () {
    const poolBalance = await ts.daiToken.balanceOf(ts.poolDAI.address);

    await ts.creditManagerDAI.openCreditAccount(
      accountAmount,
      deployer.address,
      leverageFactor,
      4
    );

    expect(await ts.daiToken.balanceOf(ts.poolDAI.address)).to.be.eq(
      poolBalance.sub(accountAmount.mul(leverageFactor).div(LEVERAGE_DECIMALS))
    );

    expect(await ts.creditManagerDAI.hasOpenedCreditAccount(deployer.address))
      .to.be.true;

    const creditAccount = await ts.creditManagerDAI.getCreditAccountOrRevert(
      deployer.address
    );

    const balanceExpected = accountAmount
      .mul(leverageFactor + LEVERAGE_DECIMALS)
      .div(LEVERAGE_DECIMALS)

    expect((await ts.daiToken.balanceOf(creditAccount)).sub(balanceExpected)).to.be.lte(2

    );

    await ts.creditManagerDAI.repayCreditAccount(deployer.address)
  });
});

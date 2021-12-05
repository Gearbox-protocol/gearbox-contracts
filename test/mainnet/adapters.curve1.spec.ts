/*
 * SPDX-License-Identifier: BSL-1.1
 * Gearbox. Generalized leverage protocol, which allows to take leverage and then use it across other DeFi protocols and platforms in a composable way.
 * (c) Gearbox.fi, 2021
 */

import { CurveHelper } from "@diesellabs/gearbox-leverage";
import {
  CURVE_3POOL_ADDRESS,
  LEVERAGE_DECIMALS,
  MAX_INT,
  SwapType,
  tokenDataByNetwork,
  WAD
} from "@diesellabs/gearbox-sdk";
import { ERC20__factory } from "@diesellabs/gearbox-sdk/lib/types";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { BigNumber } from "ethers";
import { TestDeployer } from "../../deployer/testDeployer";
import {
  CurveV1Adapter__factory,
  Errors,
  ICurvePool__factory
} from "../../types/ethers-v5";
import { expect } from "../../utils/expect";
import { waitForTransaction } from "../../utils/transaction";
import { MainnetSuite } from "./helper";


describe("CurveV1 adapter (Mainnet test)", function () {
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

    await waitForTransaction(ts.daiToken.transfer(user.address, accountAmount));

  });

  it("[CVA-1]: exchange works", async () => {
    await waitForTransaction(ts.creditManagerDAI
      .connect(user)
      .openCreditAccount(
        accountAmount,
        user.address,
        leverageFactor,
        referralCode
      ));


    const amountOnAccount = accountAmount
      .mul(leverageFactor + LEVERAGE_DECIMALS)
      .div(LEVERAGE_DECIMALS);

    const adapter = await ts.creditFilterDAI.contractToAdapter(
      CURVE_3POOL_ADDRESS
    );

    const curveHelper = await CurveHelper.getHelper(
      "CurveAdapter",
      CURVE_3POOL_ADDRESS,
      adapter,
      3,
      deployer
    );

    const minUSDCAmount = await curveHelper.getExpectedAmount(
      SwapType.ExactInput,
      [
        tokenDataByNetwork.Mainnet.DAI.address,
        tokenDataByNetwork.Mainnet.USDC.address,
      ],
      amountOnAccount
    );

    const creditAccount = await ts.creditManagerDAI.getCreditAccountOrRevert(
      user.address
    );

    expect(
      (await ts.daiToken.balanceOf(creditAccount)).sub(amountOnAccount).abs()
    ).to.be.lte(2);

    const adapterContract = CurveV1Adapter__factory.connect(adapter, user);

    await waitForTransaction(adapterContract.exchange(
      curveHelper.getIndex(tokenDataByNetwork.Mainnet.DAI.address),
      curveHelper.getIndex(tokenDataByNetwork.Mainnet.USDC.address),
      amountOnAccount,
      0
    ));

    expect(await ts.daiToken.balanceOf(creditAccount)).to.be.lte(2);

    const usdcToken = ERC20__factory.connect(
      tokenDataByNetwork.Mainnet.USDC.address,
      deployer
    );

    expect(await usdcToken.balanceOf(creditAccount)).to.be.gte(minUSDCAmount);

    await waitForTransaction(ts.daiToken.transfer(user.address, amountOnAccount));
    await waitForTransaction(ts.daiToken
      .connect(user)
      .approve(ts.creditManagerDAI.address, MAX_INT));

    await waitForTransaction(ts.creditManagerDAI.connect(user).repayCreditAccount(friend.address));
  });

  it("[CVA-2]: coins, get_dy_underlying, get_dy, get_virtual_price() returns the same values as original pool ", async () => {
    const adapter = CurveV1Adapter__factory.connect(
      await ts.creditFilterDAI.contractToAdapter(CURVE_3POOL_ADDRESS),
      deployer
    );

    const pool = await ICurvePool__factory.connect(
      CURVE_3POOL_ADDRESS,
      deployer
    );

    for (let i = 0; i < 3; i++) {
      expect(await adapter.coins(i)).to.be.eq(await pool.coins(i));
    }

    expect(await adapter.get_dy(0, 1, WAD)).to.be.eq(
      await pool.get_dy(0, 1, WAD)
    );
    expect(await adapter.get_dy_underlying(0, 1, WAD)).to.be.eq(
      await pool.get_dy_underlying(0, 1, WAD)
    );
    expect(await adapter.get_virtual_price()).to.be.eq(
      await pool.get_virtual_price()
    );
  });
});

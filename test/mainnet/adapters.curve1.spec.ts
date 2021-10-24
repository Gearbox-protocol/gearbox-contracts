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
  ICurvePool__factory,
} from "../../types/ethers-v5";
import { TestDeployer } from "../../deployer/testDeployer";
import { MainnetSuite } from "./helper";
import {
  CURVE_3POOL_ADDRESS,
  LEVERAGE_DECIMALS,
  MAX_INT,
  SwapType,
  tokenDataByNetwork,
  UNISWAP_V3_ROUTER,
  WAD,
} from "@diesellabs/gearbox-sdk";
import { BigNumber } from "ethers";
import { ERC20__factory } from "@diesellabs/gearbox-sdk/lib/types";
import { CurveHelper } from "@diesellabs/gearbox-leverage";

describe("CurveV1 adapter (Mainnet test)", function () {
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
    const r1 = await ts.daiToken.connect(user).approve(ts.creditManagerDAI.address, MAX_INT);
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

    const r6 = await ts.daiToken.transfer(user.address, accountAmount);
    await r6.wait();
  });

  it("[CVA-1]: exchange works", async () => {
    const r1 = await ts.creditManagerDAI
      .connect(user)
      .openCreditAccount(
        accountAmount,
        user.address,
        leverageFactor,
        referralCode
      );
    await r1.wait();

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

    await adapterContract.exchange(
      curveHelper.getIndex(tokenDataByNetwork.Mainnet.DAI.address),
      curveHelper.getIndex(tokenDataByNetwork.Mainnet.USDC.address),
      amountOnAccount,
      0
    );

    expect(await ts.daiToken.balanceOf(creditAccount)).to.be.lte(2);

    const usdcToken = ERC20__factory.connect(
      tokenDataByNetwork.Mainnet.USDC.address,
      deployer
    );

    expect(await usdcToken.balanceOf(creditAccount)).to.be.gte(minUSDCAmount);

    await ts.daiToken.transfer(user.address, amountOnAccount);
    await ts.daiToken
      .connect(user)
      .approve(ts.creditManagerDAI.address, MAX_INT);

    await ts.creditManagerDAI.connect(user).repayCreditAccount(friend.address);
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

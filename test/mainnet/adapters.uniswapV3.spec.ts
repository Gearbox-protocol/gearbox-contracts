/*
 * SPDX-License-Identifier: BSL-1.1
 * Gearbox. Generalized leverage protocol, which allows to take leverage and then use it across other DeFi protocols and platforms in a composable way.
 * (c) Gearbox.fi, 2021
 */

// @ts-ignore
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { expect } from "../../utils/expect";

import { Errors, UniswapV3Adapter__factory } from "../../types/ethers-v5";
import { TestDeployer } from "../../deployer/testDeployer";
import { MainnetSuite } from "./helper";
import {
  ADDRESS_0x0,
  LEVERAGE_DECIMALS,
  MAX_INT,
  SwapType,
  tokenDataByNetwork,
  UNISWAP_V3_QUOTER,
  UNISWAP_V3_ROUTER,
  WAD,
  WETHToken,
} from "@diesellabs/gearbox-sdk";
import { BigNumber } from "ethers";
import { UniV3helper } from "@diesellabs/gearbox-leverage";
import { waitForTransaction } from "../../utils/transaction";

describe("UniswapV3 adapter (Mainnet test)", function () {
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
   
    await waitForTransaction(ts.daiToken
      .connect(user)
      .approve(UNISWAP_V3_ROUTER, MAX_INT));

  });

  const openUserAccount = async () => {
    const amountOnAccount = accountAmount
      .mul(leverageFactor + LEVERAGE_DECIMALS)
      .div(LEVERAGE_DECIMALS);

    const adapter = await ts.creditFilterDAI.contractToAdapter(
      UNISWAP_V3_ROUTER
    );

    const uniV3Helper = await UniV3helper.getHelper(
      "UniswapV3",
      UNISWAP_V3_ROUTER,
      adapter,
      UNISWAP_V3_QUOTER,
      ADDRESS_0x0,
      deployer
    );

    await waitForTransaction(ts.daiToken.transfer(user.address, accountAmount));


    await waitForTransaction(ts.creditManagerDAI
      .connect(user)
      .openCreditAccount(
        accountAmount,
        user.address,
        leverageFactor,
        referralCode
      ));


    const creditAccount = await ts.creditManagerDAI.getCreditAccountOrRevert(
      user.address
    );

    expect(
      (await ts.daiToken.balanceOf(creditAccount)).sub(amountOnAccount),
      "openUserAccount amountOnAccount"
    ).to.be.lte(2);

    const adapterContract = UniswapV3Adapter__factory.connect(adapter, user);
    const router = UniswapV3Adapter__factory.connect(UNISWAP_V3_ROUTER, user);

    return {
      amountOnAccount,
      creditAccount,
      uniV3Helper,
      adapter: adapterContract,
      router,
    };
  };

  it("[UV3-1]: exactInput works correctly", async () => {
    const { amountOnAccount, creditAccount, uniV3Helper, adapter, router } =
      await openUserAccount();

    const path = [tokenDataByNetwork.Mainnet.DAI.address, WETHToken.Mainnet];

    const ethAmount = await uniV3Helper.getExpectedAmount(
      SwapType.ExactInput,
      path,
      amountOnAccount
    );

    const params = {
      amountIn: amountOnAccount,
      amountOutMinimum: ethAmount,
      path: UniV3helper.pathToUniV3Path(path),
      recipient: friend.address,
      deadline: UniV3helper.getDeadline(),
    };

    // Check correct return result
    const expectedAmountAdapter = await adapter.callStatic.exactInput(params);
    const expectedAmountRouter = await router
      .connect(user)
      .callStatic.exactInput(params);
    expect(expectedAmountAdapter).to.be.eq(expectedAmountRouter);

    await waitForTransaction(adapter.exactInput(params));

    expect(await ts.daiToken.balanceOf(creditAccount)).to.be.lte(2);
    expect(await ts.wethToken.balanceOf(creditAccount)).to.be.gte(ethAmount);

    await ts.repayUserAccount(amountOnAccount);
  });

  it("[UV3-2]: exactInputSingle works correctly", async () => {
    const { amountOnAccount, creditAccount, uniV3Helper, adapter, router } =
      await openUserAccount();

    const path = [tokenDataByNetwork.Mainnet.DAI.address, WETHToken.Mainnet];

    const ethAmount = await uniV3Helper.getExpectedAmount(
      SwapType.ExactInput,
      path,
      amountOnAccount
    );

    const params = {
      tokenIn: path[0],
      tokenOut: path[1],
      amountIn: amountOnAccount,
      amountOutMinimum: ethAmount,
      fee: 3000,
      recipient: friend.address,
      deadline: UniV3helper.getDeadline(),
      sqrtPriceLimitX96: 0,
    };

    const expectedAmountAdapter = await adapter.callStatic.exactInputSingle(
      params
    );

    const expectedAmountRouter = await router
      .connect(user)
      .callStatic.exactInputSingle(params);

    expect(expectedAmountAdapter).to.be.eq(expectedAmountRouter);

    const r2 = await adapter.exactInputSingle(params);
    await r2.wait();

    expect(await ts.daiToken.balanceOf(creditAccount)).to.be.lte(2);
    expect(await ts.wethToken.balanceOf(creditAccount)).to.be.gte(ethAmount);

    await ts.repayUserAccount(amountOnAccount);
  });

  it("[UV3-3]: exactOutput works correctly", async () => {
    const { amountOnAccount, creditAccount, uniV3Helper, adapter, router } =
      await openUserAccount();

    const path = [tokenDataByNetwork.Mainnet.DAI.address, WETHToken.Mainnet];

    const ethAmount = await uniV3Helper.getExpectedAmount(
      SwapType.ExactInput,
      path,
      amountOnAccount
    );

    const ethAmountOut = ethAmount.mul(90).div(100);

    const params = {
      amountInMaximum: amountOnAccount,
      amountOut: ethAmountOut,
      path: UniV3helper.pathToUniV3Path(path.reverse()),
      recipient: friend.address,
      deadline: UniV3helper.getDeadline(),
    };

    // Check correct return result
    const expectedAmountAdapter = await adapter.callStatic.exactOutput(params);
    const expectedAmountRouter = await router
      .connect(user)
      .callStatic.exactOutput(params);
    expect(expectedAmountAdapter).to.be.eq(expectedAmountRouter);

    const r2 = await adapter.exactOutput(params);
    await r2.wait();

    expect(await ts.daiToken.balanceOf(creditAccount)).to.be.lte(
      amountOnAccount.div(2)
    );

    expect(
      ethAmountOut.sub(await ts.wethToken.balanceOf(creditAccount)).abs()
    ).to.be.lte(2);

    await ts.repayUserAccount(amountOnAccount);
  });

  it("[UV3-4]: exactOutputSingle works correctly", async () => {
    const { amountOnAccount, creditAccount, uniV3Helper, adapter, router } =
      await openUserAccount();

    const path = [tokenDataByNetwork.Mainnet.DAI.address, WETHToken.Mainnet];

    const ethAmount = await uniV3Helper.getExpectedAmount(
      SwapType.ExactInput,
      path,
      amountOnAccount
    );

    const ethAmountOut = ethAmount.mul(90).div(100);

    const params = {
      amountOut: ethAmountOut,
      amountInMaximum: amountOnAccount,
      tokenIn: path[0],
      tokenOut: path[1],
      fee: 3000,
      recipient: friend.address,
      deadline: UniV3helper.getDeadline(),
      sqrtPriceLimitX96: 0,
    };

    // Check correct return result
    const expectedAmountAdapter = await adapter.callStatic.exactOutputSingle(
      params
    );
    const expectedAmountRouter = await router
      .connect(user)
      .callStatic.exactOutputSingle(params);
    expect(expectedAmountAdapter).to.be.eq(expectedAmountRouter);

    const r2 = await adapter.exactOutputSingle(params);
    await r2.wait();

    expect(await ts.daiToken.balanceOf(creditAccount)).to.be.lte(
      amountOnAccount.div(2)
    );

    expect(
      ethAmountOut.sub(await ts.wethToken.balanceOf(creditAccount)).abs()
    ).to.be.lte(2);

    await ts.repayUserAccount(amountOnAccount);
  });
});

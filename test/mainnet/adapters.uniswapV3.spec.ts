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
import { MainnetSuite, UNISWAP_V3_QUOTER, UNISWAP_V3_ROUTER } from "./helper";
import { MAX_INT, WAD } from "@diesellabs/gearbox-sdk";
import { BigNumber } from "ethers";
import { LEVERAGE_DECIMALS } from "../../core/constants";
import { tokenDataByNetwork, WETHToken } from "../../core/token";
import { UniV3helper } from "../../integrations/uniV3helper";

describe("UniswapV3 adapter", function () {
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
      UNISWAP_V3_ROUTER
    );

    const uniV3Helper = await UniV3helper.getHelper(
      UNISWAP_V3_ROUTER,
      UNISWAP_V3_QUOTER,
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

    const adapterContract = UniswapV3Adapter__factory.connect(adapter, user);

    return {
      amountOnAccount,
      creditAccount,
      uniV3Helper,
      adapter: adapterContract,
    };
  };

  const repayUserAccount = async (amountOnAccount: BigNumber) => {
    await ts.daiToken.transfer(user.address, amountOnAccount);
    await ts.daiToken
      .connect(user)
      .approve(ts.creditManagerDAI.address, MAX_INT);

    await ts.creditManagerDAI.connect(user).repayCreditAccount(friend.address);
  };

  it("[UV3-1]: exactInput works correctly", async () => {
    const { amountOnAccount, creditAccount, uniV3Helper, adapter } =
      await openUserAccount();

    const path = [tokenDataByNetwork.Mainnet.DAI.address, WETHToken.Mainnet];

    const ethAmount = await uniV3Helper.getExpectedAmount(
      "ExactTokensToTokens",
      path,
      amountOnAccount
    );

    const r2 = await adapter.exactInput({
      amountIn: amountOnAccount,
      amountOutMinimum: ethAmount,
      path: UniV3helper.pathToUniV3Path(path),
      recipient: friend.address,
      deadline: UniV3helper.getDeadline(),
    });
    await r2.wait();

    expect(await ts.daiToken.balanceOf(creditAccount)).to.be.lte(2);
    expect(await ts.wethToken.balanceOf(creditAccount)).to.be.gte(ethAmount);

    await repayUserAccount(amountOnAccount);
  });

  it("[UV3-2]: exactInputSingle works correctly", async () => {
    const { amountOnAccount, creditAccount, uniV3Helper, adapter } =
      await openUserAccount();

    const path = [tokenDataByNetwork.Mainnet.DAI.address, WETHToken.Mainnet];

    const ethAmount = await uniV3Helper.getExpectedAmount(
      "ExactTokensToTokens",
      path,
      amountOnAccount
    );

    const r2 = await adapter.exactInputSingle({
      tokenIn: path[0],
      tokenOut: path[1],
      amountIn: amountOnAccount,
      amountOutMinimum: ethAmount,
      fee: 3000,
      recipient: friend.address,
      deadline: UniV3helper.getDeadline(),
      sqrtPriceLimitX96: 0,
    });
    await r2.wait();

    expect(await ts.daiToken.balanceOf(creditAccount)).to.be.lte(2);
    expect(await ts.wethToken.balanceOf(creditAccount)).to.be.gte(ethAmount);

    await repayUserAccount(amountOnAccount);
  });

  it("[UV3-3]: exactOutput works correctly", async () => {
    const { amountOnAccount, creditAccount, uniV3Helper, adapter } =
      await openUserAccount();

    const path = [tokenDataByNetwork.Mainnet.DAI.address, WETHToken.Mainnet];

    const ethAmount = await uniV3Helper.getExpectedAmount(
      "ExactTokensToTokens",
      path,
      amountOnAccount
    );

    const ethAmountOut = ethAmount.mul(90).div(100);

    const r2 = await adapter.exactOutput({
      amountInMaximum: amountOnAccount,
      amountOut: ethAmountOut,
      path: UniV3helper.pathToUniV3Path(path.reverse()),
      recipient: friend.address,
      deadline: UniV3helper.getDeadline(),
    });
    await r2.wait();

    expect(await ts.daiToken.balanceOf(creditAccount)).to.be.lte(
      amountOnAccount.div(2)
    );

    expect(
      ethAmountOut.sub(await ts.wethToken.balanceOf(creditAccount)).abs()
    ).to.be.lte(2);

    await repayUserAccount(amountOnAccount);
  });

  it("[UV3-4]: exactOutputSingle works correctly", async () => {
    const { amountOnAccount, creditAccount, uniV3Helper, adapter } =
      await openUserAccount();

    const path = [tokenDataByNetwork.Mainnet.DAI.address, WETHToken.Mainnet];

    const ethAmount = await uniV3Helper.getExpectedAmount(
      "ExactTokensToTokens",
      path,
      amountOnAccount
    );

    const ethAmountOut = ethAmount.mul(90).div(100);

    const r2 = await adapter.exactOutputSingle({
      amountOut: ethAmountOut,
      amountInMaximum: amountOnAccount,
      tokenIn: path[0],
      tokenOut: path[1],
      fee: 3000,
      recipient: friend.address,
      deadline: UniV3helper.getDeadline(),
      sqrtPriceLimitX96: 0,
    });
    await r2.wait();

    expect(await ts.daiToken.balanceOf(creditAccount)).to.be.lte(
      amountOnAccount.div(2)
    );

    expect(
      ethAmountOut.sub(await ts.wethToken.balanceOf(creditAccount)).abs()
    ).to.be.lte(2);

    await repayUserAccount(amountOnAccount);
  });
});

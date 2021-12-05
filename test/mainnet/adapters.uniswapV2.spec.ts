/*
 * SPDX-License-Identifier: BSL-1.1
 * Gearbox. Generalized leverage protocol, which allows to take leverage and then use it across other DeFi protocols and platforms in a composable way.
 * (c) Gearbox.fi, 2021
 */

// @ts-ignore
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { expect } from "../../utils/expect";

import { Errors, UniswapV2Adapter__factory } from "../../types/ethers-v5";
import { TestDeployer } from "../../deployer/testDeployer";
import { MainnetSuite } from "./helper";
import {
  ADDRESS_0x0,
  CURVE_3POOL_ADDRESS,
  LEVERAGE_DECIMALS,
  MAX_INT,
  SwapType,
  tokenDataByNetwork,
  UNISWAP_V2_ROUTER,
  WAD,
  WETHToken,
} from "@diesellabs/gearbox-sdk";
import { BigNumber } from "ethers";
import { UniV2helper } from "@diesellabs/gearbox-leverage";
import { waitForTransaction } from "../../utils/transaction";

describe("UniswapV2 adapter (Mainnet test)", function () {
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
      .approve(UNISWAP_V2_ROUTER, MAX_INT));


    await waitForTransaction(ts.daiToken.transfer(user.address, accountAmount.mul(20)));

  });

  const openUserAccount = async () => {
    const amountOnAccount = accountAmount
      .mul(leverageFactor + LEVERAGE_DECIMALS)
      .div(LEVERAGE_DECIMALS);

    const adapter = await ts.creditFilterDAI.contractToAdapter(
      UNISWAP_V2_ROUTER
    );

    const uniV2Helper = await UniV2helper.getHelper(
      "UniswapV2",
      UNISWAP_V2_ROUTER,
      adapter,
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
    ).to.be.lte(1);

    const router = UniswapV2Adapter__factory.connect(UNISWAP_V2_ROUTER, user);
    const adapterContract = UniswapV2Adapter__factory.connect(adapter, user);

    return {
      amountOnAccount,
      creditAccount,
      uniV2Helper,
      router,
      adapter: adapterContract,
    };
  };

  it("[UV2-1]: swapExactTokenToTokens works correctly", async () => {
    const { amountOnAccount, creditAccount, uniV2Helper, adapter, router } =
      await openUserAccount();

    const path = [tokenDataByNetwork.Mainnet.DAI.address, WETHToken.Mainnet];

    const ethAmount = await uniV2Helper.getExpectedAmount(
      SwapType.ExactInput,
      path,
      amountOnAccount
    );

    const expectAmountsRouter = await router
      .connect(user)
      .callStatic.swapExactTokensForTokens(
        amountOnAccount,
        ethAmount,
        path,
        friend.address,
        UniV2helper.getDeadline()
      );

    const expectAmountsAdapter = await adapter
      .connect(user)
      .callStatic.swapExactTokensForTokens(
        amountOnAccount,
        ethAmount,
        path,
        friend.address,
        UniV2helper.getDeadline()
      );

    expect(expectAmountsRouter).to.be.eql(expectAmountsAdapter);

    await waitForTransaction(adapter.swapExactTokensForTokens(
      amountOnAccount,
      ethAmount,
      path,
      friend.address,
      UniV2helper.getDeadline()
    ));

    expect(await ts.daiToken.balanceOf(creditAccount)).to.be.lte(1);
    expect(await ts.wethToken.balanceOf(creditAccount)).to.be.gte(ethAmount);

    await ts.repayUserAccount(amountOnAccount);
  });

  it("[UV2-2]: swapExactTokenToTokens works correctly", async () => {
    const { amountOnAccount, creditAccount, uniV2Helper, adapter, router } =
      await openUserAccount();

    const path = [tokenDataByNetwork.Mainnet.DAI.address, WETHToken.Mainnet];

    const ethAmount = await uniV2Helper.getExpectedAmount(
      SwapType.ExactInput,
      path,
      amountOnAccount
    );

    const ethAmountExpected = ethAmount.mul(99).div(100);

    const amountToSwap = await uniV2Helper.getExpectedAmount(
      SwapType.ExactOutput,
      path,
      ethAmountExpected
    );

    const expectAmountsRouter = await router
      .connect(user)
      .callStatic.swapTokensForExactTokens(
        ethAmountExpected,
        amountToSwap,
        path,
        friend.address,
        UniV2helper.getDeadline()
      );

    const expectAmountsAdapter = await adapter
      .connect(user)
      .callStatic.swapTokensForExactTokens(
        ethAmountExpected,
        amountToSwap,
        path,
        friend.address,
        UniV2helper.getDeadline()
      );

    expect(expectAmountsRouter).to.be.eql(expectAmountsAdapter);

    await waitForTransaction(adapter.swapTokensForExactTokens(
      ethAmountExpected,
      amountToSwap,
      path,
      friend.address,
      UniV2helper.getDeadline()
    ));


    expect(
      amountOnAccount.sub(await ts.daiToken.balanceOf(creditAccount))
    ).to.be.lte(amountToSwap);
    expect(
      ethAmountExpected.sub(await ts.wethToken.balanceOf(creditAccount))
    ).to.be.lte(2);

    await ts.repayUserAccount(amountOnAccount);
  });
});

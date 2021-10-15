/*
 * SPDX-License-Identifier: BSL-1.1
 * Gearbox. Generalized leverage protocol, which allows to take leverage and then use it across other DeFi protocols and platforms in a composable way.
 * (c) Gearbox.fi, 2021
 */

import { expect } from "../utils/expect";

import { CreditManager, Errors, TokenMock, UniswapV2Adapter } from "../types/ethers-v5";
import { BigNumber } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { DUMB_ADDRESS } from "../core/constants";
import { UniswapModel } from "../model/uniswapModel";
import { CreditManagerTestSuite } from "../deployer/creditManagerTestSuite";
import { RAY } from "@diesellabs/gearbox-sdk";

const {
  amount,
  borrowedAmount,
  swapAmountA,
  swapAmountB,
} = CreditManagerTestSuite;

describe("UniswapV2 Adapter (Unit test)", function () {
  let ts: CreditManagerTestSuite;

  let deployer: SignerWithAddress;
  let user: SignerWithAddress;
  let friend: SignerWithAddress;

  let creditManager: CreditManager;

  let underlyingToken: TokenMock;

  let uniswapModel: UniswapModel;
  let uniswapV2Adapter: UniswapV2Adapter;

  let tokenA: TokenMock;
  let errors: Errors;

  beforeEach(async function () {
    ts = new CreditManagerTestSuite();
    await ts.getSuite();
    await ts.setupCreditManager();
    await ts.setupUniswapV2Adapter();

    deployer = ts.deployer;
    user = ts.user;
    friend = ts.friend;

    creditManager = ts.creditManager;
    uniswapV2Adapter = ts.uniswapV2adapter;

    underlyingToken = ts.underlyingToken;

    tokenA = ts.tokenA;
    errors = ts.errors;

    uniswapModel = new UniswapModel();

    uniswapModel.setRate(underlyingToken.address, tokenA.address, RAY.mul(10));
  });

  const getCreditAccountTokenBalance = async (
    borrower: string,
    token: string
  ) => {
    const va = await creditManager.creditAccounts(borrower);
    const tMock = await ts.testDeployer.connectToken(token);
    return await tMock.balanceOf(va);
  };

  it("[UV2A-2]: swapTokensForExactTokens, swapTokensForExactTokens reverts if user hasn't opened account", async function () {
    const revertMsg = await errors.CM_NO_OPEN_ACCOUNT();
    // Adding liquidity to be able to open credit account
    // Open default credit account
    await expect(
      uniswapV2Adapter
        .connect(user)
        .swapTokensForExactTokens(
          100,
          100,
          [underlyingToken.address, tokenA.address],
          DUMB_ADDRESS,
          await UniswapModel.getDeadline()
        )
    ).to.be.revertedWith(revertMsg);

    await expect(
      uniswapV2Adapter
        .connect(user)
        .swapExactTokensForTokens(
          100,
          100,
          [underlyingToken.address, tokenA.address],
          DUMB_ADDRESS,
          await UniswapModel.getDeadline()
        )
    ).to.be.revertedWith(revertMsg);
  });

  it("[UV2A-4]: swapTokensForExactTokens, swapTokensForExactTokens reverts for disallowed tokens", async function () {
    const revertMsg = await errors.CF_TOKEN_IS_NOT_ALLOWED();
    // Open default credit account
    await ts.openDefaultCreditAccount();

    await ts.uniswapMock.setRate(
      underlyingToken.address,
      ts.tokenForbidden.address,
      RAY
    );

    ts.tokenForbidden.transfer(ts.uniswapMock.address, swapAmountB);

    await
      expect(
      uniswapV2Adapter
        .connect(user)
        .swapTokensForExactTokens(
          100,
          100,
          [underlyingToken.address, ts.tokenForbidden.address],
          DUMB_ADDRESS,
          await UniswapModel.getDeadline()
        )
    ).to.be.revertedWith(revertMsg);

    await expect(
      uniswapV2Adapter
        .connect(user)
        .swapExactTokensForTokens(
          100,
          0,
          [underlyingToken.address, ts.tokenForbidden.address],
          DUMB_ADDRESS,
          await UniswapModel.getDeadline()
        )
    ).to.be.revertedWith(revertMsg);
  });

  it("[UV2A-5]: swapExactTokensForTokens correctly swap & update VA balances", async function () {
    // Open default credit account
    await ts.openDefaultCreditAccount();

    await uniswapV2Adapter
      .connect(user)
      .swapExactTokensForTokens(
        swapAmountA,
        0,
        [underlyingToken.address, tokenA.address],
        DUMB_ADDRESS,
        await UniswapModel.getDeadline()
      );

    const expectedTrade = uniswapModel.swapExactTokensForTokens(
      swapAmountA,
      BigNumber.from(0),
      [underlyingToken.address, tokenA.address]
    );

    if (expectedTrade.isReverted === true) {
      throw new Error("Unexpected revert");
    }

    const expectedBalanceB = expectedTrade.amounts[1];
    const expectedBalanceUnderlying = amount
      .add(borrowedAmount)
      .sub(expectedTrade.amounts[0]);

    expect(
      await getCreditAccountTokenBalance(user.address, tokenA.address)
    ).to.be.eq(expectedBalanceB);
    expect(
      await getCreditAccountTokenBalance(user.address, underlyingToken.address)
    ).to.be.eq(expectedBalanceUnderlying);
  });

  it("[UV2A-6]: swapTokensForExactTokens correctly swap & update VA balances", async function () {
    // Open default credit account
    await ts.openDefaultCreditAccount();

    await uniswapV2Adapter.connect(user).swapTokensForExactTokens(
      swapAmountB,
      swapAmountA,

      [underlyingToken.address, tokenA.address],
      DUMB_ADDRESS,
      await UniswapModel.getDeadline()
    );

    const expectedTrade = uniswapModel.swapTokensForExactTokens(
      swapAmountB,
      swapAmountA,
      [underlyingToken.address, tokenA.address]
    );

    if (expectedTrade.isReverted === true) {
      throw new Error("Unexpected revert");
    }

    const expectedBalanceB = expectedTrade.amounts[1];
    const expectedBalanceUnderlying = amount
      .add(borrowedAmount)
      .sub(expectedTrade.amounts[0]);

    expect(
      await getCreditAccountTokenBalance(user.address, tokenA.address)
    ).to.be.eq(expectedBalanceB);
    expect(
      await getCreditAccountTokenBalance(user.address, underlyingToken.address)
    ).to.be.eq(expectedBalanceUnderlying);
  });

});

// @ts-ignore
import { ethers } from "hardhat";
import { BigNumber } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { arrayify } from "ethers/lib/utils";
import { ADDRESS_0x0, MAX_INT, RAY } from "@diesellabs/gearbox-sdk";
import { expect } from "../utils/expect";

import { TokenMock, UniswapRouterMock } from "../types/ethers-v5";

import { IntegrationsDeployer } from "../deployer/integrationsDeployer";
import { TestDeployer } from "../deployer/testDeployer";
import { UniswapModel } from "../model/uniswapModel";
import { UNISWAP_EXPIRED } from "../core/constants";

const initialSwapAmount = BigNumber.from(10).pow(18).mul(10000);
const initialUserAmount = BigNumber.from(10).pow(18).mul(8800);
const transferA = BigNumber.from(10).pow(8).mul(99);
const transferB = BigNumber.from(10).pow(8).mul(8);

describe("UniswapRouterMock", function () {
  let deployer: SignerWithAddress;
  let user: SignerWithAddress;
  let integrationsDeployer: IntegrationsDeployer;
  let testDeployer: TestDeployer;
  let uniswapMock: UniswapRouterMock;
  let uniswapModel: UniswapModel;

  let tokenA: TokenMock;
  let tokenB: TokenMock;

  beforeEach(async function () {
    deployer = (await ethers.getSigners())[0];
    user = (await ethers.getSigners())[1];

    integrationsDeployer = new IntegrationsDeployer();
    testDeployer = new TestDeployer();
    uniswapModel = new UniswapModel();

    uniswapMock = await integrationsDeployer.getUniswapLikeMock();

    tokenA = await testDeployer.getTokenMock("TokenA", "AAA");
    tokenB = await testDeployer.getTokenMock("TokenB", "BBB");

    // 1 tokenA costs 10 tokenB
    const rate_RAY = RAY.mul(10);
    await uniswapMock.setRate(tokenA.address, tokenB.address, rate_RAY);
    uniswapModel.setRate(tokenA.address, tokenB.address, rate_RAY);

    await tokenA.mint(user.address, initialUserAmount);
    await tokenB.mint(user.address, initialUserAmount);

    await tokenA.connect(user).approve(uniswapMock.address, MAX_INT);
    await tokenB.connect(user).approve(uniswapMock.address, MAX_INT);

    await tokenA.mint(uniswapMock.address, initialSwapAmount);
    await tokenB.mint(uniswapMock.address, initialSwapAmount);
  });

  it("it reverts with deadline < current timestamp", async function () {
    await expect(
      uniswapMock.connect(user).swapTokensForExactTokens(
        100,
        100,
        [tokenA.address, tokenB.address],
        user.address,
        // current unix timestamp -10
        await UniswapModel.getDeadline(-1)
      )
    ).to.be.revertedWith(UNISWAP_EXPIRED);
  });

  it("swapTokensForExactTokens transfers correct amounts of tokens", async function () {
    const deadline = await UniswapModel.getDeadline();

    const expectedResult = uniswapModel.swapTokensForExactTokens(
      transferB,
      transferA,
      [tokenA.address, tokenB.address]
    );
    if (expectedResult.isReverted === true) {
      throw new Error("Model is unexpectly reverts");
    }
    const amountIn = expectedResult.amounts[0];
    const amountOut = expectedResult.amounts[1];

    const userBalanceABefore = await tokenA.balanceOf(user.address);
    const userBalanceBBefore = await tokenB.balanceOf(user.address);

    const uniswapMockBalanceABefore = await tokenA.balanceOf(
      uniswapMock.address
    );
    const uniswapMockBalanceBBefore = await tokenB.balanceOf(
      uniswapMock.address
    );

    await uniswapMock
      .connect(user)
      .swapTokensForExactTokens(
        transferB,
        transferA,
        [tokenA.address, tokenB.address],
        user.address,
        deadline
      );

    expect(await tokenA.balanceOf(user.address)).to.be.eq(
      userBalanceABefore.sub(amountIn)
    );
    expect(await tokenB.balanceOf(user.address)).to.be.eq(
      userBalanceBBefore.add(amountOut)
    );

    expect(await tokenA.balanceOf(uniswapMock.address)).to.be.eq(
      uniswapMockBalanceABefore.add(amountIn)
    );
    expect(await tokenB.balanceOf(uniswapMock.address)).to.be.eq(
      uniswapMockBalanceBBefore.sub(amountOut)
    );
  });

  it("swapTokensForExactTokens reverts if excessive input amount", async function () {
    const deadline = await UniswapModel.getDeadline();
    await expect(
      uniswapMock
        .connect(user)
        .swapTokensForExactTokens(
          transferB,
          transferB,
          [tokenA.address, tokenB.address],
          user.address,
          deadline
        )
    ).to.be.revertedWith("UniswapV2Router: EXCESSIVE_INPUT_AMOUNT");
  });

  it("swapExactTokensForTokens transfers correct amounts of tokens", async function () {
    const deadline = await UniswapModel.getDeadline();

    // x10 - rate, 997/1000 - fee
    const expectedResult = uniswapModel.swapExactTokensForTokens(
      transferA,
      transferB,
      [tokenA.address, tokenB.address]
    );
    if (expectedResult.isReverted === true) {
      throw new Error("Model is unexpectedly reverts");
    }
    const amountIn = expectedResult.amounts[0];
    const amountOut = expectedResult.amounts[1];

    const userBalanceABefore = await tokenA.balanceOf(user.address);
    const userBalanceBBefore = await tokenB.balanceOf(user.address);

    const uniswapMockBalanceABefore = await tokenA.balanceOf(
      uniswapMock.address
    );
    const uniswapMockBalanceBBefore = await tokenB.balanceOf(
      uniswapMock.address
    );

    await uniswapMock
      .connect(user)
      .swapExactTokensForTokens(
        transferA,
        transferB,
        [tokenA.address, tokenB.address],
        user.address,
        deadline
      );

    expect(await tokenA.balanceOf(user.address)).to.be.eq(
      userBalanceABefore.sub(amountIn)
    );
    expect(await tokenB.balanceOf(user.address)).to.be.eq(
      userBalanceBBefore.add(amountOut)
    );

    expect(await tokenA.balanceOf(uniswapMock.address)).to.be.eq(
      uniswapMockBalanceABefore.add(amountIn)
    );
    expect(await tokenB.balanceOf(uniswapMock.address)).to.be.eq(
      uniswapMockBalanceBBefore.sub(amountOut)
    );
  });

  it("swapExactTokensForTokens reverts if insufficient output amount", async function () {
    const deadline = await UniswapModel.getDeadline();
    await expect(
      uniswapMock
        .connect(user)
        .swapExactTokensForTokens(
          transferB,
          MAX_INT,
          [tokenA.address, tokenB.address],
          user.address,
          deadline
        )
    ).to.be.revertedWith("UniswapV2Router: INSUFFICIENT_OUTPUT_AMOUNT");
  });

  it("swapExactTokensForTokens reverts if rate is 0", async function () {
    integrationsDeployer = new IntegrationsDeployer();

    uniswapMock = await integrationsDeployer.getUniswapLikeMock();
    const deadline = await UniswapModel.getDeadline();
    await expect(
      uniswapMock
        .connect(user)
        .swapExactTokensForTokens(
          transferB,
          MAX_INT,
          [tokenA.address, tokenB.address],
          user.address,
          deadline
        )
    ).to.be.revertedWith("UniswapMock: Rate is not setup");

    await expect(
      uniswapMock
        .connect(user)
        .swapTokensForExactTokens(
          transferB,
          transferB,
          [tokenA.address, tokenB.address],
          user.address,
          deadline
        )
    ).to.be.revertedWith("UniswapMock: Rate is not setup");
  });

  it("unused stuff does nothing", async function () {
    await uniswapMock.removeLiquidityETHSupportingFeeOnTransferTokens(
      ADDRESS_0x0,
      0,
      0,
      0,
      ADDRESS_0x0,
      0
    );

    await uniswapMock.removeLiquidityETHWithPermitSupportingFeeOnTransferTokens(
      ADDRESS_0x0,
      0,
      0,
      0,
      ADDRESS_0x0,
      0,
      true,
      0,
      arrayify(
        "0x1234123412341234123412341234123412341234123412341234123412341234"
      ),
      arrayify(
        "0x1234123412341234123412341234123412341234123412341234123412341234"
      )
    );

    await uniswapMock.swapExactTokensForTokensSupportingFeeOnTransferTokens(
      0,
      0,
      [],
      ADDRESS_0x0,
      0
    );

    await uniswapMock.swapExactETHForTokensSupportingFeeOnTransferTokens(
      0,
      [],
      ADDRESS_0x0,
      0
    );

    await uniswapMock.swapExactTokensForETHSupportingFeeOnTransferTokens(
      0,
      0,
      [],
      ADDRESS_0x0,
      0
    );

    await uniswapMock.swapExactETHForTokens(0, [], ADDRESS_0x0, 0);

    await uniswapMock.swapTokensForExactETH(0, 0, [], ADDRESS_0x0, 0);

    await uniswapMock.swapExactTokensForETH(0, 0, [], ADDRESS_0x0, 0);

    await uniswapMock.swapETHForExactTokens(0, [], ADDRESS_0x0, 0);

    await uniswapMock.quote(0, 0, 0);

    await uniswapMock.getAmountIn(0, 0, 0);

    await uniswapMock.getAmountOut(0, 0, 0);

    await uniswapMock.getAmountsOut(0, [tokenA.address, tokenB.address]);

    await uniswapMock.getAmountsIn(0, [tokenA.address, tokenB.address]);

    await uniswapMock.factory();

    await uniswapMock.WETH();

    await uniswapMock.addLiquidity(
      ADDRESS_0x0,
      ADDRESS_0x0,
      0,
      0,
      0,
      0,
      ADDRESS_0x0,
      0
    );

    await uniswapMock.addLiquidityETH(ADDRESS_0x0, 0, 0, 0, ADDRESS_0x0, 0);

    await uniswapMock.removeLiquidity(
      ADDRESS_0x0,
      ADDRESS_0x0,
      0,
      0,
      0,
      ADDRESS_0x0,
      0
    );

    await uniswapMock.removeLiquidityETH(ADDRESS_0x0, 0, 0, 0, ADDRESS_0x0, 0);

    await uniswapMock.removeLiquidityWithPermit(
      ADDRESS_0x0,
      ADDRESS_0x0,
      0,
      0,
      0,
      ADDRESS_0x0,
      0,
      true,
      0,
      arrayify(
        "0x1234123412341234123412341234123412341234123412341234123412341234"
      ),
      arrayify(
        "0x1234123412341234123412341234123412341234123412341234123412341234"
      )
    );

    await uniswapMock.removeLiquidityETHWithPermit(
      ADDRESS_0x0,
      ADDRESS_0x0,
      0,
      0,
      ADDRESS_0x0,
      0,
      true,
      0,
      arrayify(
        "0x1234123412341234123412341234123412341234123412341234123412341234"
      ),
      arrayify(
        "0x1234123412341234123412341234123412341234123412341234123412341234"
      )
    );
  });
});

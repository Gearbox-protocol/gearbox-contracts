import {solidity} from "ethereum-waffle";

import {
  CreditManager,
  DieselToken,
  Errors,
  IPoolService,
  TokenMock,
  UniswapRouterMock,
  UniswapV2Adapter,
} from "../types/ethers-v5";
import {CoreDeployer} from "../deployer/coreDeployer";
import {BigNumber} from "ethers";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import {DUMB_ADDRESS, RAY} from "../model/_constants";
import {UniswapModel} from "../model/uniswapModel";
import {PoolDeployer} from "../deployer/poolDeployer";
import {PoolTestSuite} from "../deployer/poolTestSuite";
import {CreditManagerTestSuite} from "../deployer/creditManagerTestSuite";

const chai = require("chai");

chai.use(solidity);
const { expect } = chai;

const { userInitBalance } = PoolTestSuite;

const {
  amount,
  borrowedAmount,
  swapAmountA,
  swapAmountB,
  uniRateTokenA,
  amountOutTolerance,
} = CreditManagerTestSuite;

describe("UniswapV2 Adapter", function () {
  let ts: CreditManagerTestSuite;

  let deployer: SignerWithAddress;
  let liquidityProvider: SignerWithAddress;
  let user: SignerWithAddress;
  let friend: SignerWithAddress;
  let liquidator: SignerWithAddress;

  let coreDeployer: CoreDeployer;
  let poolDeployer: PoolDeployer;

  let poolService: IPoolService;
  let creditManager: CreditManager;

  let dieselToken: DieselToken;
  let underlyingToken: TokenMock;

  let uniswapMock: UniswapRouterMock;
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
    liquidityProvider = ts.liquidityProvider;
    user = ts.user;
    friend = ts.friend;
    liquidator = ts.liquidator;

    coreDeployer = ts.coreDeployer;
    poolDeployer = ts.poolDeployer;

    poolService = ts.poolService;
    creditManager = ts.creditManager;
    uniswapV2Adapter = ts.uniswapV2adapter;

    dieselToken = ts.dieselToken;
    underlyingToken = ts.underlyingToken;

    uniswapMock = ts.uniswapMock;

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

  // it("[UV2A-1]: defaultSwapContract & kind() return correct value", async function () {
  //   const kind = formatBytes32String("trade");
  //
  //   expect(await creditManager.defaultSwapContract()).to.be.eq(uniswapMock.address);
  //
  //   expect(await creditManager.kind()).to.be.eq(kind);
  // });

  it("[UV2A-2]: swapTokensForExactTokens, swapTokensForExactTokens reverts if user has no accounts", async function () {
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

    await expect(
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
  //

  //
  // it("liquidateCreditAccount transfers tokens to address correctly", async function () {
  //   await underlyingToken.mint(liquidator.address, userInitBalance);
  //   await underlyingToken
  //     .connect(liquidator)
  //     .approve(creditManager.address, MAX_INT);
  //
  //   // Open default credit account
  //   await ts.liquidationSetup();
  //
  //   await uniswapV2Adapter
  //     .connect(user)
  //     .swapExactTokensForTokens(
  //       swapAmountB,
  //       0,
  //       [underlyingToken.address, tokenA.address],
  //       await UniswapModel.getDeadline()
  //     );
  //
  //   const expectedTrade = uniswapModel.swapExactTokensForTokens(
  //     swapAmountB,
  //     BigNumber.from(0),
  //     [underlyingToken.address, tokenA.address]
  //   );
  //
  //   if (expectedTrade.isReverted === true) {
  //     throw new Error("Unexpected revert");
  //   }
  //
  //   const expectedUnderlyingBalance = amount
  //     .add(borrowedAmount)
  //     .sub(swapAmountB);
  //   const expectedBalanceA = BigNumber.from(expectedTrade.amounts[1]);
  //
  //   expect(
  //     await getCreditAccountTokenBalance(
  //       user.address,
  //       underlyingToken.address
  //     )
  //   ).to.be.eq(expectedUnderlyingBalance);
  //
  //   expect(
  //     await getCreditAccountTokenBalance(user.address, tokenA.address)
  //   ).to.be.eq(expectedBalanceA);
  //
  //   await creditManager
  //     .connect(liquidator)
  //     .liquidateCreditAccount(user.address, friend.address);
  //
  //   const totalVA = expectedUnderlyingBalance.add(
  //     rayDiv(expectedBalanceA, uniRateTokenA)
  //   );
  //
  //   const expectedLiquidationCost = percentMul(
  //     totalVA,
  //     LIQUIDATION_DISCOUNTED_SUM
  //   );
  //
  //   expect(
  //     await underlyingToken.balanceOf(liquidator.address),
  //     "Expected liquidation cost"
  //   ).to.be.eq(userInitBalance.sub(expectedLiquidationCost));
  //
  //   expect(await underlyingToken.balanceOf(friend.address)).to.be.eq(
  //     expectedUnderlyingBalance.sub(1)
  //   );
  //   expect(await tokenA.balanceOf(friend.address)).to.be.eq(
  //     expectedBalanceA.sub(1)
  //   );
  // });

  // it("[UV2A-9]: constructor reverts if defaultSwap is not allowed in CreditFilter", async function () {
  //   // Open default credit account
  //   const revertMsg = await errors.VF_CONTRACT_IS_NOT_ALLOWED();

  //   const creditFilterArtifact = (await ethers.getContractFactory(
  //       "CreditFilter"
  //   )) as CreditFilter__factory;

  //   const ap = await ts.coreDeployer.getAddressProvider();

  //   const creditFilter = await creditFilterArtifact.deploy(ap.address, underlyingToken.address);

  //   const creditManagerArtifact = (await ethers.getContractFactory(
  //     "CreditManager"
  //   )) as CreditManager__factory;

  //   const addressProvider = await ts.coreDeployer.getAddressProvider();
  //   await expect(
  //     creditManagerArtifact.deploy(
  //       addressProvider.address,
  //       0,
  //       1100,
  //       500,
  //       ts.poolService.address,
  //       creditFilter.address,
  //       DUMB_ADDRESS
  //     )
  //   ).to.be.revertedWith(revertMsg);
  // });
});

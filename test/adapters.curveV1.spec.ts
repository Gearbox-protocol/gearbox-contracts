import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { expect } from "../utils/expect";
import { CreditManager, CurveMock, CurveV1Adapter, Errors, TokenMock } from "../types/ethers-v5";
import { CoreDeployer } from "../deployer/coreDeployer";
import { CurveModel } from "../model/curveModel";
import { PoolDeployer } from "../deployer/poolDeployer";
import { CreditManagerTestSuite } from "../deployer/creditManagerTestSuite";

const { amount, borrowedAmount, swapAmountA, swapAmountB } =
  CreditManagerTestSuite;

describe("CurveV1 adapter", function () {
  let ts: CreditManagerTestSuite;

  let user: SignerWithAddress;

  let coreDeployer: CoreDeployer;
  let poolDeployer: PoolDeployer;

  let creditManager: CreditManager;
  let curveV1Adapter: CurveV1Adapter;

  let underlyingToken: TokenMock;

  let curveMock: CurveMock;
  let curveModel: CurveModel;

  let tokenA: TokenMock;
  let errors: Errors;

  beforeEach(async function () {
    ts = new CreditManagerTestSuite();
    await ts.getSuite();
    await ts.setupCreditManager();
    await ts.setupCurveV1Adapter();

    user = ts.user;

    coreDeployer = ts.coreDeployer;
    poolDeployer = ts.poolDeployer;

    creditManager = ts.creditManager;
    curveV1Adapter = ts.curveV1adapter;

    underlyingToken = ts.underlyingToken;

    curveMock = ts.curveMock;

    tokenA = ts.tokenA;
    errors = ts.errors;

    curveModel = new CurveModel();
  });

  const getCreditAccountTokenBalance = async (
    borrower: string,
    token: string
  ) => {
    const va = await creditManager.creditAccounts(borrower);
    const tMock = await ts.testDeployer.connectToken(token);
    return await tMock.balanceOf(va);
  };

  it("[CVA-1]: exchangeCurve reverts if user has no accounts", async function () {
    const revertMsg = await errors.CM_NO_OPEN_ACCOUNT();
    // Adding liquidity to be able to open credit account
    // Open default credit account
    await expect(
      curveV1Adapter.connect(user).exchange(0, 1, swapAmountA, swapAmountB)
    ).to.be.revertedWith(revertMsg);
  });

  it("[CVA-2]: curveExchange reverts for disallowed tokens", async function () {
    const revertMsg = await errors.CF_TOKEN_IS_NOT_ALLOWED();
    // Open default credit account
    await ts.openDefaultCreditAccount();

    await expect(
      curveV1Adapter.connect(user).exchange(0, 2, swapAmountA, swapAmountB)
    ).to.be.revertedWith(revertMsg);
  });

  it("[CVA-3]: curveExchange correctly swap & update VA balances", async function () {
    // Open default credit account
    await ts.openDefaultCreditAccount();

    await curveV1Adapter.connect(user).exchange(0, 1, swapAmountA, swapAmountB);

    const expectedTrade = curveModel.exchange(1, 0, swapAmountA, swapAmountB);

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

  // it("[CVA-4]: constructor reverts if curve doesn't support underlying token", async function () {
  //   expect(await curveV1Adapter.tokenIndexes(underlyingToken.address)).to.be.eq(
  //     1
  //   );
  //   expect(await curveV1Adapter.tokenIndexes(tokenA.address)).to.be.eq(2);
  //   expect(
  //     await curveV1Adapter.tokenIndexes(ts.tokenForbidden.address)
  //   ).to.be.eq(0);
  // });
});

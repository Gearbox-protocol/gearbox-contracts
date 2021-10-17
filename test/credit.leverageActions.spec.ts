// @ts-ignore
import { ethers, waffle } from "hardhat";
import { expect } from "../utils/expect";

import {
  CreditFilterMock,
  CreditManager,
  CurveMock,
  DieselToken,
  Errors,
  ICurvePool,
  IUniswapV2Router02,
  IUniswapV2Router02__factory,
  LeveragedActions,
  PoolService,
  TokenMock,
  UniswapRouterMock,
} from "../types/ethers-v5";
import { CoreDeployer } from "../deployer/coreDeployer";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { PoolDeployer } from "../deployer/poolDeployer";
import { IntegrationsDeployer } from "../deployer/integrationsDeployer";
import { TestDeployer } from "../deployer/testDeployer";
import { PoolTestSuite } from "../deployer/poolTestSuite";
import { CreditManagerTestSuite } from "../deployer/creditManagerTestSuite";
import {
  AdapterInterface,
  ADDRESS_0x0,
  LEVERAGE_DECIMALS,
  MAX_INT,
  RAY,
  WAD,
} from "@diesellabs/gearbox-sdk";
import { UniV3helper } from "@diesellabs/gearbox-leverage";
import { BigNumberish } from "ethers";
import { BytesLike } from "@ethersproject/bytes";

const { addLiquidity } = PoolTestSuite;

const rate = 10;
const leverage = 5;
const amount = WAD.mul(2);

describe("CreditManager", function () {
  let ts: CreditManagerTestSuite;
  let leverageActions: LeveragedActions;

  let deployer: SignerWithAddress;
  let coreDeployer: CoreDeployer;
  let integrationsDeployer: IntegrationsDeployer;
  let poolDeployer: PoolDeployer;
  let testDeployer: TestDeployer;
  let tokenA: TokenMock;

  let poolService: PoolService;
  let creditManager: CreditManager;
  let creditFilter: CreditFilterMock;

  let liquidityProvider: SignerWithAddress;
  let user: SignerWithAddress;
  let liquidator: SignerWithAddress;
  let friend: SignerWithAddress;

  let dieselToken: DieselToken;
  let underlyingToken: TokenMock;

  let uniMock: UniswapRouterMock;
  let uniAdapter: IUniswapV2Router02;
  let uniDeadline: number;

  let errors: Errors;
  let longParams: {
    creditManager: string;
    leverageFactor: BigNumberish;
    swapInterface: BigNumberish;
    swapContract: string;
    swapCalldata: BytesLike;
    lpInterface: BigNumberish;
    lpContract: string;
    amountOutMin: BigNumberish;
  };

  beforeEach(async () => {
    const testDeployer = await new TestDeployer();

    ts = new CreditManagerTestSuite();

    await ts.getSuite();
    await ts.setupCreditManager();

    deployer = ts.deployer;
    coreDeployer = ts.coreDeployer;
    integrationsDeployer = ts.integrationsDeployer;
    poolDeployer = ts.poolDeployer;

    poolService = ts.poolService;
    creditManager = ts.creditManager;
    creditFilter = ts.creditFilter as unknown as CreditFilterMock;

    liquidityProvider = ts.liquidityProvider;
    user = ts.user;
    liquidator = ts.liquidator;
    friend = ts.friend;

    dieselToken = ts.dieselToken;
    underlyingToken = ts.underlyingToken;
    tokenA = ts.tokenA;
    errors = ts.errors;

    // Send my to be able for lending
    await underlyingToken
      .connect(liquidityProvider)
      .transfer(poolService.address, addLiquidity);

    await underlyingToken.transfer(user.address, amount);

    leverageActions = await ts.coreDeployer.getLeveragedActions();

    uniMock = await integrationsDeployer.getUniswapMock();
    uniAdapter = await integrationsDeployer.getUniswapV2Adapter(
      uniMock.address
    );

    await uniMock.setRate(
      underlyingToken.address,
      ts.tokenA.address,
      RAY.mul(rate)
    );

    await tokenA.transfer(uniMock.address, amount.mul(100));

    await ts.creditFilter.allowContract(uniMock.address, uniAdapter.address);

    await creditFilter
      .connect(user)
      .approveAccountTransfers(leverageActions.address, true);

    await underlyingToken
      .connect(user)
      .approve(leverageActions.address, MAX_INT);

    const currentBlockchainTime = await ethers.provider.getBlock("latest");

    uniDeadline = currentBlockchainTime.timestamp + 3600;

    const calldata =
      IUniswapV2Router02__factory.createInterface().encodeFunctionData(
        "swapExactTokensForTokens",
        [
          amount,
          amount.mul(rate).mul(997).div(1000),
          [underlyingToken.address, tokenA.address],
          deployer.address,
          uniDeadline,
        ]
      );

    longParams = {
      creditManager: ts.creditManager.address,
      leverageFactor: (leverage - 1) * LEVERAGE_DECIMALS,
      swapInterface: AdapterInterface.UniswapV2,
      swapContract: uniMock.address,
      swapCalldata: "0x" + calldata.substr(10),
      lpInterface: AdapterInterface.NoSwap,
      lpContract: ADDRESS_0x0,
      amountOutMin: 0,
    };
  });

  it("[LA-1]: openLong takes correct amount even if someone sent tokens to contract", async () => {
    const expectedAmount = amount.mul(rate).mul(leverage).mul(997).div(1000);

    const maxAmount = await creditManager.maxAmount();
    expect(maxAmount).to.be.gt(0);

    // Send tokens to block leveraged actions
    await underlyingToken.transfer(leverageActions.address, maxAmount.add(1));

    await leverageActions.connect(user).openLong(amount, longParams, 0);

    const creditAccount = await creditManager.getCreditAccountOrRevert(
      user.address
    );

    expect(await tokenA.balanceOf(creditAccount)).to.be.eq(expectedAmount);
  });

  it("[LA-2]: openShort(*) reverts if last path element != collateral", async () => {
    const revertMsg = await errors.LA_TOKEN_OUT_IS_NOT_COLLATERAL();

    const curveMock: CurveMock = await ts.integrationsDeployer.getCurveMock([
      underlyingToken.address,
      tokenA.address,
    ]);
    const curveAdapter: ICurvePool =
      await ts.integrationsDeployer.getCurveV1Adapter(curveMock.address);

    await creditFilter.allowContract(curveMock.address, curveAdapter.address);

    await expect(
      leverageActions
        .connect(user)
        .openShortUniV2(
          uniMock.address,
          amount,
          0,
          [underlyingToken.address, tokenA.address],
          uniDeadline,
          longParams,
          0
        )
    ).to.be.revertedWith(revertMsg);

    await expect(
      leverageActions.connect(user).openShortUniV3(
        uniMock.address,
        {
          amountIn: amount,
          amountOutMinimum: 0,
          path: UniV3helper.pathToUniV3Path([
            underlyingToken.address,
            tokenA.address,
          ]),
          deadline: UniV3helper.getDeadline(),
          recipient: ADDRESS_0x0,
        },
        longParams,
        0
      )
    ).to.be.revertedWith(revertMsg);

    await expect(
      leverageActions
        .connect(user)
        .openShortCurve(curveMock.address, 0, 1, amount, 0, longParams, 0)
    ).to.be.revertedWith(revertMsg);
  });
});

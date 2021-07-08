import {solidity} from "ethereum-waffle";
import * as chai from "chai";

import {CoreDeployer} from "../deployer/coreDeployer";
import {TestDeployer} from "../deployer/testDeployer";
import {CreditManager, Errors, WETHGateway, WETHMock,} from "../types/ethers-v5";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import {CreditManagerTestSuite} from "../deployer/creditManagerTestSuite";
import {STANDARD_INTEREST_MODEL_PARAMS} from "../deployer/poolConfig";
import {PoolTestSuite} from "../deployer/poolTestSuite";
import {BigNumber} from "ethers";
import {DUMB_ADDRESS, MAX_INT, WAD} from "../model/_constants";

chai.use(solidity);
const { expect } = chai;

const { addLiquidity } = PoolTestSuite;
const { leverageFactor } = CreditManagerTestSuite;
const amount = BigNumber.from(1e6);
const borrowedAmount = BigNumber.from(1e6).mul(leverageFactor).div(100);

describe("WETHGateway", function () {
  let ts: CreditManagerTestSuite;
  let deployer: SignerWithAddress;
  let user: SignerWithAddress;
  let friend: SignerWithAddress;
  let coreDeployer: CoreDeployer;
  let testDeployer: TestDeployer;
  let wethToken: WETHMock;
  let wethGateway: WETHGateway;
  let creditManager: CreditManager;
  let errors: Errors;

  beforeEach(async function () {
    testDeployer = new TestDeployer();

    wethToken = await testDeployer.getWethMock();

    ts = new CreditManagerTestSuite({
      poolConfig: {
        interestModel: STANDARD_INTEREST_MODEL_PARAMS,
        underlyingToken: {
          type: "real",
          address: wethToken.address,
        },
      },
      coreConfig: {
        weth: {
          type: "real",
          wethAddress: wethToken.address,
        },
      },
    });
    await ts.getSuite();
    await ts.setupCreditManager();


    deployer = ts.deployer;
    user = ts.user;
    friend = ts.friend;
    coreDeployer = ts.coreDeployer;
    creditManager = ts.creditManager;

    wethGateway = await coreDeployer.getWETHGateway();
    errors = ts.errors;
  });

  const deployNonWethPoolAndWam = async () => {
    const wethToken = await testDeployer.getTokenMock("WETH2", "WETH2");
    ts = new CreditManagerTestSuite({
      coreConfig: {
        accountMinerType: "mock",
        treasury: "mock",
        weth: {
          type: "real",
          wethAddress: wethToken.address,
        },
        realNetwork: false,
      },
      poolConfig: {
        interestModel: STANDARD_INTEREST_MODEL_PARAMS,
        underlyingToken: {
          type: "mock",
          rate: 10,
          name: "DAI",
          symbol: "DAU TOKEN",
        },
      },
    });

    await ts.getSuite();
    await ts.setupCreditManager();

    coreDeployer = ts.coreDeployer;
    testDeployer = ts.testDeployer;

    wethGateway = await coreDeployer.getWETHGateway();
  };

  it("[WG-1]: addLiquidityETH, removeLiquidityETH reverts if called for non-pool addresses", async function () {
    const revertMsg = await errors.WG_DESTINATION_IS_NOT_POOL();

    await expect(
      wethGateway.addLiquidityETH(DUMB_ADDRESS, DUMB_ADDRESS, 0)
    ).to.be.revertedWith(revertMsg);

    await expect(
      wethGateway.removeLiquidityETH(DUMB_ADDRESS, 1, DUMB_ADDRESS)
    ).to.be.revertedWith(revertMsg);
  });

  it("[WG-2]: addLiquidityETH, removeLiquidityETH reverts if non-weth pools and creditManagers", async function () {
    const revertMsg = await errors.WG_DESTINATION_IS_NOT_WETH_COMPATIBLE();

    await deployNonWethPoolAndWam();

    await expect(
      wethGateway.addLiquidityETH(ts.poolService.address, DUMB_ADDRESS, 0)
    ).to.be.revertedWith(revertMsg);

    await expect(
      wethGateway.removeLiquidityETH(ts.poolService.address, 1, DUMB_ADDRESS)
    ).to.be.revertedWith(revertMsg);
  });

  it("[WG-3]: openCreditAccount, repayCreditAccount reverts if call for non-creditManager addresses ", async function () {
    const revertMsg = await errors.WG_DESTINATION_IS_NOT_CREDIT_MANAGER();

    await expect(
      wethGateway.openCreditAccountETH(DUMB_ADDRESS, DUMB_ADDRESS, 5, 0)
    ).to.be.revertedWith(revertMsg);

    await expect(
      wethGateway.repayCreditAccountETH(DUMB_ADDRESS, DUMB_ADDRESS)
    ).to.be.revertedWith(revertMsg);
  });

  it("[WG-4]: addLiquidityETH, removeLiquidityETH reverts if non-weth pools and creditManagers", async function () {
    const revertMsg = await errors.WG_DESTINATION_IS_NOT_WETH_COMPATIBLE();

    await deployNonWethPoolAndWam();

    await expect(
      wethGateway.openCreditAccountETH(
        ts.creditManager.address,
        DUMB_ADDRESS,
        5,
        0
      )
    ).to.be.revertedWith(revertMsg);

    await expect(
      wethGateway.repayCreditAccountETH(ts.creditManager.address, DUMB_ADDRESS)
    ).to.be.revertedWith(revertMsg);
  });

  it("[WG-5]: unwrapWETH reverts if call from non-creditManager addresses ", async function () {
    const revertMsg = await errors.WG_DESTINATION_IS_NOT_CREDIT_MANAGER();

    await expect(wethGateway.unwrapWETH(DUMB_ADDRESS, 10)).to.be.revertedWith(
      revertMsg
    );
  });

  it("[WG-6]: WETHGateway reverts from direct eth transfer", async function () {
    const revertMsg = await errors.WG_RECEIVE_IS_NOT_ALLOWED();

    await expect(
      deployer.sendTransaction({ value: 10, to: wethGateway.address })
    ).to.be.revertedWith(revertMsg);
  });

  it("[WG-7]: unwrapWETH correctly send eth to selected account", async function () {
    // Provide 1 WETH to weth gateway
    await wethToken.mint(wethGateway.address, WAD);

    // Send 1ETH which should be returned to WETH contract
    await deployer.sendTransaction({ to: wethToken.address, value: WAD });

    const userBalanceBefore = await user.getBalance();

    // Call WETHGateway through creditManager. Only they have right to do so

    const contractsRegister = await coreDeployer.getContractsRegister();

    await contractsRegister.addCreditManager(deployer.address);

    await wethGateway.connect(deployer).unwrapWETH(user.address, WAD);

    expect(await user.getBalance()).to.be.eq(userBalanceBefore.add(WAD));
  });

  it("[WG-8]: addLiquidityETH adds liquidity to pool", async function () {
    const dieselToken = await ts.poolDeployer.getDieselToken();

    const tx = () =>
      wethGateway.addLiquidityETH(ts.poolService.address, user.address, 0, {
        value: amount,
      });

    await expect(tx).to.changeTokenBalance(dieselToken, user, amount);
  });

  it("[WG-9]: removeLiquidityETH adds liquidity to pool", async function () {
    const dieselToken = await ts.poolDeployer.getDieselToken();

    const txAdd = () =>
      wethGateway.addLiquidityETH(ts.poolService.address, user.address, 0, {
        value: amount,
      });

    await expect(txAdd).to.changeTokenBalance(dieselToken, user, amount);

    await dieselToken.connect(user).approve(wethGateway.address, MAX_INT);

    const txRemove = () =>
      wethGateway
        .connect(user)
        .removeLiquidityETH(ts.poolService.address, amount, user.address);

    await expect(txRemove).to.changeEtherBalance(user, amount);
  });

  it("[WG-10]: openCreditAccountETH opens an account", async function () {
    const dieselToken = await ts.poolDeployer.getDieselToken();

    await wethGateway.addLiquidityETH(ts.poolService.address, user.address, 0, {
      value: addLiquidity,
    });

    const openTx = () =>
      wethGateway
        .connect(user)
        .openCreditAccountETH(
          ts.creditManager.address,
          user.address,
          leverageFactor,
          0,
          { value: amount }
        );

    await expect(openTx).to.changeEtherBalance(user, -amount);
    expect(await ts.creditManager.hasOpenedCreditAccount(user.address)).to.be
      .true;

    const va = await ts.creditManager.creditAccounts(user.address);

    expect(await ts.creditFilter.calcTotalValue(va)).to.be.eq(
      amount.add(borrowedAmount)
    );
  });

  it("[WG-11]: repayCreditAccountETH repays charge correct amount", async function () {
    await wethGateway.addLiquidityETH(ts.poolService.address, user.address, 0, {
      value: addLiquidity,
    });

    await wethGateway
      .connect(user)
      .openCreditAccountETH(
        ts.creditManager.address,
        user.address,
        leverageFactor,
        0,
        { value: amount }
      );

    const repayAmount = await creditManager.calcRepayAmount(
      user.address,
      false
    );

    const repayTx = () =>
      wethGateway
        .connect(user)
        .repayCreditAccountETH(creditManager.address, friend.address, {
          value: repayAmount,
        });
    await expect(repayTx).to.changeEtherBalance(user, -repayAmount);
  });

  it("[WG-12]: repayCreditAccountETH repays charge correct amount if more were sent", async function () {
    await wethGateway.addLiquidityETH(ts.poolService.address, user.address, 0, {
      value: addLiquidity,
    });

    await wethGateway
      .connect(user)
      .openCreditAccountETH(
        ts.creditManager.address,
        user.address,
        leverageFactor,
        0,
        { value: amount }
      );

    const repayAmount = await creditManager.calcRepayAmount(
      user.address,
      false
    );

    const repayTx = () =>
      wethGateway
        .connect(user)
        .repayCreditAccountETH(creditManager.address, friend.address, {
          value: repayAmount.mul(2),
        });
    await expect(repayTx).to.changeEtherBalance(user, -repayAmount);
  });

  it("[WG-13]: repayCreditAccountETH transfer underlying asset in ETH", async function () {
    await wethGateway.addLiquidityETH(ts.poolService.address, user.address, 0, {
      value: addLiquidity,
    });

    await wethGateway
      .connect(user)
      .openCreditAccountETH(
        ts.creditManager.address,
        user.address,
        leverageFactor,
        0,
        { value: amount }
      );

    const repayAmount = await creditManager.calcRepayAmount(
      user.address,
      false
    );

    const repayTx = () =>
      wethGateway
        .connect(user)
        .repayCreditAccountETH(creditManager.address, friend.address, {
          value: repayAmount.mul(2),
        });
    await expect(repayTx).to.changeEtherBalance(
      friend,
      amount.add(borrowedAmount).sub(1)
    );
  });
});

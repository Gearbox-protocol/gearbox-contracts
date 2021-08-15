// @ts-ignore
import { ethers } from "hardhat";
import { expect } from "../utils/expect";

import { WETHMock } from "../types/ethers-v5";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { TestDeployer } from "../deployer/testDeployer";
import { DUMB_ADDRESS } from "../core/constants";

describe("WETHMock", function () {
  let deployer: SignerWithAddress;
  let user: SignerWithAddress;
  let testDeployer: TestDeployer;
  let wethMock: WETHMock;
  let smallAmount: number;

  beforeEach(async function () {
    deployer = (await ethers.getSigners())[0];
    user = (await ethers.getSigners())[1];

    testDeployer = new TestDeployer();

    wethMock = await testDeployer.getWethMock();

    smallAmount = 1e6;
  });

  it("[WM-1]: deposit emits tokens", async function () {
    const txs = [
      () => wethMock.deposit({ value: smallAmount }),
      () =>
        deployer.sendTransaction({ to: wethMock.address, value: smallAmount }),
    ];

    for (const tx of txs) {
      await expect(tx).changeTokenBalance(wethMock, deployer, smallAmount);
      await expect(tx())
        .to.emit(wethMock, "Deposit")
        .withArgs(deployer.address, smallAmount);
    }

    expect(await wethMock.totalSupply()).to.be.eq(4 * smallAmount);
  });

  it("[WM-2]: withdraw burns tokens, returns ether and emits event", async function () {
    await expect(wethMock.withdraw(1000)).to.be.reverted;

    await wethMock.deposit({ value: 3 * smallAmount });

    const tx = () => wethMock.withdraw(smallAmount);

    await expect(tx).changeTokenBalance(wethMock, deployer, -smallAmount);
    await expect(tx).changeEtherBalance(deployer, smallAmount);
    await expect(tx())
      .to.emit(wethMock, "Withdrawal")
      .withArgs(deployer.address, smallAmount);

    expect(await wethMock.totalSupply()).to.be.eq(0);
  });

  it("[WM-3]: approve approves tokens", async function () {
    expect(
      await wethMock.allowance(deployer.address, user.address),
      "Non zero allowance"
    ).to.be.eq(0);

    await wethMock.approve(user.address, smallAmount);

    expect(await wethMock.allowance(deployer.address, user.address)).to.be.eq(
      smallAmount
    );

    await expect(wethMock.approve(user.address, smallAmount))
      .to.emit(wethMock, "Approval")
      .withArgs(deployer.address, user.address, smallAmount);
  });

  it("[WM-4]: transfer/transferFrom reverts if no balance / allowance", async function () {
    await expect(wethMock.transfer(DUMB_ADDRESS, 12)).to.be.reverted;

    await user.sendTransaction({ to: wethMock.address, value: smallAmount });

    await expect(wethMock.transferFrom(user.address, DUMB_ADDRESS, 12)).to.be
      .reverted;
  });

  it("[WM-5]: transfer/transferFrom reverts if no balance / allowance", async function () {
    await deployer.sendTransaction({
      to: wethMock.address,
      value: smallAmount,
    });

    await expect(() =>
      wethMock.transfer(user.address, smallAmount)
    ).to.changeTokenBalances(
      wethMock,
      [deployer, user],
      [-smallAmount, smallAmount]
    );
  });

  it("[WM-6]: transfer/transferFrom emits event", async function () {
    await deployer.sendTransaction({
      to: wethMock.address,
      value: smallAmount,
    });

    await expect(wethMock.transfer(user.address, smallAmount))
      .to.emit(wethMock, "Transfer")
      .withArgs(deployer.address, user.address, smallAmount);
  });

  it("[WM-7]: transferFrom decrease allowance", async function () {
    await deployer.sendTransaction({
      to: wethMock.address,
      value: smallAmount,
    });
    await wethMock.approve(user.address, smallAmount);

    expect(await wethMock.allowance(deployer.address, user.address)).to.be.eq(
      smallAmount
    );

    await wethMock
      .connect(user)
      .transferFrom(deployer.address, DUMB_ADDRESS, smallAmount);

    expect(await wethMock.allowance(deployer.address, user.address)).to.be.eq(
      0
    );
  });
});

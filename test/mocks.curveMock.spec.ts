import {ethers} from "hardhat";
import {BigNumber} from "ethers";
import {solidity} from "ethereum-waffle";
import * as chai from "chai";

import {CurveMock, TokenMock} from "../types/ethers-v5";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import {IntegrationsDeployer} from "../deployer/integrationsDeployer";
import {TestDeployer} from "../deployer/testDeployer";
import {MAX_INT} from "../model/_constants";

chai.use(solidity);
const { expect } = chai;

const initialSwapAmount = BigNumber.from(10).pow(18).mul(10000);
const initialUserAmount = BigNumber.from(10).pow(18).mul(8800);

describe("CurveMock", function () {
  let deployer: SignerWithAddress;
  let user: SignerWithAddress;
  let integrationsDeployer: IntegrationsDeployer;
  let testDeployer: TestDeployer;
  let curveMock: CurveMock;

  let tokenA: TokenMock;
  let tokenB: TokenMock;

  beforeEach(async function () {
    deployer = (await ethers.getSigners())[0];
    user = (await ethers.getSigners())[1];

    integrationsDeployer = new IntegrationsDeployer();
    testDeployer = new TestDeployer();

    curveMock = await integrationsDeployer.getCurveMock();

    tokenA = await testDeployer.getTokenMock("TokenA", "AAA");
    tokenB = await testDeployer.getTokenMock("TokenB", "BBB");

    await tokenA.mint(user.address, initialUserAmount);
    await tokenB.mint(user.address, initialUserAmount);

    await tokenA.connect(user).approve(curveMock.address, MAX_INT);
    await tokenB.connect(user).approve(curveMock.address, MAX_INT);

    await tokenA.mint(curveMock.address, initialSwapAmount);
    await tokenB.mint(curveMock.address, initialSwapAmount);
  });

  it("addCoin correctly adds coin", async function () {
    await curveMock.addCoin(tokenA.address);
    expect(await curveMock.coins(0)).to.be.eq(tokenA.address);
  });

  it("exchange transfers correct amounts of tokens", async function () {
    const tokenA = await testDeployer.getTokenMock("token A", "AAA");
    const tokenB = await testDeployer.getTokenMock("token B", "BBB");

    await tokenA.connect(user).approve(curveMock.address, MAX_INT);

    await curveMock.addCoin(tokenA.address);
    await curveMock.addCoin(tokenB.address);

    const initialAmount = 100000;
    const amountDx = 1000;
    const amountDy = 580;

    await tokenA.mint(user.address, initialAmount);
    await tokenB.mint(curveMock.address, initialAmount);


    const userBalanceABefore = await tokenA.balanceOf(user.address)
    const userBalanceBBefore = await tokenB.balanceOf(user.address)

    const curveMockBalanceABefore = await tokenA.balanceOf(curveMock.address)
    const curveMockBalanceBBefore = await tokenB.balanceOf(curveMock.address)

    await curveMock.connect(user).exchange(0, 1, amountDx, amountDy);

    expect(await tokenA.balanceOf(user.address)).to.be.eq(userBalanceABefore.sub(amountDx));
    expect(await tokenA.balanceOf(curveMock.address)).to.be.eq(curveMockBalanceABefore.add(amountDx));

    expect(await tokenB.balanceOf(user.address)).to.be.eq(userBalanceBBefore.add(amountDy));
    expect(await tokenB.balanceOf(curveMock.address)).to.be.eq(curveMockBalanceBBefore.sub(amountDy));

  });

  it("exchange_underlying, get_dx_underlying, get_dy_underlying does nothing", async function () {
    await curveMock.exchange_underlying(0, 0, 0, 0);
    expect(await curveMock.get_dx_underlying(0, 0, 0)).to.be.eq(0);

    expect(await curveMock.get_dy_underlying(0, 0, 0)).to.be.eq(0);
  });

  it("get_dx, get_dy, get_virtual_price  does nothing", async function () {
    expect(await curveMock.get_dx(0, 0, 0)).to.be.eq(0);

    expect(await curveMock.get_dy(0, 0, 0)).to.be.eq(0);

    expect(await curveMock.get_virtual_price()).to.be.eq(0);
  });
});

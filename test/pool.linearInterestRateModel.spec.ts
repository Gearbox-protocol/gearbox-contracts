import { ethers, waffle } from "hardhat";
import { solidity } from "ethereum-waffle";
import * as chai from "chai";

import { LinearInterestRateModel } from "../types/ethers-v5";
import { LinearInterestRateModelDeployer } from "../deployer/linearIRModelDeployer";
import { RAY } from "../model/_constants";

chai.use(solidity);
const { expect } = chai;

describe("LinearInterestRateModel", function () {
  let linearModelDeployer: LinearInterestRateModelDeployer;
  let linearInterestRateModel: LinearInterestRateModel;

  it("[LR-1]: calcBorrowRate correctly computes borrowRate #1", async function () {
    linearModelDeployer = new LinearInterestRateModelDeployer({
      Uoptimal: 80,
      Rbase: 0,
      Rslope1: 4,
      Rslope2: 75,
    });
    linearInterestRateModel = await linearModelDeployer.getLinearInterestRateModel();
    expect(await linearInterestRateModel.calcBorrowRate(1000, 1000)).to.be.eq(
      0
    );
  });

  it("[LR-2]: calcBorrowRate correctly computes borrowRate #2", async function () {
    linearModelDeployer = new LinearInterestRateModelDeployer({
      Uoptimal: 80,
      Rbase: 0,
      Rslope1: 4,
      Rslope2: 75,
    });

    // console.log(linearModelDeployer.model.calcBorrowRate(1000, 0));
    const result = await linearInterestRateModel.calcBorrowRate(1000, 0);
    expect(result.mul(10000).div(RAY)).to.be.eq(7900);
  });

  it("[LR-3]: calcBorrowRate correctly computes borrowRate #3", async function () {
    linearModelDeployer = new LinearInterestRateModelDeployer({
      Uoptimal: 0,
      Rbase: 0,
      Rslope1: 4,
      Rslope2: 75,
    });

    linearInterestRateModel = await linearModelDeployer.getLinearInterestRateModel();
    const result = await linearInterestRateModel.calcBorrowRate(1000, 400);
    expect(result.mul(10000).div(RAY)).to.be.eq(4900);
  });

  it("[LR-4]: getModelParameters returns correct model parameters ", async function () {
    linearModelDeployer = new LinearInterestRateModelDeployer({
      Uoptimal: 11,
      Rbase: 9,
      Rslope1: 4,
      Rslope2: 75,
    });

    linearInterestRateModel = await linearModelDeployer.getLinearInterestRateModel();
    const [
      uOptinal,
      rBase,
      rSlope1,
      rSlope2,
    ] = await linearInterestRateModel.getModelParameters();
    expect(uOptinal).to.be.eq(1100);
    expect(rBase.mul(10000).div(RAY)).to.be.eq(900);
    expect(rSlope1.mul(10000).div(RAY)).to.be.eq(400);
    expect(rSlope2.mul(10000).div(RAY)).to.be.eq(7500);
  });

  it("[LR-5]: calcBorrowRate returns Rbase if expected liquidity is 0", async function () {
    linearModelDeployer = new LinearInterestRateModelDeployer({
      Uoptimal: 0,
      Rbase: 1,
      Rslope1: 4,
      Rslope2: 75,
    });

    linearInterestRateModel = await linearModelDeployer.getLinearInterestRateModel();
    const result = await linearInterestRateModel.calcBorrowRate(0, 0);
    expect(result).to.be.eq(RAY.div(100));
  });

  it("[LR-6]: calcBorrowRate returns Rbase if expected liquidity is 0", async function () {
    linearModelDeployer = new LinearInterestRateModelDeployer({
      Uoptimal: 0,
      Rbase: 1,
      Rslope1: 4,
      Rslope2: 75,
    });

    linearInterestRateModel = await linearModelDeployer.getLinearInterestRateModel();
    const result = await linearInterestRateModel.calcBorrowRate(12, 100);
    expect(result).to.be.eq(RAY.div(100));
  });

});

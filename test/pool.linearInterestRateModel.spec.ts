import { expect } from "../utils/expect";

import { Errors, LinearInterestRateModel } from "../types/ethers-v5";
import { LinearInterestRateModelDeployer } from "../deployer/linearIRModelDeployer";
import { RAY } from "@diesellabs/gearbox-sdk";
import { TestDeployer } from "../deployer/testDeployer";

describe("LinearInterestRateModel", function () {
  let linearModelDeployer: LinearInterestRateModelDeployer;
  let linearInterestRateModel: LinearInterestRateModel;
  let errors: Errors;

  before(async () => {
    const td = new TestDeployer();
    errors = await td.getErrors();
  });

  it("[LR-1]: calcBorrowRate correctly computes borrowRate", async function () {
    const testCases = [
      {
        model: { Uoptimal: 80, Rbase: 0, Rslope1: 4, Rslope2: 75 },
        expectedLiquidity: 1000,
        availableLiquidity: 1000,
        expectedResult: 0,
      },
      {
        model: { Uoptimal: 80, Rbase: 0, Rslope1: 4, Rslope2: 75 },
        expectedLiquidity: 1000,
        availableLiquidity: 0,
        expectedResult: 7900,
      },
      {
        model: { Uoptimal: 0, Rbase: 0, Rslope1: 4, Rslope2: 75 },
        expectedLiquidity: 1000,
        availableLiquidity: 400,
        expectedResult: 4900,
      },
    ];

    for (let testCase of testCases) {
      linearModelDeployer = new LinearInterestRateModelDeployer(testCase.model);
      linearInterestRateModel =
        await linearModelDeployer.getLinearInterestRateModel();
      // console.log(linearModelDeployer.model.calcBorrowRate(1000, 0));
      const result = await linearInterestRateModel.calcBorrowRate(
        testCase.expectedLiquidity,
        testCase.availableLiquidity
      );
      expect(result.mul(10000).div(RAY)).to.be.eq(testCase.expectedResult);
    }
  });

  it("[LR-2]: getModelParameters returns correct model parameters ", async function () {
    linearModelDeployer = new LinearInterestRateModelDeployer({
      Uoptimal: 11,
      Rbase: 9,
      Rslope1: 4,
      Rslope2: 75,
    });

    linearInterestRateModel =
      await linearModelDeployer.getLinearInterestRateModel();
    const [uOptinal, rBase, rSlope1, rSlope2] =
      await linearInterestRateModel.getModelParameters();
    expect(uOptinal).to.be.eq(1100);
    expect(rBase.mul(10000).div(RAY)).to.be.eq(900);
    expect(rSlope1.mul(10000).div(RAY)).to.be.eq(400);
    expect(rSlope2.mul(10000).div(RAY)).to.be.eq(7500);
  });

  it("[LR-3]: calcBorrowRate returns Rbase if expected liquidity is 0", async function () {
    linearModelDeployer = new LinearInterestRateModelDeployer({
      Uoptimal: 80,
      Rbase: 1,
      Rslope1: 4,
      Rslope2: 75,
    });

    linearInterestRateModel =
      await linearModelDeployer.getLinearInterestRateModel();
    const result = await linearInterestRateModel.calcBorrowRate(0, 0);
    expect(result).to.be.eq(RAY.div(100));
  });

  it("[LR-4]: calcBorrowRate returns Rbase if expected liquidity is 0", async function () {
    linearModelDeployer = new LinearInterestRateModelDeployer({
      Uoptimal: 80,
      Rbase: 1,
      Rslope1: 4,
      Rslope2: 75,
    });

    linearInterestRateModel =
      await linearModelDeployer.getLinearInterestRateModel();
    const result = await linearInterestRateModel.calcBorrowRate(12, 100);
    expect(result).to.be.eq(RAY.div(100));
  });

  it("[LR-5]: linear model revers with incorrect parameters", async () => {
    const revertMsg = await errors.INCORRECT_PARAMETER();

    const testCases = [
      {
        Uoptimal: 100.1,
        Rbase: 0,
        Rslope1: 4,
        Rslope2: 75,
      },
      {
        Uoptimal: 80,
        Rbase: 100.1,
        Rslope1: 4,
        Rslope2: 75,
      },
      {
        Uoptimal: 0,
        Rbase: 0,
        Rslope1: 100.1,
        Rslope2: 75,
      },
    ];

    for (let testCase of testCases) {
      linearModelDeployer = new LinearInterestRateModelDeployer(testCase);
      await expect(
        linearModelDeployer.getLinearInterestRateModel()
      ).to.be.revertedWith(revertMsg);
    }
  });
});

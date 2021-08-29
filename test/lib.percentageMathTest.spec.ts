import { expect } from "../utils/expect";

import { Errors, PercentageMathTest } from "../types/ethers-v5";
import { TestDeployer } from "../deployer/testDeployer";
import { MAX_INT, PERCENTAGE_FACTOR } from "@diesellabs/gearbox-sdk";

describe("PercentageMathTest", function () {
  let testDeployer: TestDeployer;
  let percentageMathTest: PercentageMathTest;
  let errors: Errors;

  beforeEach(async function () {
    testDeployer = new TestDeployer();
    percentageMathTest = await testDeployer.getPercentageMathTest();
    errors = await testDeployer.getErrors();
  });

  it("[PM-1]: percentMul computes correctly", async function () {
    const revertMsg = await errors.MATH_MULTIPLICATION_OVERFLOW();

    expect(await percentageMathTest.percentMul(0, 10)).to.be.eq(0);
    expect(await percentageMathTest.percentMul(10, 0)).to.be.eq(0);

    await expect(percentageMathTest.percentMul(MAX_INT, 120)).revertedWith(
      revertMsg
    );

    expect(
      await percentageMathTest.percentMul(1400, 2 * PERCENTAGE_FACTOR)
    ).to.be.eq(2800);
    expect(
      await percentageMathTest.percentMul(1400, PERCENTAGE_FACTOR / 2)
    ).to.be.eq(700);
  });

  it("[PM-2]: percentDiv computes correctly", async function () {
    const revertDivisionZero = await errors.MATH_DIVISION_BY_ZERO();
    const revertOverflow = await errors.MATH_MULTIPLICATION_OVERFLOW();

    await expect(percentageMathTest.percentDiv(123, 0)).to.be.revertedWith(
      revertDivisionZero
    );
    await expect(percentageMathTest.percentDiv(MAX_INT, 10)).to.be.revertedWith(
      revertOverflow
    );

    expect(await percentageMathTest.percentDiv(200, 1000)).to.be.eq(2000);
    expect(await percentageMathTest.percentDiv(200, 2000)).to.be.eq(1000);
  });
});

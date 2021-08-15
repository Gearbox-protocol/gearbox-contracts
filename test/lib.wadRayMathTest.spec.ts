import { expect } from "../utils/expect";

import { Errors, WadRayMathTest } from "../types/ethers-v5";
import { TestDeployer } from "../deployer/testDeployer";
import { MAX_INT, RAY, WAD } from "@diesellabs/gearbox-sdk";

describe("WadRayMathTest", function () {
  let testDeployer: TestDeployer;
  let wadRayMathTest: WadRayMathTest;
  let errors: Errors;

  beforeEach(async function () {
    testDeployer = new TestDeployer();
    wadRayMathTest = await testDeployer.getWadRayMathTest();
    errors = await testDeployer.getErrors();
  });

  it("[WRM-1]: ray() returns RAY, wad() returns WAD", async function () {
    expect(await wadRayMathTest.ray()).to.be.eq(RAY);
    expect(await wadRayMathTest.wad()).to.be.eq(WAD);
  });

  it("[WRM-2]: halfRay() returns RAY/2, halfWad() returns WAD/2", async function () {
    expect(await wadRayMathTest.halfRay()).to.be.eq(RAY.div(2));
    expect(await wadRayMathTest.halfWad()).to.be.eq(WAD.div(2));
  });

  it("[WRM-3]: wadMul() computes correctly", async function () {
    const revertMsg = await errors.MATH_MULTIPLICATION_OVERFLOW();
    expect(await wadRayMathTest.wadMul(0, 0)).to.be.eq(0);
    await expect(wadRayMathTest.wadMul(WAD, MAX_INT)).to.be.revertedWith(
      revertMsg
    );

    const a = WAD.mul(5);
    const b = WAD.mul(5);
    expect(await wadRayMathTest.wadMul(a, b)).to.be.eq(WAD.mul(25));
  });

  it("[WRM-4]: wadDiv() computes correctly", async function () {
    const revertMsg = await errors.MATH_DIVISION_BY_ZERO();
    const revertMsg2 = await errors.MATH_MULTIPLICATION_OVERFLOW();

    await expect(wadRayMathTest.wadDiv(WAD, 0)).to.be.revertedWith(revertMsg);
    await expect(wadRayMathTest.wadDiv(MAX_INT, WAD)).to.be.revertedWith(
      revertMsg2
    );

    const a = WAD.mul(25);
    const b = WAD.mul(5);
    expect(await wadRayMathTest.wadDiv(a, b)).to.be.eq(WAD.mul(5));
  });

  it("[WRM-5]: rayMul() computes correctly", async function () {
    const revertMsg = await errors.MATH_MULTIPLICATION_OVERFLOW();
    expect(await wadRayMathTest.rayMul(0, 0)).to.be.eq(0);
    await expect(wadRayMathTest.rayMul(RAY, MAX_INT)).to.be.revertedWith(
      revertMsg
    );

    const a = RAY.mul(5);
    const b = RAY.mul(5);
    expect(await wadRayMathTest.rayMul(a, b)).to.be.eq(RAY.mul(25));
  });

  it("[WRM-6]: rayDiv() computes correctly", async function () {
    const revertMsg = await errors.MATH_DIVISION_BY_ZERO();
    const revertMsg2 = await errors.MATH_MULTIPLICATION_OVERFLOW();

    await expect(wadRayMathTest.rayDiv(WAD, 0)).to.be.revertedWith(revertMsg);
    await expect(wadRayMathTest.rayDiv(MAX_INT, WAD)).to.be.revertedWith(
      revertMsg2
    );

    const a = RAY.mul(25);
    const b = RAY.mul(5);
    expect(await wadRayMathTest.rayDiv(a, b)).to.be.eq(RAY.mul(5));
  });

  it("[WRM-7]: rayToWad() computes correctly", async function () {
    const revertMsg = await errors.MATH_ADDITION_OVERFLOW();
    await expect(wadRayMathTest.rayToWad(MAX_INT)).to.be.revertedWith(
      revertMsg
    );
    expect(await wadRayMathTest.rayToWad(RAY)).to.be.eq(WAD);
  });

  it("[WRM-8]: wadToRay() computes correctly", async function () {
    const revertMsg = await errors.MATH_MULTIPLICATION_OVERFLOW();
    await expect(wadRayMathTest.wadToRay(MAX_INT)).to.be.revertedWith(
      revertMsg
    );
    expect(await wadRayMathTest.wadToRay(WAD)).to.be.eq(RAY);
  });
});

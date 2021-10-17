// @ts-ignore
import { ethers } from "hardhat";
import { expect } from "../utils/expect";

import { MockPoolService } from "../types/ethers-v5";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { TestDeployer } from "../deployer/testDeployer";
import { DUMB_ADDRESS } from "../core/constants";
import { RAY } from "@diesellabs/gearbox-sdk";

describe("MockPoolService", function () {
  let deployer: SignerWithAddress;
  let user: SignerWithAddress;
  let testDeployer: TestDeployer;
  let mocksMockPoolService: MockPoolService;

  beforeEach(async function () {
    deployer = (await ethers.getSigners())[0];
    user = (await ethers.getSigners())[1];

    testDeployer = new TestDeployer();

    mocksMockPoolService = await testDeployer.getPoolMockForCreditManagerTest(
      DUMB_ADDRESS
    );
  });

  it("[MPS-1]: stubFunctions works as excected", async function () {
    expect(await mocksMockPoolService.expectedLiquidity()).to.be.eq(0);
    expect(await mocksMockPoolService.getDieselRate_RAY()).to.be.eq(RAY);
    expect(await mocksMockPoolService.creditManagersCount()).to.be.eq(1);

    await mocksMockPoolService.removeLiquidity(12, DUMB_ADDRESS);
    await mocksMockPoolService.forbidCreditManagerToBorrow(DUMB_ADDRESS);
    await mocksMockPoolService.newInterestRateModel(DUMB_ADDRESS);

    await mocksMockPoolService.pause();
    await mocksMockPoolService.unpause();
    await mocksMockPoolService.setExpectedLiquidityLimit(1);
    await mocksMockPoolService.paused();
    await mocksMockPoolService.setWithdrawFee(1);
  });
});

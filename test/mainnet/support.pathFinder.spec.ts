/*
 * SPDX-License-Identifier: BSL-1.1
 * Gearbox. Generalized leverage protocol, which allows to take leverage and then use it across other DeFi protocols and platforms in a composable way.
 * (c) Gearbox.fi, 2021
 */

// @ts-ignore
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";

import { PathFinder, PathFinder__factory } from "../../types/ethers-v5";
import {
  AdapterInterface,
  ADDRESS_0x0,
  SwapType,
  tokenDataByNetwork,
  UNISWAP_V2_ROUTER,
  UNISWAP_V3_QUOTER,
  UNISWAP_V3_ROUTER,
  WAD,
} from "@diesellabs/gearbox-sdk";
import { expect } from "../../utils/expect";
import { UniV2helper, UniV3helper } from "@diesellabs/gearbox-leverage";
import * as dotenv from "dotenv";

describe("Pathfinder  (Mainnet test)", function () {
  this.timeout(0);

  let pathFinder: PathFinder;
  let deployer: SignerWithAddress;

  before(async () => {
    dotenv.config({ path: ".env.local" });
    const addressProvider = process.env.REACT_APP_ADDRESS_PROVIDER || "";

    const accounts = (await ethers.getSigners()) as Array<SignerWithAddress>;
    deployer = accounts[0];

    const contractName = "PathFinder";
    const pathFinderFactory = (await ethers.getContractFactory(
      contractName
    )) as PathFinder__factory;

    pathFinder = await pathFinderFactory.deploy(addressProvider);
    await pathFinder.deployed();
  });

  it("[PF-1]: swapExactTokenToTokens works correctly", async () => {
    const uniV2helper = await UniV2helper.getHelper(
      "UniswapVV2",
      UNISWAP_V2_ROUTER,
      ADDRESS_0x0,
      pathFinder.address,
      deployer
    );

    const from = tokenDataByNetwork.Mainnet.DAI.address;
    const to = tokenDataByNetwork.Mainnet.LINK.address;

    const jsResult = await uniV2helper.findBestRouteJS(
      SwapType.ExactInput,
      from,
      to,
      WAD
    );

    const solResult = await pathFinder.callStatic.bestUniPath(
      AdapterInterface.UniswapV2,
      UNISWAP_V2_ROUTER,
      1,
      from,
      to,
      WAD,
      uniV2helper.connectors
    );

    expect(solResult.rate).to.be.eq(jsResult.rate);
    expect(solResult.expectedAmount).to.be.eq(jsResult.expectedAmount);
    expect(solResult.path.length).to.be.eq(jsResult.path.length);
    for (let i = 0; i < solResult.path.length; i++) {
      expect(solResult.path[i].toLowerCase()).to.be.eq(
        jsResult.path[i].toLowerCase()
      );
    }
  });

  it("[PF-2]: unniswapV3 works correctly", async () => {
    const uniV3helper = await UniV3helper.getHelper(
      "UniswapV3",
      UNISWAP_V3_ROUTER,
      ADDRESS_0x0,
      UNISWAP_V3_QUOTER,
      pathFinder.address,
      deployer
    );

    const from = tokenDataByNetwork.Mainnet.DAI.address;
    const to = tokenDataByNetwork.Mainnet.LINK.address;

    const jsResult = await uniV3helper.findBestRoute(
      SwapType.ExactInput,
      from,
      to,
      WAD
    );

    const solResult = await pathFinder.callStatic.bestUniPath(
      AdapterInterface.UniswapV3,
      UNISWAP_V3_QUOTER,
      1,
      from,
      to,
      WAD,
      uniV3helper.connectors
    );

    expect(solResult.rate).to.be.eq(jsResult.rate);
    expect(solResult.expectedAmount).to.be.eq(jsResult.expectedAmount);
    expect(solResult.path).to.be.eql(jsResult.path);
  });

  it("[PF-3]: bestRate", async () => {});
});

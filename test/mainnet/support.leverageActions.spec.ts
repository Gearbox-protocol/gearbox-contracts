/*
 * SPDX-License-Identifier: BSL-1.1
 * Gearbox. Generalized leverage protocol, which allows to take leverage and then use it across other DeFi protocols and platforms in a composable way.
 * (c) Gearbox.fi, 2021
 */

// @ts-ignore
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";

import { PathFinder, PathFinder__factory } from "../../types/ethers-v5";
import { CreditManagerData, SwapType, TokenData, tokenDataByNetwork, WAD } from "@diesellabs/gearbox-sdk";
import { MainnetSuite } from "./helper";
import { getMainnetTokenData } from "../../utils/tokenData";
import { BigNumber } from "ethers";
import { AdapterManager } from "@diesellabs/gearbox-leverage";
import * as dotenv from "dotenv";

describe("LeveragedActions", function () {
  this.timeout(100000000);

  let ts: MainnetSuite;
  let pathFinder: PathFinder;
  let deployer: SignerWithAddress;
  let cmList: Array<CreditManagerData>;
  let tokenData: Record<string, TokenData> = {};

  before(async () => {
    dotenv.config({ path: ".env.local" });
    const addressProvider = process.env.REACT_APP_ADDRESS_PROVIDER || "";

    ts = await MainnetSuite.getSuite();
    const accounts = (await ethers.getSigners()) as Array<SignerWithAddress>;
    deployer = accounts[0];

    const contractName = "PathFinder";
    const pathFinderFactory = (await ethers.getContractFactory(
      contractName
    )) as PathFinder__factory;

    pathFinder = await pathFinderFactory.deploy(addressProvider);
    await pathFinder.deployed();

    cmList = (
      await ts.dataCompressor.getCreditManagersList(deployer.address)
    ).map((c) => new CreditManagerData(c));

    const td = await getMainnetTokenData(deployer);
    td.forEach((t) => (tokenData[t.address.toLowerCase()] = t));
  });

  it("[LA-1]: swapExactTokenToTokens works correctly", async () => {
    const am = await AdapterManager.getManager(cmList[0], pathFinder.address, deployer);

    const paths = await am.getPaths(
      SwapType.ExactInput,
      tokenDataByNetwork.Mainnet.DAI.address,
      tokenDataByNetwork.Mainnet.USDC.address,
      WAD
    );

    console.log(
      paths.map(
        (p) => `${p.getName()} ${p.tradePath.expectedAmount.toString()}`
      )
    );
  });

  it("[LA-2]: swapExactTokenToTokens works correctly", async () => {
    const cm = cmList[0];
    const am = await AdapterManager.getManager(cm, pathFinder.address, deployer)
    const actions = am.getActionsList();

    for (let a of actions) {
      let aAsset: string;

      switch (a.type) {
        case "vanilla":
          continue;
        case "short":
          aAsset = a.asset;
          break;
        case "long_farm":
        case "long":
        case "farm":
          aAsset = a.collateral;
          break;
        case "short_farm":
          aAsset = a.fromAsset;
          break;
      }

      const decimals = tokenData[aAsset.toLowerCase()].decimals;

      console.log(a.toString(tokenData));
      const lp = await a.compute(BigNumber.from(10).pow(decimals).mul(5), 400);
      console.log(lp.showPath(tokenData));
    }
  });
});

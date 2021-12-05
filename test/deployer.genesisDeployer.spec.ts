/*
 * SPDX-License-Identifier: BSL-1.1
 * Gearbox. Generalized leverage protocol, which allows to take leverage and then use it across other DeFi protocols and platforms in a composable way.
 * (c) Gearbox.fi, 2021
 */
// @ts-ignore
import { ethers } from "hardhat";
import { expect } from "../utils/expect";

import {
  AccountFactory__factory,
  AccountMining__factory,
  ACL__factory,
  AddressProvider,
  AddressProvider__factory,
  ERC20,
  GearToken,
  GearToken__factory,
  GenesisDeployer,
  GenesisDeployer__factory,
  IAppAddressProvider__factory,
  ICreditAccount__factory,
  PriceOracle__factory,
  StepVesting__factory,
  TokenDistributor,
  TokenDistributor__factory,
  YearnPriceFeed__factory,
} from "../types/ethers-v5";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import {
  ADDRESS_0x0,
  MAX_INT,
  PERCENTAGE_FACTOR,
  SECONDS_PER_YEAR,
  TokenShare,
  WAD,
} from "@diesellabs/gearbox-sdk";
import {
  DUMB_ADDRESS,
  DUMB_ADDRESS2,
  OWNABLE_REVERT_MSG,
} from "../core/constants";
import { TestDeployer } from "../deployer/testDeployer";
import { BigNumberish, BytesLike } from "ethers";
import { MerkleDistributorInfo, parseAccounts } from "../merkle/parse-accounts";
import { IntegrationsDeployer } from "../deployer/integrationsDeployer";

describe("GenesisDeployer", function () {
  let deployer: SignerWithAddress;
  let angel: SignerWithAddress;
  let user: SignerWithAddress;
  let friend: SignerWithAddress;
  let independent: SignerWithAddress;

  let testDeployer: TestDeployer;

  let genesisDeployer: GenesisDeployer;


  let tokenA: ERC20;
  let tokenB: ERC20;

  let contractA: string;
  let contractB: string;

  const treasury = DUMB_ADDRESS;


  let addressProvider: AddressProvider;

  beforeEach(async () => {
    deployer = (await ethers.getSigners())[0] as SignerWithAddress;
    angel = (await ethers.getSigners())[1] as SignerWithAddress;
    user = (await ethers.getSigners())[2] as SignerWithAddress;
    friend = (await ethers.getSigners())[3] as SignerWithAddress;
    independent = (await ethers.getSigners())[4] as SignerWithAddress;

    testDeployer = new TestDeployer();
    const wethMock = await testDeployer.getWethMock();

    const genesisDeployerFactory = (await ethers.getContractFactory(
      "GenesisDeployer"
    )) as GenesisDeployer__factory;



    tokenA = await testDeployer.getTokenMock("tokenA", "TTA");
    tokenB = await testDeployer.getTokenMock("tokenB", "TTb");

    contractA = DUMB_ADDRESS;
    contractB = DUMB_ADDRESS2;

    const miningApprovals = [
      { token: tokenA.address, swapContract: contractA },
      { token: tokenA.address, swapContract: contractB },
      { token: tokenB.address, swapContract: contractA },
    ];

    genesisDeployer = await genesisDeployerFactory.deploy({
      wethToken: wethMock.address,
      treasury,
      miningApprovals,
    });

    addressProvider = AddressProvider__factory.connect(
      await genesisDeployer.addressProvider(),
      deployer
    );
  });

  it("[GD-1]: sets contracts needed in address provider", async () => {
    await addressProvider.getAccountFactory();
    const acl = ACL__factory.connect(await addressProvider.getACL(), deployer);

    await addressProvider.getContractsRegister();

    await addressProvider.getDataCompressor();

    const priceOracle = await addressProvider.getPriceOracle();

    expect(await genesisDeployer.priceOracle()).to.be.eq(priceOracle);

    await addressProvider.getAccountFactory();
    await addressProvider.getWETHGateway();

    const gearToken = GearToken__factory.connect(
      await addressProvider.getGearToken(),
      deployer
    );


    expect(await gearToken.transfersAllowed()).to.be.false;
    expect(await gearToken.balanceOf(deployer.address)).to.be.eq(
      (await gearToken.totalSupply())
    );

    expect(await addressProvider.owner()).to.be.hexEqual(deployer.address);
    expect(await acl.owner()).to.be.hexEqual(deployer.address);
  });

  it("[GD-2]: set correctly mining approvals", async () => {
    const addressProvider = AddressProvider__factory.connect(
      await genesisDeployer.addressProvider(),
      deployer
    );

    const accountFactory = AccountFactory__factory.connect(
      await addressProvider.getAccountFactory(),
      deployer
    );

    const receipt = await accountFactory.mineCreditAccount();

    expect(await accountFactory.countCreditAccounts()).to.be.eq(2);
    const newAcc = await accountFactory.tail();
    const creditAccount = ICreditAccount__factory.connect(newAcc, deployer);
    expect(await creditAccount.borrowedAmount()).to.be.eq(1);
    expect(await creditAccount.cumulativeIndexAtOpen()).to.be.eq(1);
    expect(await creditAccount.since()).to.be.eq(receipt.blockNumber);
    expect(await creditAccount.creditManager()).to.be.eq(
      accountFactory.address
    );

    expect(
      await tokenA.allowance(creditAccount.address, contractA),
      "Allowance tokenA, contractA"
    ).to.be.eq(MAX_INT);

    expect(
      await tokenA.allowance(creditAccount.address, contractB),
      "Allowance tokenA, contractB"
    ).to.be.eq(MAX_INT);

    expect(
      await tokenB.allowance(creditAccount.address, contractA),
      "Allowance tokenB, contractA"
    ).to.be.eq(MAX_INT);

    expect(
      await tokenB.allowance(creditAccount.address, contractB),
      "Allowance tokenB, contractB"
    ).to.be.eq(0);
  });

  it("[GD-3]: addPriceFeeds reverts if called by non-owner", async () => {
    await expect(
      genesisDeployer.connect(user).addPriceFeeds([], [])
    ).to.be.revertedWith(OWNABLE_REVERT_MSG);
  });

  it("[GD-4]: addPriceFeeds correctly connects price feeds", async () => {
    const rate = WAD.mul(244).div(1000);

    const chainlinkOracleA = await testDeployer.getChainlinkPriceFeedMock(rate);
    const chainlinkOracleB = await testDeployer.getChainlinkPriceFeedMock(rate);

    const yVault = await new IntegrationsDeployer().getYearnVaultMock(
      tokenB.address
    );

    const acl = ACL__factory.connect(await genesisDeployer.acl(), deployer);
    await acl.transferOwnership(genesisDeployer.address);

    const priceOracle = PriceOracle__factory.connect(
      await genesisDeployer.priceOracle(),
      deployer
    );

    await genesisDeployer.addPriceFeeds(
      [
        {
          token: tokenA.address,
          priceFeed: chainlinkOracleA.address,
        },
        {
          token: tokenB.address,
          priceFeed: chainlinkOracleB.address,
        },
      ],
      [
        {
          yVault: yVault.address,
          lowerBound: 20,
          upperBound: PERCENTAGE_FACTOR * 3,
        },
      ]
    );

    expect(await acl.owner()).to.be.eq(deployer.address);
    expect(await priceOracle.priceFeeds(tokenA.address)).to.be.eq(
      chainlinkOracleA.address
    );
    expect(await priceOracle.priceFeeds(tokenB.address)).to.be.eq(
      chainlinkOracleB.address
    );

    const yPriceFeedAddress = await priceOracle.priceFeeds(yVault.address);
    expect(yPriceFeedAddress).not.to.be.hexEqual(ADDRESS_0x0);

    const yPriceFeed = YearnPriceFeed__factory.connect(
      yPriceFeedAddress,
      deployer
    );

    expect(await yPriceFeed.lowerBound()).to.be.eq(20);
    expect(await yPriceFeed.upperBound()).to.be.eq(PERCENTAGE_FACTOR * 3);
  });


});

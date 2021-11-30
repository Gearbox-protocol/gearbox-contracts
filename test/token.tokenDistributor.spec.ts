/*
 * SPDX-License-Identifier: BSL-1.1
 * Gearbox. Generalized leverage protocol, which allows to take leverage and then use it across other DeFi protocols and platforms in a composable way.
 * (c) Gearbox.fi, 2021
 */
// @ts-ignore
import { ethers } from "hardhat";
import { expect } from "../utils/expect";

import {
  AddressProvider,
  Errors,
  GearToken,
  GearToken__factory,
  StepVesting,
  StepVesting__factory,
  TokenDistributor,
  TokenDistributor__factory,
} from "../types/ethers-v5";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import {
  ADDRESS_0x0,
  PERCENTAGE_FACTOR,
  SECONDS_PER_YEAR,
  TokenShare,
  VotingPower,
  WAD,
} from "@diesellabs/gearbox-sdk";
import { DUMB_ADDRESS, DUMB_ADDRESS2 } from "../core/constants";
import { CoreDeployer } from "../deployer/coreDeployer";
import { TestDeployer } from "../deployer/testDeployer";

describe("TokenDistributor", function () {
  let deployer: SignerWithAddress;
  let angel: SignerWithAddress;
  let user: SignerWithAddress;
  let friend: SignerWithAddress;
  let independent: SignerWithAddress;

  let addressProvider: AddressProvider;
  let gearToken: GearToken;
  let td: TokenDistributor;

  let contributorsA: Array<TokenShare>;
  let contributorsB: Array<TokenShare>;

  const treasury = DUMB_ADDRESS;

  let errors: Errors;

  beforeEach(async () => {
    deployer = (await ethers.getSigners())[0] as SignerWithAddress;
    angel = (await ethers.getSigners())[1] as SignerWithAddress;
    user = (await ethers.getSigners())[2] as SignerWithAddress;
    friend = (await ethers.getSigners())[3] as SignerWithAddress;
    independent = (await ethers.getSigners())[4] as SignerWithAddress;

    const coreDeployer = new CoreDeployer({});

    addressProvider = await coreDeployer.getAddressProvider();
    await coreDeployer.getACL();

    const gearTokenFactory = (await ethers.getContractFactory(
      "GearToken"
    )) as GearToken__factory;

    gearToken = await gearTokenFactory.deploy(deployer.address);
    await gearToken.deployed();

    await addressProvider.setGearToken(gearToken.address);
    // await gearToken.setMiner(miner.address);

    const gearTokenDistributorFactory = (await ethers.getContractFactory(
      "TokenDistributor"
    )) as TokenDistributor__factory;

    td = await gearTokenDistributorFactory.deploy(addressProvider.address);
    await td.deployed();

    await gearToken.setMiner(td.address);

    contributorsA = [
      {
        holder: angel.address,
        amount: WAD.mul(10e8),
        isCompany: false,
      },
    ];

    contributorsB = [
      {
        holder: user.address,
        amount: WAD.mul(5e8),
        isCompany: false,
      },
      {
        holder: friend.address,
        amount: WAD.mul(5e8),
        isCompany: true,
      },
    ];

    const testDeployer = new TestDeployer();
    errors = await testDeployer.getErrors();
  });

  const changeReceiver = async (
    prevReceiver: SignerWithAddress,
    newReceiver: string
  ): Promise<StepVesting> => {
    const vestingContract = StepVesting__factory.connect(
      (await td.vestingContracts(prevReceiver.address)).contractAddress,
      prevReceiver
    );

    await vestingContract.setReceiver(newReceiver);
    return vestingContract;
  };

  const expectReceiverChanged = async (
    vc: StepVesting,
    prevReceiver: SignerWithAddress,
    newReceiver: string,
    votingPower: VotingPower
  ) => {
    const vcUser = await td.vestingContracts(prevReceiver.address);
    expect(vcUser.contractAddress).to.be.eq(ADDRESS_0x0);
    expect(vcUser.votingPower).to.be.eq(0);

    const vsNewUser = await td.vestingContracts(newReceiver);
    expect(vsNewUser.contractAddress).to.be.eq(vc.address);
    expect(vsNewUser.votingPower).to.be.eq(votingPower);
  };

  it("[TD-1]: constructor sets correctly gearToken and initial weights", async () => {
    expect(await td.gearToken()).to.be.eq(await addressProvider.getGearToken());
    expect(await td.weightA()).to.be.eq(await td.defaultWeightA());
    expect(await td.weightB()).to.be.eq(await td.defaultWeightB());
  });

  it("[TD-2]: updateVotingWeight, distributeTokens reverts if called by non-configurator", async () => {
    const revertMsg = await errors.ACL_CALLER_NOT_CONFIGURATOR();

    await expect(
      td.connect(user).updateVotingWeights(100, 30)
    ).to.be.revertedWith(revertMsg);

    await expect(td.connect(user).distributeTokens([], [])).to.be.revertedWith(
      revertMsg
    );
  });

  it("[TD-3]: distributeTokens correctly deploys VestingContracts and transfers tokens", async () => {
    await gearToken.transfer(td.address, WAD.mul(2e9));
    await td.distributeTokens(contributorsA, contributorsB);

    const expectedResult = {
      [angel.address]: {
        amount: WAD.mul(10e8),
        vestingPeriod: SECONDS_PER_YEAR,
        votingPower: VotingPower.A,
      },
      [user.address]: {
        amount: WAD.mul(5e8),
        vestingPeriod: (SECONDS_PER_YEAR * 3) / 2,
        votingPower: VotingPower.B,
      },
      [friend.address]: {
        amount: WAD.mul(5e8),
        vestingPeriod: (SECONDS_PER_YEAR * 3) / 2,
        votingPower: VotingPower.ZERO_VOTING_POWER,
      },
    };

    for (let [addr, value] of Object.entries(expectedResult)) {
      const vestingContract = await td.vestingContracts(addr);
      const vc = StepVesting__factory.connect(
        vestingContract.contractAddress,
        deployer
      );

      expect(await vc.cliffDuration()).to.be.eq(SECONDS_PER_YEAR);
      expect(await vc.stepAmount()).to.be.eq(value.amount.div(10000));
      expect(await vc.stepDuration()).to.be.eq(
        Math.floor(value.vestingPeriod / 10000)
      );
      expect(await vc.receiver()).to.be.eq(addr);
      expect(vestingContract.votingPower).to.be.eq(value.votingPower);
      expect(
        await gearToken.balanceOf(vestingContract.contractAddress)
      ).to.be.eq(value.amount);
    }

    expect(await td.countContributors()).to.be.eq(3);

    const contributorsList = await td.contributorsList();
    const vestingContractsList = await td.vestingContractsList();
    const contributorsExpected = Object.keys(expectedResult);

    expect(contributorsList.length).to.be.eq(contributorsExpected.length);

    for (let i = 0; i < contributorsExpected.length; i++) {
      expect(contributorsList[i]).hexEqual(contributorsExpected[i]);
      const vestingContract = await td.vestingContracts(contributorsList[i]);
      expect(contributorsList[i]).hexEqual(contributorsExpected[i]);
      expect(vestingContractsList[i]).hexEqual(vestingContract.contractAddress);
    }
  });

  it("[TD-4]: distributeTokens reverts if not all tokens were distributed", async () => {
    const revertMsg = await errors.TD_NON_ZERO_BALANCE_AFTER_DISTRIBUTION();
    await gearToken.transfer(td.address, WAD.mul(3e9));
    await expect(
      td.distributeTokens(contributorsA, contributorsB)
    ).to.be.revertedWith(revertMsg);
  });

  it("[TD-5]: distributeTokens reverts if there are two contributors with the same address", async () => {
    const revertMsg = await errors.TD_WALLET_IS_ALREADY_CONNECTED_TO_VC();
    await gearToken.transfer(td.address, WAD.mul(3e9));
    await expect(
      td.distributeTokens(contributorsA, [...contributorsB, contributorsA[0]])
    ).to.be.revertedWith(revertMsg);
  });

  it("[TD-6]: contributors votes counts correctly", async () => {
    await gearToken.transfer(independent.address, WAD.mul(1e9));
    await gearToken.transfer(td.address, WAD.mul(2e9));

    await td.distributeTokens(contributorsA, contributorsB);

    await expect(td.updateVotingWeights(2000, 1000))
      .to.emit(td, "NewWeights")
      .withArgs(2000, 1000);

    expect(await td.balanceOf(angel.address)).to.be.eq(
      WAD.mul(10e8).mul(2000).div(PERCENTAGE_FACTOR)
    );
    expect(await td.balanceOf(user.address)).to.be.eq(
      WAD.mul(5e8).mul(1000).div(PERCENTAGE_FACTOR)
    );
    expect(await td.balanceOf(friend.address)).to.be.eq(0);
    expect(await td.balanceOf(independent.address)).to.be.eq(WAD.mul(1e9));

    await gearToken.allowTransfers();
    const gift = WAD.mul(1e8);

    await gearToken.connect(independent).transfer(angel.address, gift);
    await gearToken.connect(independent).transfer(user.address, gift);
    await gearToken.connect(independent).transfer(friend.address, gift);

    expect(await td.balanceOf(angel.address)).to.be.eq(
      WAD.mul(10e8).mul(2000).div(PERCENTAGE_FACTOR).add(gift)
    );
    expect(await td.balanceOf(user.address)).to.be.eq(
      WAD.mul(5e8).mul(1000).div(PERCENTAGE_FACTOR).add(gift)
    );
    expect(await td.balanceOf(friend.address)).to.be.eq(gift);
    expect(await td.balanceOf(independent.address)).to.be.eq(
      WAD.mul(1e9).sub(gift.mul(3))
    );
  });

  it("[TD-7]: contributors votes as zero if receiver was changed but not updated in TokenDistributor, and correcyly after update", async () => {
    const newUser = DUMB_ADDRESS;

    await gearToken.transfer(independent.address, WAD.mul(1e9));
    await gearToken.transfer(td.address, WAD.mul(2e9));

    await td.distributeTokens(contributorsA, contributorsB);

    await expect(td.updateVotingWeights(2000, 1000));

    await changeReceiver(user, newUser);

    expect(
      await td.balanceOf(user.address),
      "User balance after changing receiver"
    ).to.be.eq(0);

    await td.updateContributors();

    expect(await td.balanceOf(newUser)).to.be.eq(
      WAD.mul(5e8).mul(1000).div(PERCENTAGE_FACTOR)
    );
  });

  it("[TD-8]: updateVestingHolder correctly update contributor", async () => {
    const newUser = DUMB_ADDRESS;

    await gearToken.transfer(td.address, WAD.mul(2e9));

    await td.distributeTokens(contributorsA, contributorsB);
    await expect(td.updateVotingWeights(2000, 1000));

    expect(await td.balanceOf(newUser)).to.be.eq(0);

    const userVestingContract = await changeReceiver(user, newUser);

    await expect(td.updateVestingHolder(user.address))
      .to.emit(td, "VestingContractHolderUpdate")
      .withArgs(userVestingContract.address, user.address, DUMB_ADDRESS);

    await expectReceiverChanged(
      userVestingContract,
      user,
      newUser,
      VotingPower.B
    );

    const contributorsList = await td.contributorsList();

    expect(contributorsList.length).to.be.eq(3);
    expect(
      contributorsList.filter((e) => e.toLowerCase() === newUser.toLowerCase())
        .length
    ).to.be.eq(1);
    expect(
      contributorsList.filter(
        (e) => e.toLowerCase() === user.address.toLowerCase()
      ).length
    ).to.be.eq(0);

    expect(await td.balanceOf(newUser)).to.be.eq(
      WAD.mul(5e8).mul(1000).div(PERCENTAGE_FACTOR)
    );
  });

  it("[TD-9]: updateVestingHolder revers if prevHolder isn't in the set", async () => {
    const revertMsg = await errors.TD_CONTRIBUTOR_IS_NOT_REGISTERED();
    await gearToken.transfer(td.address, WAD.mul(2e9));

    await td.distributeTokens(contributorsA, contributorsB);
    await expect(td.updateVestingHolder(DUMB_ADDRESS)).to.be.revertedWith(
      revertMsg
    );
  });

  it("[TD-10]: updateVestingHolder do nothing if address is not changed", async () => {
    await gearToken.transfer(td.address, WAD.mul(2e9));

    await td.distributeTokens(contributorsA, contributorsB);
    await td.updateVestingHolder(user.address);

    const filter = td.filters.VestingContractHolderUpdate();
    const events = await td.queryFilter(filter);

    expect(events.length).to.be.eq(0);
  });

  it("[TD-11]: updateVestingHolder correctly update contributor", async () => {
    const newUser = DUMB_ADDRESS;
    const newFriend = DUMB_ADDRESS2;

    await gearToken.transfer(td.address, WAD.mul(2e9));

    await td.distributeTokens(contributorsA, contributorsB);
    await expect(td.updateVotingWeights(2000, 1000));

    expect(await td.balanceOf(newUser)).to.be.eq(0);

    const userVestingContract = await changeReceiver(user, newUser);
    const friendVestingContract = await changeReceiver(friend, newFriend);

    await expect(td.updateContributors())
      .to.emit(td, "VestingContractHolderUpdate")
      .withArgs(userVestingContract.address, user.address, newUser)
      .to.emit(td, "VestingContractHolderUpdate")
      .withArgs(friendVestingContract.address, friend.address, newFriend);

    await expectReceiverChanged(
      userVestingContract,
      user,
      newUser,
      VotingPower.B
    );
    await expectReceiverChanged(
      friendVestingContract,
      friend,
      newFriend,
      VotingPower.ZERO_VOTING_POWER
    );

    const contributorsList = await td.contributorsList();

    expect(contributorsList.length).to.be.eq(3);
    expect(
      contributorsList.filter((e) => e.toLowerCase() === newUser.toLowerCase())
        .length
    ).to.be.eq(1);
    expect(
      contributorsList.filter(
        (e) => e.toLowerCase() === user.address.toLowerCase()
      ).length
    ).to.be.eq(0);

    expect(await td.balanceOf(newUser)).to.be.eq(
      WAD.mul(5e8).mul(1000).div(PERCENTAGE_FACTOR)
    );
  });

  it("[TD-12]: updateVotingWeight updates weight and emit events correctly ", async () => {
    const newA = 1200;
    const newB = 500;

    expect(await td.weightA()).to.be.not.eq(newA);
    expect(await td.weightB()).to.be.not.eq(newB);

    await expect(td.updateVotingWeights(newA, newB))
      .to.emit(td, "NewWeights")
      .withArgs(newA, newB);

    expect(await td.weightA()).to.be.eq(newA);
    expect(await td.weightB()).to.be.eq(newB);
  });

  it("[TD-13]: updateVotingWeight reverts for incorrect weights", async () => {
    const revertMsg = await errors.TD_INCORRECT_WEIGHTS();

    await expect(td.updateVotingWeights(10001, 3333)).to.revertedWith(
      revertMsg
    );

    await expect(td.updateVotingWeights(3000, 3333)).to.revertedWith(revertMsg);
  });

  it("[TD-14]: updateVestingHolder revers if new wallet could replace previous", async () => {
    const revertMsg = await errors.TD_WALLET_IS_ALREADY_CONNECTED_TO_VC();
    await gearToken.transfer(td.address, WAD.mul(2e9));

    await td.distributeTokens(contributorsA, contributorsB);

    await changeReceiver(user, friend.address);

    await expect(td.updateVestingHolder(user.address)).to.be.revertedWith(
      revertMsg
    );

    await expect(td.updateContributors()).to.be.revertedWith(
      revertMsg
    );

  });
});

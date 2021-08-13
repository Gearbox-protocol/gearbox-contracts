// @ts-ignore
import { ethers } from "hardhat";
import { solidity } from "ethereum-waffle";
import * as chai from "chai";

import { CoreDeployer } from "../deployer/coreDeployer";
import { TestDeployer } from "../deployer/testDeployer";
import { AccountMinerAuction, Errors } from "../types/ethers-v5";
import { BigNumber } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { Bid } from "../core/accountMinerAuction";
import { ACCOUNT_CREATION_REWARD, ADDRESS_0x0, DEPLOYMENT_COST, PAUSABLE_REVERT_MSG } from "../core/constants";
import { formatBytes32String } from "ethers/lib/utils";

chai.use(solidity);
const { expect } = chai;

const bidIncrement = BigNumber.from(10).pow(5);

describe("AccountMinerAuction", function () {
  let deployer: SignerWithAddress;
  let sponsor1: SignerWithAddress;
  let sponsor2: SignerWithAddress;
  let user: SignerWithAddress;
  let coreDeployer: CoreDeployer;
  let testDeployer: TestDeployer;
  let accountMiner: AccountMinerAuction;
  let errors: Errors;

  /// @dev asserts bid and return prevBid address
  const assertBid = async (address: string, bid: Bid) => {
    const [prevBid, amount, nextBid] = await accountMiner.getBid(address);
    expect(prevBid).to.be.hexEqual(bid.prevBid);
    expect(nextBid).to.be.hexEqual(bid.nextBid);
    expect(amount).to.be.eq(bid.amount);
    return prevBid;
  };

  const _mineAccountSetup = async () => {
    await accountMiner.connect(sponsor1).placeBid({ value: DEPLOYMENT_COST });
    await accountMiner
      .connect(sponsor2)
      .placeBid({ value: DEPLOYMENT_COST.add(bidIncrement) });

    // Mint enough token for user rewards
    const gearToken = await coreDeployer.getGearToken();
    await gearToken.mint(accountMiner.address, ACCOUNT_CREATION_REWARD);
  };

  beforeEach(async function () {
    deployer = (await ethers.getSigners())[0];
    sponsor1 = (await ethers.getSigners())[1];
    sponsor2 = (await ethers.getSigners())[2];
    user = (await ethers.getSigners())[3];
    coreDeployer = new CoreDeployer({
      accountMinerType: "auction",
      treasury: "mock",
      weth: "mock",
    });

    testDeployer = new TestDeployer();
    const addressProvider = await coreDeployer.getAddressProvider();
    await addressProvider.setAccountFactory(deployer.address);

    accountMiner = (await coreDeployer.getAccountMiner("auction", false)) as AccountMinerAuction;
    errors = await testDeployer.getErrors();
  });

  it("[AMA-1]: placeBid reverts if sum less than DEPLOYMENT_COST", async function () {
    const revertMsg = await errors.AM_BID_LOWER_THAN_MINIMAL();
    await expect(
      accountMiner.placeBid({ value: DEPLOYMENT_COST.sub(1) })
    ).to.be.revertedWith(revertMsg);
  });

  it("[AMA-2]: placeBid reverts if user already has a bid", async function () {
    const revertMsg = await errors.AM_USER_ALREADY_HAS_BID();

    await accountMiner.placeBid({ value: DEPLOYMENT_COST });
    await expect(
      accountMiner.placeBid({ value: DEPLOYMENT_COST })
    ).to.be.revertedWith(revertMsg);
  });

  it("[AMA-3]: placeBid correctly adds first bid", async function () {
    await expect(accountMiner.placeBid({ value: DEPLOYMENT_COST }))
      .emit(accountMiner, "BidPlaced")
      .withArgs(deployer.address, DEPLOYMENT_COST);
    expect(await accountMiner.getBidsCount()).to.be.eq(1);

    const tail = await accountMiner.tail();
    expect(tail).to.be.hexEqual(deployer.address);

    await assertBid(tail, {
      prevBid: ADDRESS_0x0,
      amount: DEPLOYMENT_COST,
      nextBid: ADDRESS_0x0,
    });
  });

  it("[AMA-4]: placeBid correctly adds two bids", async function () {
    await accountMiner.placeBid({ value: DEPLOYMENT_COST });
    await accountMiner
      .connect(sponsor1)
      .placeBid({ value: DEPLOYMENT_COST.add(1) });
    expect(await accountMiner.getBidsCount()).to.be.eq(2);

    const tail = await accountMiner.tail();
    expect(tail).to.be.hexEqual(sponsor1.address);

    const prevBid1 = await assertBid(tail, {
      prevBid: deployer.address,
      amount: DEPLOYMENT_COST.add(1),
      nextBid: ADDRESS_0x0,
    });

    await assertBid(prevBid1, {
      prevBid: ADDRESS_0x0,
      amount: DEPLOYMENT_COST,
      nextBid: tail,
    });
  });

  it("[AMA-5]: increaseBid reverts if user has no bid", async function () {
    const revertMsg = await errors.AM_USER_HAS_NO_BIDS();

    await expect(
      accountMiner.increaseBid({ value: DEPLOYMENT_COST.add(1) })
    ).to.be.revertedWith(revertMsg);
  });

  it("[AMA-6]: increaseBid reverts if bid lower than allowed", async function () {
    const revertMsg = await errors.AM_BID_LOWER_THAN_MINIMAL();

    await accountMiner
      .connect(sponsor1)
      .placeBid({ value: DEPLOYMENT_COST.add(1) });

    await accountMiner
      .connect(sponsor2)
      .placeBid({ value: DEPLOYMENT_COST.add(100) });

    await expect(
      accountMiner.connect(sponsor1).increaseBid({ value: 5 })
    ).to.be.revertedWith(revertMsg);
  });

  it("[AMA-7]: increaseBid correctly increases bid for one bid", async function () {
    await accountMiner.placeBid({ value: DEPLOYMENT_COST });
    await expect(accountMiner.increaseBid({ value: bidIncrement }))
      .emit(accountMiner, "BidIncreased")
      .withArgs(deployer.address, bidIncrement);
    expect(await accountMiner.getBidsCount()).to.be.eq(1);

    const tail = await accountMiner.tail();
    expect(tail).to.be.hexEqual(deployer.address);

    await assertBid(tail, {
      prevBid: ADDRESS_0x0,
      amount: DEPLOYMENT_COST.add(bidIncrement),
      nextBid: ADDRESS_0x0,
    });
  });

  it("[AMA-8]: increaseBid correctly increases bid for two bids", async function () {
    await accountMiner.placeBid({ value: DEPLOYMENT_COST });
    await accountMiner
      .connect(sponsor1)
      .placeBid({ value: DEPLOYMENT_COST.add(1) });

    await accountMiner.increaseBid({ value: bidIncrement });
    expect(await accountMiner.getBidsCount()).to.be.eq(2);

    // Deployer should have max bid, cause he increased it
    const tail = await accountMiner.tail();
    expect(tail).to.be.hexEqual(deployer.address);

    const prevBid1 = await assertBid(tail, {
      prevBid: sponsor1.address,
      amount: DEPLOYMENT_COST.add(bidIncrement),
      nextBid: ADDRESS_0x0,
    });

    await assertBid(prevBid1, {
      prevBid: ADDRESS_0x0,
      amount: DEPLOYMENT_COST.add(1),
      nextBid: tail,
    });
  });

  it("[AMA-9]: takeBid reverts if user has no bid", async function () {
    const revertMsg = await errors.AM_USER_HAS_NO_BIDS();
    await expect(accountMiner.takeBid()).to.be.revertedWith(revertMsg);
  });

  it("[AMA-10]: takeBid takes first bid correctly when 2 bids were made", async function () {
    await accountMiner.placeBid({ value: DEPLOYMENT_COST });
    await accountMiner
      .connect(sponsor1)
      .placeBid({ value: DEPLOYMENT_COST.add(1) });

    await accountMiner.takeBid();
    expect(await accountMiner.getBidsCount()).to.be.eq(1);

    // Deployer should have max bid, cause he increased it
    const tail = await accountMiner.tail();
    expect(tail).to.be.hexEqual(sponsor1.address);

    await assertBid(tail, {
      prevBid: ADDRESS_0x0,
      amount: DEPLOYMENT_COST.add(1),
      nextBid: ADDRESS_0x0,
    });
  });

  it("[AMA-11]: takeBid takes last bid correctly when 2 bids were made", async function () {
    await accountMiner.placeBid({ value: DEPLOYMENT_COST });
    await accountMiner
      .connect(sponsor1)
      .placeBid({ value: DEPLOYMENT_COST.add(1) });

    await expect(accountMiner.connect(sponsor1).takeBid())
      .emit(accountMiner, "BidTaken")
      .withArgs(sponsor1.address, DEPLOYMENT_COST.add(1));
    expect(await accountMiner.getBidsCount()).to.be.eq(1);

    // Deployer should have max bid, cause he increased it
    const tail = await accountMiner.tail();
    expect(tail).to.be.hexEqual(deployer.address);

    await assertBid(tail, {
      prevBid: ADDRESS_0x0,
      amount: DEPLOYMENT_COST,
      nextBid: ADDRESS_0x0,
    });
  });

  it("[AMA-12]: takeBid correctly returns bid to sponsor", async function () {
    await accountMiner.placeBid({ value: DEPLOYMENT_COST });
    await accountMiner
      .connect(sponsor1)
      .placeBid({ value: DEPLOYMENT_COST.add(1) });

    expect(
      await accountMiner.connect(sponsor1).takeBid()
    ).to.changeEtherBalance(sponsor1, DEPLOYMENT_COST.add(1));
  });

  it("[AMA-13]: mineAccount reverts if was called not by account factory", async function () {
    const revertMsg = await errors.AM_ACCOUNT_FACTORY_ONLY();
    await expect(
      accountMiner.connect(user).mineAccount(user.address)
    ).to.be.revertedWith(revertMsg);
  });

  it("[AMA-14]: mineAccount reverts if was called and no bids were made", async function () {
    // await _sudoAccountManager();
    const revertMsg = await errors.AM_NO_BIDS_WERE_MADE();
    await expect(
      accountMiner.connect(deployer).mineAccount(user.address)
    ).to.be.revertedWith(revertMsg);
  });

  it("[AMA-15]: mineAccount takes max bid and update bids list correctly", async function () {
    await _mineAccountSetup();

    await expect(accountMiner.mineAccount(user.address))
      .emit(accountMiner, "AccountMined")
      .withArgs(sponsor2.address);

    expect(await accountMiner.getBidsCount()).to.be.eq(1);

    // Deployer should have max bid, cause he increased it
    const tail = await accountMiner.tail();
    expect(tail).to.be.hexEqual(sponsor1.address);

    await assertBid(tail, {
      prevBid: ADDRESS_0x0,
      amount: DEPLOYMENT_COST,
      nextBid: ADDRESS_0x0,
    });
  });

  it("[AMA-16]: mineAccount provides tokens to sponsor", async function () {
    await _mineAccountSetup();
    const gearToken = await coreDeployer.getGearToken();
    await expect(() =>
      accountMiner.mineAccount(user.address)
    ).to.changeTokenBalance(gearToken, sponsor2, ACCOUNT_CREATION_REWARD);
  });

  it("[AMA-17]: mineAccount pays DEPLOYMENT_COST compensation for msg.sender", async function () {
    await _mineAccountSetup();
    expect(await accountMiner.mineAccount(user.address)).to.changeEtherBalance(
      user,
      DEPLOYMENT_COST
    );
  });

  it("[AMA-18]: mineAccount correctly transfers funds to treasure", async function () {
    await _mineAccountSetup();
    const treasuryMock = await coreDeployer.getTreasuryMock();
    await expect(accountMiner.mineAccount(user.address))
      .emit(treasuryMock, "NewDonation")
      .withArgs(bidIncrement);
  });

  it("[AMA-19]: takeBid reverts if cant return it to sponsor", async function () {
    // this test use AccountMinerNonReceivableTest.sol to make impossible return
    // return

    const tester = await testDeployer.getAccountMinerNonReceivableTest(
      accountMiner.address
    );
    // Putting bid
    await tester.placeBid({ value: DEPLOYMENT_COST });

    // Trying to take it back, but it'll be reverted by AccountMinerNonReceivableTest.sol
    await expect(tester.takeBid()).to.be.revertedWith(
      "Address: unable to send value, recipient may have reverted"
    );

    const [prevBid, amount, nextBid] = await accountMiner.getBid(
      tester.address
    );
    expect(amount).to.be.eq(DEPLOYMENT_COST);
  });

  it("[AMA-20]: getBidsCount counts bids correrctly", async function () {
    expect(await accountMiner.getBidsCount()).to.be.eq(0);
    await accountMiner.placeBid({ value: DEPLOYMENT_COST });
    expect(await accountMiner.getBidsCount()).to.be.eq(1);
  });

  it("[AMA-21]: placeBid, increaseBid, takeBid reverts if contract is paused", async function () {
    const acl = await coreDeployer.getACL();
    await acl.addPausableAdmin(deployer.address);
    await accountMiner.connect(deployer).pause();

    await expect(
      accountMiner.connect(deployer).placeBid({ value: DEPLOYMENT_COST })
    ).to.revertedWith(PAUSABLE_REVERT_MSG);

    await acl.addUnpausableAdmin(deployer.address);
    // make a bid for further testing
    await accountMiner.connect(deployer).unpause();

    await accountMiner.connect(deployer).placeBid({ value: DEPLOYMENT_COST });

    await accountMiner.connect(deployer).pause();

    await expect(accountMiner.connect(deployer).takeBid()).to.revertedWith(
      PAUSABLE_REVERT_MSG
    );

    await expect(
      accountMiner.connect(deployer).increaseBid({ value: DEPLOYMENT_COST })
    ).to.revertedWith(PAUSABLE_REVERT_MSG);
  });

  it("[AMA-23]: kind returns 'auction'", async function () {
    const kindBytes = formatBytes32String("auction");
    expect(await accountMiner.kind()).to.be.eq(kindBytes);
  });
});

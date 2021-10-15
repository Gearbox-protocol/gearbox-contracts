// @ts-ignore
import { ethers } from "hardhat";
import { expect } from "../utils/expect";

import {
  AccountFactory,
  ContractsRegister,
  CreditAccount__factory,
  Errors,
  ICreditAccount__factory,
} from "../types/ethers-v5";
import { CoreDeployer } from "../deployer/coreDeployer";
import { TestDeployer } from "../deployer/testDeployer";
import { DUMB_ADDRESS, DUMB_ADDRESS2 } from "../core/constants";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { IntegrationsDeployer } from "../deployer/integrationsDeployer";
import { BigNumber } from "ethers";
import { ADDRESS_0x0, MAX_INT } from "@diesellabs/gearbox-sdk";

/**
 * @title TraderAccountFactory test
 * @notice core account factory functions are covered with tests
 * in core.vanillaCreditAccount.spec.ts
 */

describe("AccountFactory", function () {
  let deployer: SignerWithAddress;
  let user: SignerWithAddress;
  let coreDeployer: CoreDeployer;
  let integrationsDeployer: IntegrationsDeployer;
  let testDeployer: TestDeployer;
  let accountFactory: AccountFactory;
  let contractsRegister: ContractsRegister;
  let errors: Errors;

  beforeEach(async () => {
    deployer = (await ethers.getSigners())[0];
    user = (await ethers.getSigners())[1];
    coreDeployer = new CoreDeployer({
      treasury: "mock",
      weth: "mock",
    });
    integrationsDeployer = new IntegrationsDeployer();
    testDeployer = new TestDeployer();
    accountFactory = (await coreDeployer.getAccountFactory()) as AccountFactory;

    contractsRegister = await coreDeployer.getContractsRegister();
    errors = await testDeployer.getErrors();
  });

  it("[AF-1]: constructor correctly creates a genesis credit account", async () => {
    await contractsRegister.addCreditManager(deployer.address);
    const creditAccount = await accountFactory.head();
    expect(await accountFactory.getNext(creditAccount)).to.be.eq(ADDRESS_0x0);
    expect(await accountFactory.tail(), "tail").to.be.eq(creditAccount);
    expect(
      await accountFactory.countCreditAccountsInStock(),
      "accounts in stock"
    ).to.be.eq(1);
    expect(
      await accountFactory.countCreditAccounts(),
      "total credit accounts"
    ).to.be.eq(1);
    expect(
      await accountFactory._contractsRegister(),
      "contracts register"
    ).to.be.eq((await coreDeployer.getContractsRegister()).address);

    const masterAccount = CreditAccount__factory.connect(
      await accountFactory.masterCreditAccount(),
      deployer
    );
    expect(await masterAccount.factory()).to.be.eq(accountFactory.address);
    expect(await accountFactory.getNext(ADDRESS_0x0)).to.be.eq(ADDRESS_0x0);
  });

  it("[AF-2]: takeCreditAccount correctly add credit account", async () => {
    await contractsRegister.addCreditManager(deployer.address);
    await accountFactory.takeCreditAccount(1, 1);
    const initHead = await accountFactory.head();
    const next = await accountFactory.getNext(initHead);
    const next2 = await accountFactory.getNext(next);
    const next3 = await accountFactory.getNext(next2);
    expect(next3).to.be.eq("0x0000000000000000000000000000000000000000");
  });

  it("[AF-3]: takeCreditAccount keeps at least 1 VA in stock", async () => {
    await contractsRegister.addCreditManager(deployer.address);
    await accountFactory.takeCreditAccount(1, 1);
    expect(await accountFactory.countCreditAccountsInStock()).to.be.eq(1);
    await accountFactory.takeCreditAccount(1, 1);
    expect(await accountFactory.countCreditAccountsInStock()).to.be.eq(1);
    await accountFactory.takeCreditAccount(1, 1);
    expect(await accountFactory.countCreditAccountsInStock()).to.be.eq(1);
  });

  it("[AF-5]: takeCreditAccount emits InitializeCreditAccount event", async () => {
    await contractsRegister.addCreditManager(deployer.address);
    const head = await accountFactory.head();

    await expect(accountFactory.takeCreditAccount(1, 1))
      .to.emit(accountFactory, "InitializeCreditAccount")
      .withArgs(head, deployer.address);
  });

  it("[AF-7]: returnCreditAccount set returned container to the end of list", async () => {
    await contractsRegister.addCreditManager(deployer.address);
    const head = await accountFactory.head();
    await accountFactory.takeCreditAccount(1, 1);
    expect(await accountFactory.countCreditAccountsInStock()).to.be.eq(1);

    await accountFactory.returnCreditAccount(head);
    expect(await accountFactory.countCreditAccountsInStock()).to.be.eq(2);

    const headAfterTest = await accountFactory.head();
    const next = await accountFactory.getNext(headAfterTest);

    // next should points on the second VA, which should be is returned one
    expect(next).to.be.eq(head);
    expect(await accountFactory.tail()).to.be.eq(head);
  });

  it("[AF-8]: returnCreditAccount emits ReturnCreditAccount", async () => {
    await contractsRegister.addCreditManager(deployer.address);
    const head = await accountFactory.head();
    await accountFactory.takeCreditAccount(1, 1);
    expect(await accountFactory.countCreditAccountsInStock()).to.be.eq(1);

    await expect(accountFactory.returnCreditAccount(head))
      .to.emit(accountFactory, "ReturnCreditAccount")
      .withArgs(head);
  });

  /**
   * Next section will cover this two conditions:
   *
   * if (_nextCreditAccount[_head] == address(0)) {
   *         _accountMiner.mineAccount(user);
   *         _addCreditAccount();
   *     }
   */

  it("[AF-9]: takeCreditAccount doesn't produce extra VA if not needed", async () => {
    await contractsRegister.addCreditManager(deployer.address);
    const head = await accountFactory.head();
    await accountFactory.takeCreditAccount(1, 1);
    expect(await accountFactory.countCreditAccountsInStock()).to.be.eq(1);

    await accountFactory.returnCreditAccount(head);
    expect(await accountFactory.countCreditAccountsInStock()).to.be.eq(2);

    await accountFactory.takeCreditAccount(1, 1);
    expect(await accountFactory.countCreditAccountsInStock()).to.be.eq(1);
  });

  it("[AF-10]: _addCreditAccount() adds credit account to array", async () => {
    await contractsRegister.addCreditManager(deployer.address);
    const accounts: Array<string> = [];

    for (let i = 0; i < 5; i++) {
      accounts.push(await accountFactory.head());
      expect(await accountFactory.countCreditAccounts()).to.be.eq(i + 1);
      await accountFactory.takeCreditAccount(1, 1);
    }

    for (let i = 0; i < 5; i++) {
      expect(await accountFactory.creditAccounts(i)).to.be.eq(accounts[i]);
    }
  });

  it("[AF-11]: takeCreditAccount set correct address of new va", async () => {
    await contractsRegister.addCreditManager(deployer.address);
    const creditAccount = await accountFactory.head();
    const receipt = await accountFactory.takeCreditAccount(1, 1);

    const creditAccountArtifact = (await ethers.getContractFactory(
      "CreditAccount"
    )) as CreditAccount__factory;

    const va = await creditAccountArtifact.attach(creditAccount);
    expect(await va.creditManager()).to.be.eq(deployer.address);
    expect(await va.since()).to.be.eq(receipt.blockNumber);
  });

  it("[AF-12]: takeCreditAccount, returns creditAccount reverts if was called by non creditManagers", async () => {
    const revertMsg = await errors.REGISTERED_CREDIT_ACCOUNT_MANAGERS_ONLY();
    await expect(accountFactory.takeCreditAccount(1, 2)).to.be.revertedWith(
      revertMsg
    );
    await expect(
      accountFactory.returnCreditAccount(DUMB_ADDRESS)
    ).to.be.revertedWith(revertMsg);
  });

  it("[AF-13]: takeOut, addMiningApprovals, finishMining reverts if was called by non configurator", async () => {
    const revertMsg = await errors.ACL_CALLER_NOT_CONFIGURATOR();
    await expect(
      accountFactory
        .connect(user)
        .takeOut(DUMB_ADDRESS, DUMB_ADDRESS, DUMB_ADDRESS)
    ).to.be.revertedWith(revertMsg);

    await expect(
      accountFactory.connect(user).finishMining()
    ).to.be.revertedWith(revertMsg);

    await expect(
      accountFactory.connect(user).addMiningApprovals([])
    ).to.be.revertedWith(revertMsg);

    await expect(
      accountFactory
        .connect(user)
        .cancelAllowance(DUMB_ADDRESS, DUMB_ADDRESS, DUMB_ADDRESS)
    ).to.be.revertedWith(revertMsg);
  });

  it("[AF-14]: takeCreditAccount sets correct parameters and returns CreditAccount functional interface item", async () => {
    await contractsRegister.addCreditManager(deployer.address);
    const firstCreditAccount = await accountFactory.head();

    const ba = BigNumber.from(122933);
    const ci = BigNumber.from(23912);
    // here we take the first creditAccount
    const receipt = await accountFactory.takeCreditAccount(ba, ci);

    const contractName = "CreditAccount";
    const CreditAccountArtifact = (await ethers.getContractFactory(
      contractName
    )) as CreditAccount__factory;

    const tva = await CreditAccountArtifact.attach(firstCreditAccount);

    expect(await tva.borrowedAmount()).to.be.eq(ba);
    expect(await tva.cumulativeIndexAtOpen()).to.be.eq(ci);

    const since = await tva.since();
    expect(since).to.be.eq(receipt.blockNumber);
  });

  it("[AF-15]: takeOut reverts if incorrect link prev <> account provided", async () => {
    const revertMsg = await errors.AF_CREDIT_ACCOUNT_NOT_IN_STOCK();
    await expect(
      accountFactory.takeOut(DUMB_ADDRESS, DUMB_ADDRESS, DUMB_ADDRESS)
    ).to.be.revertedWith(revertMsg);
  });

  it("[AF-16]: takeOut correctly takes out a credit account ", async () => {
    await accountFactory.addCreditAccount();
    await accountFactory.addCreditAccount();
    await accountFactory.addCreditAccount();
    const head = await accountFactory.head();
    const prev = await accountFactory.getNext(head);
    const creditAccount = await accountFactory.getNext(prev);
    const accountAfter = await accountFactory.getNext(creditAccount);

    await expect(await accountFactory.isCreditAccount(creditAccount)).to.be
      .true;

    await expect(accountFactory.takeOut(prev, creditAccount, user.address))
      .to.emit(accountFactory, "TakeForever")
      .withArgs(creditAccount, user.address);

    expect(
      await accountFactory.getNext(prev),
      "Incorrect list update"
    ).to.be.eq(accountAfter);

    await expect(await accountFactory.isCreditAccount(creditAccount)).to.be
      .false;

    const creditAccountContract = ICreditAccount__factory.connect(
      creditAccount,
      deployer
    );
    expect(
      await creditAccountContract.creditManager(),
      "Incorrect credit manager update at credit account"
    ).to.be.eq(user.address);
    expect(await accountFactory.getNext(creditAccount)).to.be.eq(ADDRESS_0x0);
  });

  it("[AF-17]: mineCreditAccount, finishMining reverts after finishMining call", async () => {
    const revertMsg = await errors.AF_MINING_IS_FINISHED();
    await accountFactory.finishMining();
    await expect(accountFactory.mineCreditAccount()).to.be.revertedWith(
      revertMsg
    );

    await expect(accountFactory.addMiningApprovals([])).to.be.revertedWith(
      revertMsg
    );
  });

  it("[AF-18]: mineCreditAccount adds new account and provide allowances", async () => {
    const accountsQty = await accountFactory.countCreditAccounts();

    const tokenA = await testDeployer.getTokenMock("tokenA", "TTA");
    const tokenB = await testDeployer.getTokenMock("tokenB", "TTb");

    const contractA = DUMB_ADDRESS;
    const contractB = DUMB_ADDRESS2;

    const miningApprovals = [
      { token: tokenA.address, swapContract: contractA },
      { token: tokenA.address, swapContract: contractB },
      { token: tokenB.address, swapContract: contractA },
    ];

    await accountFactory.addMiningApprovals(miningApprovals);

    const receipt = await accountFactory.mineCreditAccount();

    expect(await accountFactory.countCreditAccounts()).to.be.eq(
      accountsQty.add(1)
    );
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

  it("[AF-19]: mineApprovals adds approval pairs to array", async () => {
    const tokenA = await testDeployer.getTokenMock("tokenA", "TTA");
    const tokenB = await testDeployer.getTokenMock("tokenB", "TTb");

    const contractA = DUMB_ADDRESS;
    const contractB = DUMB_ADDRESS2;

    const miningApprovals = [
      { token: tokenA.address, swapContract: contractA },
      { token: tokenA.address, swapContract: contractB },
      { token: tokenB.address, swapContract: contractA },
    ];

    await accountFactory.addMiningApprovals(miningApprovals.slice(0, 2));
    await accountFactory.addMiningApprovals(miningApprovals.slice(2, 3));

    for (let i = 0; i < miningApprovals.length; i++) {
      const appr = await accountFactory.miningApprovals(i);
      expect(appr.token, `token at ${i}`).to.be.eq(miningApprovals[i].token);
      expect(appr.swapContract, `swapContract at ${i}`).to.be.eq(
        miningApprovals[i].swapContract
      );
    }

    await expect(
      accountFactory.miningApprovals(miningApprovals.length)
    ).to.be.revertedWith("");
  });

  it("[AF-20]: cancelAllowance set allowance to zero", async () => {
    const accountsQty = await accountFactory.countCreditAccounts();

    const tokenA = await testDeployer.getTokenMock("tokenA", "TTA");

    const contractA = DUMB_ADDRESS;

    const miningApprovals = [
      { token: tokenA.address, swapContract: contractA },
    ];

    await accountFactory.addMiningApprovals(miningApprovals);

    const receipt = await accountFactory.mineCreditAccount();

    expect(await accountFactory.countCreditAccounts()).to.be.eq(
      accountsQty.add(1)
    );
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

    await accountFactory.cancelAllowance(
      creditAccount.address,
      tokenA.address,
      contractA
    );

    expect(
      await tokenA.allowance(creditAccount.address, contractA),
      "Allowance tokenA, contractA"
    ).to.be.eq(0);
  });

  it("[AF-21]: takeOut correctly takes head item ", async () => {
    await accountFactory.addCreditAccount();
    await accountFactory.addCreditAccount();
    await accountFactory.addCreditAccount();
    const head = await accountFactory.head();
    const accountAfter = await accountFactory.getNext(head);

    await expect(accountFactory.takeOut(ADDRESS_0x0, head, user.address))
      .to.emit(accountFactory, "TakeForever")
      .withArgs(head, user.address);
    expect(await accountFactory.head(), "Incorrect list update").to.be.eq(
      accountAfter
    );

    expect(await accountFactory.getNext(head), "Clear _nextAccount[head]").to.be.eq(
      ADDRESS_0x0
    );

    const creditAccountContract = ICreditAccount__factory.connect(
      head,
      deployer
    );
    expect(
      await creditAccountContract.creditManager(),
      "Incorrect credit manager update at credit account"
    ).to.be.eq(user.address);
  });

  it("[AF-22]: takeOut correctly updates list if tail was taken ", async () => {
    await accountFactory.addCreditAccount();
    await accountFactory.addCreditAccount();
    const head = await accountFactory.head();
    const prev = await accountFactory.getNext(head);
    const creditAccount = await accountFactory.getNext(prev);

    expect(await accountFactory.tail()).to.be.eq(creditAccount);
    await accountFactory.takeOut(prev, creditAccount, user.address);
    expect(await accountFactory.tail()).to.be.eq(prev);
  });

  it("[AF-23]: takeOut takes correctly first created account", async () => {
    expect(await accountFactory.countCreditAccounts()).to.be.eq(1);

    const head = await accountFactory.head();
    expect(await accountFactory.tail()).to.be.eq(head);
    await accountFactory.takeOut(ADDRESS_0x0, head, user.address);

    expect(await accountFactory.countCreditAccounts()).to.be.eq(1);
    expect(await accountFactory.tail()).to.be.eq(await accountFactory.head());
    expect(await accountFactory.tail()).to.be.not.eq(ADDRESS_0x0);
  });

  it("[AF-24]: returnAccount reverts in someone tries to return account not deployed by factory", async () => {
    const revertMsg = await errors.AF_EXTERNAL_ACCOUNTS_ARE_FORBIDDEN();
    await contractsRegister.addCreditManager(deployer.address);
    await expect(
      accountFactory.returnCreditAccount(DUMB_ADDRESS)
    ).to.be.revertedWith(revertMsg);
  });
});

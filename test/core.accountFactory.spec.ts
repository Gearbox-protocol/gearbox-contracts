import { ethers, waffle } from "hardhat";
import { solidity } from "ethereum-waffle";
import * as chai from 'chai';

import {
  AccountFactory,
  ContractsRegister,
  CreditAccount__factory,
  Errors,
} from "../types/ethers-v5";
import { CoreDeployer } from "../deployer/coreDeployer";
import { TestDeployer } from "../deployer/testDeployer";
import {
  DEPLOYMENT_COST,
  DUMB_ADDRESS,
  UNISWAP_EXPIRED,
} from "../model/_constants";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { IntegrationsDeployer } from "../deployer/integrationsDeployer";
import { BigNumber } from "ethers";

chai.use(solidity);
const { expect } = chai;

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

  beforeEach(async function () {
    deployer = (await ethers.getSigners())[0];
    user = (await ethers.getSigners())[1];
    coreDeployer = new CoreDeployer({
      accountMinerType: "mock",
      treasury: "mock",
      weth: "mock",
    });
    integrationsDeployer = new IntegrationsDeployer();
    testDeployer = new TestDeployer();
    accountFactory = (await coreDeployer.getAccountFactory()) as AccountFactory;
    const accountMiner = await coreDeployer.getAccountMiner("own");
    await deployer.sendTransaction({
      to: accountMiner.address,
      value: DEPLOYMENT_COST.mul(5),
    });

    await accountFactory.connectMiner();

    contractsRegister = await coreDeployer.getContractsRegister();
    errors = await testDeployer.getErrors();
  });

  it("[AAF-1]: constructor correctly creates a genesis credit account", async function () {
    await contractsRegister.addCreditManager(deployer.address);
    const creditAccount = await accountFactory.head();
    expect(await accountFactory.getNext(creditAccount)).to.be.eq(
      "0x0000000000000000000000000000000000000000"
    );
    expect(await accountFactory.tail()).to.be.eq(creditAccount);
    expect(await accountFactory.countCreditAccountsInStock()).to.be.eq(1);
  });

  it("[AAF-2]: takeCreditAccount correctly add credit account", async function () {
    await contractsRegister.addCreditManager(deployer.address);
    await accountFactory.takeCreditAccount(DUMB_ADDRESS);
    const initHead = await accountFactory.head();
    const next = await accountFactory.getNext(initHead);
    const next2 = await accountFactory.getNext(next);
    const next3 = await accountFactory.getNext(next2);
    expect(next3).to.be.eq("0x0000000000000000000000000000000000000000");
  });

  it("[AAF-3]: takeCreditAccount keeps at least 1 VA in stock", async function () {
    await contractsRegister.addCreditManager(deployer.address);
    await accountFactory.takeCreditAccount(deployer.address);
    expect(await accountFactory.countCreditAccountsInStock()).to.be.eq(1);
    await accountFactory.takeCreditAccount(deployer.address);
    expect(await accountFactory.countCreditAccountsInStock()).to.be.eq(1);
    await accountFactory.takeCreditAccount(deployer.address);
    expect(await accountFactory.countCreditAccountsInStock()).to.be.eq(1);
  });

  it("[AAF-4]: takeCreditAccount pays compensation correctly", async function () {
    await contractsRegister.addCreditManager(deployer.address);
    await expect(() =>
      accountFactory.takeCreditAccount(deployer.address)
    ).to.be.changeEtherBalance(deployer, DEPLOYMENT_COST);
  });

  it("[AAF-5]: takeCreditAccount emits InitializeCreditAccount event", async function () {
    await contractsRegister.addCreditManager(deployer.address);
    const head = await accountFactory.head();

    await expect(accountFactory.takeCreditAccount(DUMB_ADDRESS))
      .to.emit(accountFactory, "InitializeCreditAccount")
      .withArgs(head, deployer.address);
  });

  it("[AAF-6]: connectMiner emits AccountMinerChanged event", async function () {
    await contractsRegister.addCreditManager(deployer.address);
    // Getting miner for comparison with event
    const miner = await coreDeployer.getAccountMiner();

    await expect(accountFactory.connectMiner())
      .to.emit(accountFactory, "AccountMinerChanged")
      .withArgs(miner.address);
  });

  it("[AAF-7]: returnCreditAccount set returned container to the end of list", async function () {
    await contractsRegister.addCreditManager(deployer.address);
    const head = await accountFactory.head();
    await accountFactory.takeCreditAccount(deployer.address);
    expect(await accountFactory.countCreditAccountsInStock()).to.be.eq(1);

    await accountFactory.returnCreditAccount(head);
    expect(await accountFactory.countCreditAccountsInStock()).to.be.eq(2);

    const headAfterTest = await accountFactory.head();
    const next = await accountFactory.getNext(headAfterTest);

    // next should points on the second VA, which should be is returned one
    expect(next).to.be.eq(head);
    expect(await accountFactory.tail()).to.be.eq(head);
  });

  it("[AAF-8]: returnCreditAccount emits ReturnCreditAccount", async function () {
    await contractsRegister.addCreditManager(deployer.address);
    const head = await accountFactory.head();
    await accountFactory.takeCreditAccount(deployer.address);
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

  it("[AAF-9]: takeCreditAccount doesn't produce extra VA if not needed", async function () {
    await contractsRegister.addCreditManager(deployer.address);
    const head = await accountFactory.head();
    await accountFactory.takeCreditAccount(deployer.address);
    expect(await accountFactory.countCreditAccountsInStock()).to.be.eq(1);

    await accountFactory.returnCreditAccount(head);
    expect(await accountFactory.countCreditAccountsInStock()).to.be.eq(2);

    await accountFactory.takeCreditAccount(deployer.address);
    expect(await accountFactory.countCreditAccountsInStock()).to.be.eq(1);
  });

  it("[AAF-10]: _addCreditAccount() adds credit account to array", async function () {
    await contractsRegister.addCreditManager(deployer.address);
    const accounts: Array<string> = [];

    for (let i = 0; i < 5; i++) {
      accounts.push(await accountFactory.head());
      expect(await accountFactory.countCreditAccounts()).to.be.eq(i + 1);
      await accountFactory.takeCreditAccount(deployer.address);
    }

    for (let i = 0; i < 5; i++) {
      expect(await accountFactory.creditAccounts(i)).to.be.eq(accounts[i]);
    }
  });

  it("[AAF-11]: takeCreditAccount set correct address of new va", async function () {
    await contractsRegister.addCreditManager(deployer.address);
    const creditAccount = await accountFactory.head();
    const receipt = await accountFactory.takeCreditAccount(DUMB_ADDRESS);

    const creditAccountArtifact = (await ethers.getContractFactory(
      "CreditAccount"
    )) as CreditAccount__factory;

    const va = await creditAccountArtifact.attach(creditAccount);
    expect(await va.creditManager()).to.be.eq(deployer.address);
    expect(await va.since()).to.be.eq(receipt.blockNumber);
  });

  it("[TAF-1]: connectMiner reverts if was called by non-configurator", async function () {
    const revertMsg = await errors.ACL_CALLER_NOT_CONFIGURATOR();
    await expect(
      accountFactory.connect(user).connectMiner()
    ).to.be.revertedWith(revertMsg);
  });

  it("[TAF-2]: takeCreditAccount, returns creditAccount reverts if was called by non creditManagers", async function () {
    const revertMsg = await errors.CR_ALLOWED_FOR_VIRTUAL_ACCOUNT_MANAGERS_ONLY();
    await expect(
      accountFactory.takeCreditAccount(DUMB_ADDRESS)
    ).to.be.revertedWith(revertMsg);
    await expect(
      accountFactory.returnCreditAccount(DUMB_ADDRESS)
    ).to.be.revertedWith(revertMsg);
  });

  it("[TAF-3]: takeCreditAccount return CreditAccount functional interface item", async function () {
    await contractsRegister.addCreditManager(deployer.address);
    const firstCreditAccount = await accountFactory.head();
    // here we take the first creditAccount
    const receipt = await accountFactory.takeCreditAccount(DUMB_ADDRESS);

    const contractName = "CreditAccount";
    const CreditAccountArtifact = (await ethers.getContractFactory(
      contractName
    )) as CreditAccount__factory;

    const ba = BigNumber.from(122933);
    const ci = BigNumber.from(23912);
    const tva = await CreditAccountArtifact.attach(firstCreditAccount);

    await tva.setGenericParameters(ba, ci);

    expect(await tva.borrowedAmount()).to.be.eq(ba);
    expect(await tva.cumulativeIndexAtOpen()).to.be.eq(ci);

    const since = await tva.since();
    expect(since).to.be.eq(receipt.blockNumber);
  });
});

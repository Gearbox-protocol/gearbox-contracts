// @ts-import
import { ethers, waffle } from "hardhat";
// import { solidity } from "ethereum-waffle";
// import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
// import * as chai from "chai";
//
// import { GearMathTest } from "../types/ethers-v5";
// import {
//   WAD,
//   RAY,
//   SECONDS_PER_YEAR,
//   FEE_LIQUIDATION,
//   PERCENTAGE_FACTOR,
//   UNDERLYING_TOKEN_LIQUIDATION_THRESHOLD,
//   LEVERAGE_DECIMALS,
//   LIQUIDATION_DISCOUNTED_SUM,
//   FEE_SUCCESS,
//   FEE_INTEREST,
// } from "../model/_constants";
// import { TestDeployer } from "../deployer/testDeployer";
// import { BigNumber } from "ethers";
// import { percentMul, rayMul } from "../model/math";
// import { PoolServiceModel } from "../model/poolService";
//
// chai.use(solidity);
// const { expect } = chai;
//
// describe("GearMathTest", function () {
//   let testDeployer: TestDeployer;
//   let poolMathTest: GearMathTest;
//
//   beforeEach(async function () {
//     testDeployer = new TestDeployer();
//     poolMathTest = await testDeployer.getGearMathTest();
//   });
//
//   it("[GM-1]: calcInterestAccrued computes  correctly", async function () {
//     const tests = [
//       {
//         totalBorrowed: WAD,
//         currentBorrowRate_RAY: RAY.mul(2), // 200%
//         timeDifference: SECONDS_PER_YEAR,
//         result: WAD.mul(2), // x2
//       },
//       {
//         totalBorrowed: WAD,
//         currentBorrowRate_RAY: RAY.mul(15).div(10), // 150%
//         timeDifference: 1000,
//         result: rayMul(
//           WAD,
//           RAY.mul(15).div(10).mul(1000).div(SECONDS_PER_YEAR)
//         ), // x1.5
//       },
//     ];
//
//     for (let test of tests) {
//       expect(
//         await poolMathTest.calcInterestAccrued(
//           test.totalBorrowed,
//           test.currentBorrowRate_RAY,
//           test.timeDifference
//         )
//       ).to.be.eq(test.result);
//     }
//   });
//
//   it("[GM-2]: calcLinearIndex_RAY computes indexes correctly", async function () {
//     const tests = [
//       {
//         cumulativeIndex: RAY,
//         borrowRate: RAY.mul(2), // 200%
//         timeDifference: BigNumber.from(SECONDS_PER_YEAR),
//         result: RAY.mul(3), // x3
//       },
//       {
//         cumulativeIndex: RAY,
//         borrowRate: RAY.mul(2).div(10), // 20%
//         timeDifference: BigNumber.from(SECONDS_PER_YEAR),
//         result: RAY.mul(12).div(10), // x1.2
//       },
//     ];
//
//     for (let test of tests) {
//       expect(
//         await poolMathTest.calcLinearIndex_RAY(
//           test.cumulativeIndex,
//           test.borrowRate,
//           test.timeDifference
//         )
//       ).to.be.eq(test.result);
//     }
//   });
//
//   it("[GM-3]: calcCreditAccountAccruedInterested computes correctly", async function () {
//     const tests = [
//       {
//         borrowedAmount: WAD,
//         currentCumulativeIndex_RAY: RAY.mul(2), // index x2 for loan
//         cumulativeIndexAtCreditAccountOpen_RAY: RAY,
//         result: WAD.mul(2), // x2
//       },
//       {
//         borrowedAmount: WAD,
//         currentCumulativeIndex_RAY: RAY.mul(15).div(10), // index x1.5 for loan
//         cumulativeIndexAtCreditAccountOpen_RAY: RAY,
//         result: WAD.mul(15).div(10), // x1.5
//       },
//     ];
//
//     for (let test of tests) {
//       expect(
//         await poolMathTest.calcCreditAccountAccruedInterest(
//           test.borrowedAmount,
//           test.cumulativeIndexAtCreditAccountOpen_RAY,
//           test.currentCumulativeIndex_RAY
//         )
//       ).to.be.eq(test.result);
//     }
//   });
//
//   it("[GM-4]: calcCloseDistribution computes values correctly", async function () {
//     const tests = [
//       {
//         case: "totalValue = amountToPool",
//         totalValue: WAD,
//         borrowedAmount: WAD,
//         cumulativeIndexAtCreditAccountOpen_RAY: RAY,
//         currentCumulativeIndex_RAY: RAY, // index x2 for loan
//         isLiquidated: false,
//       },
//       {
//         case: "totalValue < amountToPool",
//         totalValue: WAD.div(2),
//         borrowedAmount: WAD,
//         cumulativeIndexAtCreditAccountOpen_RAY: RAY,
//         currentCumulativeIndex_RAY: RAY.mul(2), // index x2 for loan
//         isLiquidated: false,
//       },
//       {
//         case: "totalValue > amountToPool",
//         totalValue: WAD.mul(2),
//         borrowedAmount: WAD,
//         cumulativeIndexAtCreditAccountOpen_RAY: RAY,
//         currentCumulativeIndex_RAY: RAY.mul(102).div(100),
//         isLiquidated: false,
//       },
//
//       {
//         case: "totalValue = amountToPool: [LIQUIDATION]",
//         totalValue: WAD,
//         borrowedAmount: WAD,
//         cumulativeIndexAtCreditAccountOpen_RAY: RAY,
//         currentCumulativeIndex_RAY: RAY, // index x2 for loan
//         isLiquidated: true,
//       },
//       {
//         case: "totalValue < amountToPool: [LIQUIDATION]",
//         totalValue: WAD.div(2),
//         borrowedAmount: WAD,
//         cumulativeIndexAtCreditAccountOpen_RAY: RAY,
//         currentCumulativeIndex_RAY: RAY.mul(2), // index x2 for loan
//         isLiquidated: true,
//       },
//       {
//         case: "totalValue > amountToPool: [LIQUIDATION]",
//         totalValue: WAD.mul(2),
//         borrowedAmount: WAD,
//         cumulativeIndexAtCreditAccountOpen_RAY: RAY,
//         currentCumulativeIndex_RAY: RAY.mul(102).div(100),
//         isLiquidated: true,
//       },
//     ];
//
//     for (let t of tests) {
//       const [
//         borrowedAmount,
//         amountToPool,
//         remainingFunds,
//         profit,
//         loss,
//       ] = await poolMathTest.calcCloseDistributionTest(
//         t.totalValue,
//         t.borrowedAmount,
//         t.cumulativeIndexAtCreditAccountOpen_RAY,
//         t.currentCumulativeIndex_RAY,
//         t.isLiquidated
//       );
//
//       const borrowedAmountWithInterest = PoolServiceModel.getBorrowedAmountWithInterest(
//         borrowedAmount,
//         t.currentCumulativeIndex_RAY,
//         t.cumulativeIndexAtCreditAccountOpen_RAY
//       );
//
//       const totalFunds = t.isLiquidated
//         ? t.totalValue.mul(LIQUIDATION_DISCOUNTED_SUM).div(PERCENTAGE_FACTOR)
//         : t.totalValue;
//
//       // user balance = amount + borrowed amount
//       const fee = t.isLiquidated
//         ? percentMul(totalFunds, FEE_LIQUIDATION)
//         : percentMul(
//             totalFunds.sub(borrowedAmountWithInterest),
//             FEE_SUCCESS
//           ).add(
//             percentMul(
//               borrowedAmountWithInterest.sub(borrowedAmount),
//               FEE_INTEREST
//             )
//           );
//
//       const baPlusFee = borrowedAmountWithInterest.add(fee);
//
//       const amountToPoolModel = totalFunds.gte(baPlusFee)
//         ? baPlusFee
//         : totalFunds.sub(1);
//
//       let remainingFundsModel = totalFunds.sub(amountToPoolModel).sub(1);
//       remainingFundsModel = remainingFundsModel.isNegative() ? BigNumber.from(0): remainingFundsModel;
//
//       const pnl = amountToPoolModel.sub(borrowedAmountWithInterest);
//
//       const profitModel = pnl.isNegative() ? 0 : pnl;
//       const lossModel = pnl.isNegative() || pnl.isZero() ? pnl.abs() : 0;
//
//       expect(
//         borrowedAmount,
//         `Incorrect borrowed amount for ${t.case}`
//       ).to.be.eq(t.borrowedAmount);
//
//       expect(
//         amountToPool,
//         `Incorrect amount to pool for ${t.case.toUpperCase()}`
//       ).to.be.eq(amountToPoolModel);
//
//       expect(
//         remainingFunds,
//         `Incorrect remaining funds for ${t.case.toUpperCase()}`
//       ).to.be.eq(remainingFundsModel);
//
//       expect(profit, `Incorrect profit for ${t.case.toUpperCase()}`).to.be.eq(
//         profitModel
//       );
//
//       expect(loss, `Incorrect loss for ${t.case.toUpperCase()}`).to.be.eq(
//         lossModel
//       );
//     }
//   });
//
//   it("[GM-5]: calcBorrowAmountPlusFee computes correctly", async function () {
//     const borrowAmount = WAD.div(2).sub(WAD.div(4));
//     const borrowedAmountWithInterest = WAD.div(2);
//
//     const tests = [
//       {
//         case: "totalFunds <= borrowedAmountWithInterest",
//         totalFunds: WAD,
//         borrowedAmount: RAY.mul(2).sub(RAY.div(2)),
//         borrowedAmountWithInterest: RAY.mul(2), // index x2 for loan
//         isLiquidated: false,
//         result: RAY.mul(2), // x2
//       },
//       {
//         case: "Normal case",
//         totalFunds: WAD,
//         borrowedAmount: borrowAmount,
//         borrowedAmountWithInterest: borrowedAmountWithInterest, // index x2 for loan
//         isLiquidated: false,
//         result: borrowedAmountWithInterest
//           .add(percentMul(WAD.sub(borrowedAmountWithInterest), FEE_SUCCESS))
//           .add(
//             percentMul(
//               borrowedAmountWithInterest.sub(borrowAmount),
//               FEE_INTEREST
//             )
//           ),
//       },
//       {
//         case: "Liquidadtion",
//         totalFunds: WAD,
//         borrowedAmount: WAD.div(2).sub(WAD.div(4)),
//         borrowedAmountWithInterest: WAD.div(2), // index x2 for loan
//         isLiquidated: true,
//         result: WAD.div(2).add(percentMul(WAD, FEE_LIQUIDATION)),
//       },
//     ];
//
//     for (let test of tests) {
//       expect(
//         await poolMathTest.calcBorrowAmountPlusFee(
//           test.totalFunds,
//           test.borrowedAmount,
//           test.borrowedAmountWithInterest,
//           test.isLiquidated
//         ),
//         test.case
//       ).to.be.eq(test.result);
//     }
//   });
//
//
// });

/*
 * SPDX-License-Identifier: BSL-1.1
 * Gearbox. Generalized leverage protocol, which allows to take leverage and then use it across other DeFi protocols and platforms in a composable way.
 * (c) Gearbox.fi, 2021
 */

import { CreditManagerTestSuite } from "../../deployer/creditManagerTestSuite";

export const WETH_TOKEN = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";
export const UNISWAP_V2_ROUTER_ADDRESS =
  "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D";

async function makeSuite(): Promise<CreditManagerTestSuite> {
  const ts = new CreditManagerTestSuite({
    coreConfig: {
      weth: WETH_TOKEN,
    },
  });
  await ts.getSuite();
  await ts.setupCreditManager();
  console.log("ff")
  return ts;
}

export async function makeCreditManagerSuite(
  name: string,
  testCase: (ts: CreditManagerTestSuite) => void
) {
  const ts = await makeSuite()
  return describe(name, () => testCase(ts));
}

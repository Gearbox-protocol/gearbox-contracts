![gearbox](header.png)

## Gearbox protocol

This repository contains the smart contracts source code for Gearbox Protocol V1.

### What is Gearbox protocol?

Gearbox is a generalized leverage protocol: it allows you to take leverage in one place and then use it across various 
DeFi protocols and platforms in a composable way. The protocol has two sides to it: passive liquidity providers who earn higher APY 
by providing liquidity; active traders, farmers, or even other protocols who can borrow those assets to trade or farm with x4+ leverage.

Gearbox protocol is Marketmake ETHGlobal hackathon finalist.

## Bug bounty

This repository is subject to the Gearbox bug bounty program, per the terms defined [here]().

## Documentation

The documentation of Gearbox Protocol is in the following [documentation link](https://docs.gearbox.fi). Developers documentation, which
has more tech-related infromation about the protocol, see the contract interfaces, integration guides and audits are available on
[gearbox dev protal](https://dev.gearbox.fi)


## Audits
- Consensys Diligence Fuzzing (04/10/2021- 13/12/2021): [report](https://github.com/Gearbox-protocol/gearbox-contracts/blob/master/audits/ConsensysDiligence%20_Fuzzing_report.pdf)
- ChainSecurity (31/08/2021 - 13/12/2021): [report](https://github.com/Gearbox-protocol/gearbox-contracts/blob/master/audits/ChainSecurity_Gearbox_audit.pdf)
- Peckshield (22/07/2021 - 10/08/2021): [report](https://github.com/Gearbox-protocol/gearbox-contracts/blob/master/audits/Peckshield-10.08.2021.pdf)
- Peckshield (09/04/2021 - 03/05/2021): [report](https://github.com/Gearbox-protocol/gearbox-contracts/blob/master/audits/Peckshield-03.05.2021.pdf)

##  Connect with the community


## Kovan playground
Gearbox protocol is currently deployed on Kovan network, for testing your interations you can use of following deployemnts:

| Deployment          | Address Provider                            | PathFinder                                 |
|---------------------|---------------------------------------------|--------------------------------------------|
 | Public test version | 0xA526311C39523F60b184709227875b5f34793bD4  | 0x434895faaf71004841869b5B3A8AD7C9CB79Ae94 | 

Third eye server API for Kovan playground is available on: [https://kovan.gearbox-api.com](https://kovan.gearbox-api.com).  
For more information about third-eye analytics check its [repo](https://github.com/Gearbox-protocol/third-eye).

## Testing

### Unit tests

```yarn test```

### Mainnet fork tests

1. Start mainnet fork with
```yarn fork```
2. Open new terminal window & run ```yarn mainnet-test``` to deploy contracts and charge accounts.
3. Then ```yarn test test/mainnet/*.spec.ts --network localhost``` to run tests.

### Fuzzing testing

Instructions for running fuzzing tests will be published soon.

## Licensing

The primary license for the Gearbox-Contracts is the Business Source License 1.1 (BUSL-1.1), see [LICENSE](https://github.com/Gearbox-protocol/gearbox-contracts/blob/master/LICENSE). The files licensed under the BUSL-1.1 have appropriate SPDX headers.

### Exceptions

- The files in `contracts/adapters`, `contracts/fuzzing`, `contracts/interfaces`, `contracts/support` are licensed under GPL-2.0-or-later.
- The files in `contracts/libraries` are licensed under GPL-2.0-or-later or GNU AGPL 3.0 (as indicated in their SPDX headers).
- The files in `contracts/integrations` are either licensed under GPL-2.0-or-later or unlicensed (as indicated in their SPDX headers).
- The file `contracts/tokens/GearToken.sol` is based on [`Uni.sol`](https://github.com/Uniswap/governance/blob/master/contracts/Uni.sol) and distributed under the BSD 3-clause license.  
 -The files in `audits`, `scripts`, `test`, `contracts/mocks` are unlicensed.


## Useful links
Website: [https://gearbox.fi/](https://gearbox.fi/)  
Docs: [https://docs.gearbox.finance/](https://docs.gearbox.finance/)  
Forum: [https://gov.gearbox.fi/t/start-here-forum-rules/](https://gov.gearbox.fi/t/start-here-forum-rules/)  
Blog: [https://medium.com/@gearboxprotocol](https://medium.com/@gearboxprotocol)  
Twitter: [https://twitter.com/GearboxProtocol](https://twitter.com/GearboxProtocol)  
Snapshot page: [https://snapshot.org/#/gearbox.eth](https://snapshot.org/#/gearbox.eth)  
Developer Docs: [https://dev.gearbox.fi/](https://dev.gearbox.fi/)  

## Disclaimer

This application is provided "as is" and "with all faults." Me as developer makes no representations or
warranties of any kind concerning the safety, suitability, lack of viruses, inaccuracies, typographical
errors, or other harmful components of this software. There are inherent dangers in the use of any software,
and you are solely responsible for determining whether this software product is compatible with your equipment and
other software installed on your equipment. You are also solely responsible for the protection of your equipment
and backup of your data, and THE PROVIDER will not be liable for any damages you may suffer in connection with using,
modifying, or distributing this software product.

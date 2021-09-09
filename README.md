![gearbox](header.png)

## Gearbox protocol

Official site: https://gearbox.fi  
Video: https://discord.gg/7evzYM93cM  
Twitter: https://twitter.com/GearboxProtocol  
Telegram: https://t.me/GearboxProtocol  

Gearbox protocol is Marketmake ETHGlobal hackathon finalist.

##  Running tests

### Unit tests

yarn test

### Mainnet test

1. Start mainnet fork with
```yarn fork```
2. In other terminal run ```yarn mainnet-test``` to deploy contracts and charge accounts.
3. Then ```yarn test test/mainnet/*.spec.ts --network localhost``` to run tests.

## Disclaimer

This application is provided "as is" and "with all faults." Me as developer makes no representations or
warranties of any kind concerning the safety, suitability, lack of viruses, inaccuracies, typographical
errors, or other harmful components of this software. There are inherent dangers in the use of any software,
and you are solely responsible for determining whether this software product is compatible with your equipment and
other software installed on your equipment. You are also solely responsible for the protection of your equipment
and backup of your data, and THE PROVIDER will not be liable for any damages you may suffer in connection with using,
modifying, or distributing this software product.

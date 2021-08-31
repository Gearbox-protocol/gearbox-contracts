set -o allexport; source ./.env; set +o allexport;
npx hardhat node --fork $ETH_MAINNET_PROVIDER

import { HardhatUserConfig } from "hardhat/config";
import "@nomiclabs/hardhat-ethers";
import "@nomicfoundation/hardhat-chai-matchers";
import "@typechain/hardhat";

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.28",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      viaIR: true,
    },
  },
  networks: {
    hardhat: {
      forking: {
        url: process.env.ETHEREUM_RPC_URL || "",
        blockNumber: undefined, // Latest block
      },
    },
  },
  typechain: {
    outDir: "typechain-types",
    target: "ethers-v5",
  },
};

export default config;

import { HardhatUserConfig } from "hardhat/config";
import "@nomiclabs/hardhat-ethers";
import "@nomicfoundation/hardhat-chai-matchers";
import "@typechain/hardhat";
import * as dotenv from 'dotenv';

dotenv.config();

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
        // PINNED TO SPECIFIC BLOCK - matches Tenderly fork
        // Block 23592043 - FRESH BLOCK (October 16, 2025)
        blockNumber: 23592043,
      },
    },
    // UPDATED TENDERLY FORK - FRESH BLOCK (no stale oracle prices)
    tenderly: {
      url: "https://virtual.mainnet.eu.rpc.tenderly.co/9def9c05-33cb-4003-9278-d5dd47513dc6",
      accounts: process.env.SEARCHER_PRIVATE_KEY ? [process.env.SEARCHER_PRIVATE_KEY] : [],
    },
    mainnet: {
      url: process.env.ETHEREUM_RPC_URL || "",
      accounts: process.env.SEARCHER_PRIVATE_KEY ? [process.env.SEARCHER_PRIVATE_KEY] : [],
      gas: 5000000,
    },
  },
  typechain: {
    outDir: "typechain-types",
    target: "ethers-v5",
  },
};

export default config;

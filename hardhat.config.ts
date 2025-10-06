import { HardhatUserConfig } from "hardhat/config";
import "@nomiclabs/hardhat-ethers";
import "@nomicfoundation/hardhat-chai-matchers";
import "@typechain/hardhat";
import * as dotenv from 'dotenv';

dotenv.config();

// ADD THIS DEBUGGING LINE
//console.log("Loaded Private Key:", process.env.SEARCHER_PRIVATE_KEY);

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.28",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      //viaIR: true,
    },
  },
  networks: {
    hardhat: {
      forking: {
        url: process.env.ETHEREUM_RPC_URL || "",
        blockNumber: undefined, // Latest block
      },
    },
    // ==========================================================
    // === ADD THIS NEW TENDERLY NETWORK CONFIGURATION BELOW ====
    // ==========================================================
    tenderly: {
      // 1. Paste the RPC URL you copied from your Tenderly Fork dashboard here.
      url: "https://virtual.mainnet.eu.rpc.tenderly.co/fefb5542-60fb-4d31-a6a1-4c4b93a5fe6f",
      
      // 2. This uses the private key from your .env file to sign transactions.
      accounts: process.env.SEARCHER_PRIVATE_KEY ? [process.env.SEARCHER_PRIVATE_KEY] : [],
    },

  },
  typechain: {
    outDir: "typechain-types",
    target: "ethers-v5",
  },
};

export default config;

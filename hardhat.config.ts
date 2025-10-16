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
      viaIR: true,
    },
  },
  networks: {
    hardhat: {
      forking: {
        url: process.env.ETHEREUM_RPC_URL || "",
        //blockNumber: undefined, // Latest block
	// PINNED TO SPECIFIC BLOCK - matches Tenderly fork
        // This ensures consistent state across test runs
        // Block 23526834 - matches your Tenderly fork for comparison
        blockNumber: 23526834,
      },
    },
    // ==========================================================
    // === ADD THIS NEW TENDERLY NETWORK CONFIGURATION BELOW ====
    // ==========================================================
    tenderly: {
      // 1. Paste the RPC URL you copied from your Tenderly Fork dashboard here.
      url: "https://virtual.mainnet.eu.rpc.tenderly.co/8d322a00-ec8f-4c00-8734-d9bb730566e0",
      
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

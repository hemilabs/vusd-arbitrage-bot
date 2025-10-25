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
        // PINNED TO SPECIFIC BLOCK - October 24, 2025
        // Block 23654914 - FRESH BLOCK for accurate Chainlink oracle prices
        // IMPORTANT: Chainlink oracles become stale quickly (within hours)
        // Update this block number if oracle-related tests fail
        blockNumber: 23654914,
      },
    },
    // TENDERLY FORK - Uses TENDERLY_RPC_URL from .env
    // IMPORTANT: Create fresh Tenderly forks regularly to avoid stale Chainlink oracle prices
    // Chainlink price feeds update frequently and old forks will have outdated prices
    // To create new fork: Use Tenderly dashboard, fork at latest block, update TENDERLY_RPC_URL in .env
    tenderly: {
      url: process.env.TENDERLY_RPC_URL || "",
      // Scripts load their own signers from keystore using src/utils/keystore-utils.ts
      // No accounts needed in hardhat config for security reasons
      accounts: [],
    },
    mainnet: {
      url: process.env.ETHEREUM_RPC_URL || "",
      // Scripts load their own signers from keystore using src/utils/keystore-utils.ts
      // No accounts needed in hardhat config for security reasons
      accounts: [],
      gas: 5000000,
    },
  },
  typechain: {
    outDir: "typechain-types",
    target: "ethers-v5",
  },
};

export default config;

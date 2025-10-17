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
        // PINNED TO SPECIFIC BLOCK - October 17, 2025
        // Block 23599652 - FRESH BLOCK for accurate Chainlink oracle prices
        // IMPORTANT: Chainlink oracles become stale quickly (within hours)
        // Update this block number if oracle-related tests fail
        blockNumber: 23599652,
      },
    },
    // TENDERLY FORK - FRESH BLOCK (October 17, 2025)
    // IMPORTANT: This Tenderly fork must be recreated regularly to avoid stale Chainlink oracle prices
    // Chainlink price feeds update frequently and old forks will have outdated prices
    // Current fork created at block 23599652
    // If oracle prices seem wrong, create a new Tenderly fork at a recent block
    tenderly: {
      url: "https://virtual.mainnet.eu.rpc.tenderly.co/11b432e4-2345-4d88-8147-d9c365506cbb",
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

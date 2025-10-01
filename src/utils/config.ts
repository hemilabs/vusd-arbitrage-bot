// src/utils/config.ts
// Configuration manager for loading and validating environment variables
// Centralizes all contract addresses and bot settings
// Validates configuration at startup to fail fast if misconfigured

import dotenv from 'dotenv';
import { ethers } from 'ethers';
import { logger } from './logger';

// Load environment variables from .env file
dotenv.config();

// Interface for type-safe configuration
export interface BotConfig {
  // Network configuration
  ethereumRpcUrl: string;
  
  // Private keys
  searcherPrivateKey: string;
  flashbotsAuthKey: string;
  
  // Token addresses
  usdcAddress: string;
  crvusdAddress: string;
  vusdAddress: string;
  
  // Curve pool addresses
  curveCrvusdUsdcPool: string;
  curveCrvusdVusdPool: string;
  
  // VUSD contract addresses
  vusdMinter: string;
  vusdRedeemer: string;
  
  // Uniswap V3 flashloan pool
  uniswapV3UsdcPool: string;
  
  // Bot parameters
  flashloanAmount: string; // in USDC (e.g., "10000")
  checkIntervalMs: number;
  simulationMode: boolean;
  maxGasCostUsd: number;
}

/**
 * Validate that a string is a valid Ethereum address
 */
function isValidAddress(address: string): boolean {
  try {
    return ethers.utils.isAddress(address);
  } catch {
    return false;
  }
}

/**
 * Validate that a string is a valid private key
 */
function isValidPrivateKey(key: string): boolean {
  try {
    // Try to create a wallet from the key
    new ethers.Wallet(key);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get required environment variable or throw error
 */
function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

/**
 * Load and validate configuration from environment variables
 */
export function loadConfig(): BotConfig {
  logger.info('Loading configuration from environment variables');
  
  try {
    // Load all environment variables
    const config: BotConfig = {
      ethereumRpcUrl: getRequiredEnv('ETHEREUM_RPC_URL'),
      searcherPrivateKey: getRequiredEnv('SEARCHER_PRIVATE_KEY'),
      flashbotsAuthKey: getRequiredEnv('FLASHBOTS_AUTH_KEY'),
      usdcAddress: getRequiredEnv('USDC_ADDRESS'),
      crvusdAddress: getRequiredEnv('CRVUSD_ADDRESS'),
      vusdAddress: getRequiredEnv('VUSD_ADDRESS'),
      curveCrvusdUsdcPool: getRequiredEnv('CURVE_CRVUSD_USDC_POOL'),
      curveCrvusdVusdPool: getRequiredEnv('CURVE_CRVUSD_VUSD_POOL'),
      vusdMinter: getRequiredEnv('VUSD_MINTER'),
      vusdRedeemer: getRequiredEnv('VUSD_REDEEMER'),
      uniswapV3UsdcPool: getRequiredEnv('UNISWAP_V3_USDC_POOL'),
      flashloanAmount: process.env.FLASHLOAN_AMOUNT || '10000',
      checkIntervalMs: parseInt(process.env.CHECK_INTERVAL_MS || '60000'),
      simulationMode: process.env.SIMULATION_MODE === 'true',
      maxGasCostUsd: parseFloat(process.env.MAX_GAS_COST_USD || '3'),
    };
    
    // Validate RPC URL
    if (!config.ethereumRpcUrl.startsWith('http')) {
      throw new Error('ETHEREUM_RPC_URL must be a valid HTTP(S) URL');
    }
    
    // Validate private keys
    if (!isValidPrivateKey(config.searcherPrivateKey)) {
      throw new Error('SEARCHER_PRIVATE_KEY is not a valid private key');
    }
    if (!isValidPrivateKey(config.flashbotsAuthKey)) {
      throw new Error('FLASHBOTS_AUTH_KEY is not a valid private key');
    }
    
    // Validate all addresses
    const addressFields: (keyof BotConfig)[] = [
      'usdcAddress',
      'crvusdAddress',
      'vusdAddress',
      'curveCrvusdUsdcPool',
      'curveCrvusdVusdPool',
      'vusdMinter',
      'vusdRedeemer',
      'uniswapV3UsdcPool'
    ];
    
    for (const field of addressFields) {
      const address = config[field] as string;
      if (!isValidAddress(address)) {
        throw new Error(`${field} is not a valid Ethereum address: ${address}`);
      }
    }
    
    logger.info('Configuration loaded and validated successfully');
    logger.info(`Simulation mode: ${config.simulationMode}`);
    logger.info(`Check interval: ${config.checkIntervalMs}ms`);
    logger.info(`Flashloan amount: ${config.flashloanAmount} USDC`);
    
    return config;
    
  } catch (error: any) {
    logger.error(`Configuration error: ${error.message}`);
    throw error;
  }
}

// src/utils/config.ts
// Configuration loader and validator for VUSD arbitrage bot
// Updated to include VUSD Minter and Redeemer addresses

import * as dotenv from 'dotenv';
import { logger } from './logger';

// Load .env file
dotenv.config();

// Configuration interface
export interface BotConfig {
  // Network
  ethereumRpcUrl: string;
  searcherPrivateKey: string;

  // Token addresses
  usdcAddress: string;
  crvusdAddress: string;
  vusdAddress: string;

  // Curve pool addresses
  curveCrvusdUsdcPool: string;
  curveCrvusdVusdPool: string;

  // VUSD system contracts
  vusdMinterAddress: string;
  vusdRedeemerAddress: string;

  // Uniswap V3 pool for flashloans
  uniswapV3UsdcPool: string;

  // Bot configuration
  flashloanAmount: number;
  checkIntervalMs: number;
  simulationMode: boolean;
  maxGasCostUsd: number;
}

/**
 * Load configuration from environment variables
 * Validates all required variables are present
 */
export function loadConfig(): BotConfig {
  logger.info('Loading configuration from environment variables');

  // Network configuration
  const ethereumRpcUrl = process.env.ETHEREUM_RPC_URL;
  if (!ethereumRpcUrl) {
    throw new Error('ETHEREUM_RPC_URL is required in .env file');
  }

  const searcherPrivateKey = process.env.SEARCHER_PRIVATE_KEY;
  if (!searcherPrivateKey) {
    throw new Error('SEARCHER_PRIVATE_KEY is required in .env file');
  }

  // Token addresses
  const usdcAddress = process.env.USDC_ADDRESS;
  if (!usdcAddress) {
    throw new Error('USDC_ADDRESS is required in .env file');
  }

  const crvusdAddress = process.env.CRVUSD_ADDRESS;
  if (!crvusdAddress) {
    throw new Error('CRVUSD_ADDRESS is required in .env file');
  }

  const vusdAddress = process.env.VUSD_ADDRESS;
  if (!vusdAddress) {
    throw new Error('VUSD_ADDRESS is required in .env file');
  }

  // Curve pool addresses
  const curveCrvusdUsdcPool = process.env.CURVE_CRVUSD_USDC_POOL;
  if (!curveCrvusdUsdcPool) {
    throw new Error('CURVE_CRVUSD_USDC_POOL is required in .env file');
  }

  const curveCrvusdVusdPool = process.env.CURVE_CRVUSD_VUSD_POOL;
  if (!curveCrvusdVusdPool) {
    throw new Error('CURVE_CRVUSD_VUSD_POOL is required in .env file');
  }

  // VUSD system contracts
  const vusdMinterAddress = process.env.VUSD_MINTER;
  if (!vusdMinterAddress) {
    throw new Error('VUSD_MINTER is required in .env file');
  }

  const vusdRedeemerAddress = process.env.VUSD_REDEEMER;
  if (!vusdRedeemerAddress) {
    throw new Error('VUSD_REDEEMER is required in .env file');
  }

  // Uniswap V3 pool
  const uniswapV3UsdcPool = process.env.UNISWAP_V3_USDC_POOL;
  if (!uniswapV3UsdcPool) {
    throw new Error('UNISWAP_V3_USDC_POOL is required in .env file');
  }

  // Bot configuration with defaults
  const flashloanAmount = parseInt(process.env.FLASHLOAN_AMOUNT || '10000');
  const checkIntervalMs = parseInt(process.env.CHECK_INTERVAL_MS || '60000');
  const simulationMode = process.env.SIMULATION_MODE === 'true';
  const maxGasCostUsd = parseFloat(process.env.MAX_GAS_COST_USD || '3');

  const config: BotConfig = {
    ethereumRpcUrl,
    searcherPrivateKey,
    usdcAddress,
    crvusdAddress,
    vusdAddress,
    curveCrvusdUsdcPool,
    curveCrvusdVusdPool,
    vusdMinterAddress,
    vusdRedeemerAddress,
    uniswapV3UsdcPool,
    flashloanAmount,
    checkIntervalMs,
    simulationMode,
    maxGasCostUsd
  };

  // Validate configuration
  validateConfig(config);

  logger.info('Configuration loaded and validated successfully');
  logger.info(`Simulation mode: ${config.simulationMode}`);
  logger.info(`Check interval: ${config.checkIntervalMs}ms`);
  logger.info(`Flashloan amount: ${config.flashloanAmount} USDC`);

  return config;
}

/**
 * Validate configuration values
 */
function validateConfig(config: BotConfig): void {
  // Validate Ethereum addresses (should start with 0x and be 42 characters)
  const addressFields = [
    'usdcAddress',
    'crvusdAddress',
    'vusdAddress',
    'curveCrvusdUsdcPool',
    'curveCrvusdVusdPool',
    'vusdMinterAddress',
    'vusdRedeemerAddress',
    'uniswapV3UsdcPool'
  ];

  for (const field of addressFields) {
    const address = (config as any)[field];
    if (!address.startsWith('0x') || address.length !== 42) {
      throw new Error(`Invalid Ethereum address for ${field}: ${address}`);
    }
  }

  // Validate private key (should start with 0x and be 66 characters)
  if (!config.searcherPrivateKey.startsWith('0x') || config.searcherPrivateKey.length !== 66) {
    throw new Error('Invalid private key format (should be 0x followed by 64 hex characters)');
  }

  // Validate numeric values
  if (config.flashloanAmount <= 0) {
    throw new Error('Flashloan amount must be positive');
  }

  if (config.checkIntervalMs < 1000) {
    throw new Error('Check interval must be at least 1000ms');
  }

  if (config.maxGasCostUsd < 0) {
    throw new Error('Max gas cost must be non-negative');
  }
}

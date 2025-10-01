// src/test-config.ts
// Test script to verify configuration loading and validation

import { loadConfig } from './utils/config';
import { logger } from './utils/logger';

try {
  logger.info('Testing configuration loader...');
  
  const config = loadConfig();
  
  logger.info('Configuration loaded successfully');
  logger.info(`RPC URL: ${config.ethereumRpcUrl.substring(0, 30)}...`);
  logger.info(`USDC Address: ${config.usdcAddress}`);
  logger.info(`Flashloan amount: ${config.flashloanAmount} USDC`);
  
} catch (error) {
  logger.error('Configuration test failed', error as Error);
  process.exit(1);
}

// src/test-uniswap-pool.ts
// Test script to verify which token is token0 and token1 in the Uniswap pool

import { ethers } from 'ethers';
import { loadConfig } from './utils/config';
import { logger } from './utils/logger';

const UNISWAP_V3_POOL_ABI = [
  'function token0() external view returns (address)',
  'function token1() external view returns (address)',
  'function fee() external view returns (uint24)',
  'function liquidity() external view returns (uint128)'
];

async function testUniswapPool() {
  try {
    logger.info('=== Testing Uniswap V3 Pool ===');
    
    // Load configuration
    const config = loadConfig();
    
    // Setup provider
    const provider = new ethers.providers.JsonRpcProvider(config.ethereumRpcUrl);
    
    // Create pool contract instance
    const poolAddress = config.uniswapV3UsdcPool;
    logger.info(`Checking pool at: ${poolAddress}`);
    
    const pool = new ethers.Contract(poolAddress, UNISWAP_V3_POOL_ABI, provider);
    
    // Get token addresses
    const token0Address = await pool.token0();
    const token1Address = await pool.token1();
    const fee = await pool.fee();
    const liquidity = await pool.liquidity();
    
    logger.info(`Token0: ${token0Address}`);
    logger.info(`Token1: ${token1Address}`);
    logger.info(`Fee: ${fee} (${fee / 10000}%)`);
    logger.info(`Liquidity: ${liquidity.toString()}`);
    
    // Compare with known addresses
    logger.info('\n=== Token Verification ===');
    logger.info(`USDC address: ${config.usdcAddress}`);
    
    if (token0Address.toLowerCase() === config.usdcAddress.toLowerCase()) {
      logger.info('✅ USDC is token0');
      logger.info('   → For flashloan: use amount0 for USDC, amount1 = 0');
    } else if (token1Address.toLowerCase() === config.usdcAddress.toLowerCase()) {
      logger.info('✅ USDC is token1');
      logger.info('   → For flashloan: use amount0 = 0, amount1 for USDC');
    } else {
      logger.error('❌ USDC not found in this pool!');
      logger.error('   This pool does not contain USDC');
      process.exit(1);
    }
    
    // Identify the other token
    const otherTokenAddress = token0Address.toLowerCase() === config.usdcAddress.toLowerCase() 
      ? token1Address 
      : token0Address;
    
    logger.info(`Other token in pool: ${otherTokenAddress}`);
    
    // Common token addresses for reference
    const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
    if (otherTokenAddress.toLowerCase() === WETH.toLowerCase()) {
      logger.info('   → This is WETH (Wrapped ETH)');
    }
    
  } catch (error) {
    logger.error('Pool verification failed', error as Error);
    process.exit(1);
  }
}

testUniswapPool();

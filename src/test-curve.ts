// src/test-curve.ts
// Test script to verify Curve quote provider is working

import { ethers } from 'ethers';
import { loadConfig } from './utils/config';
import { logger } from './utils/logger';
import { CurveQuoteProvider } from './dex-providers/curve-quote-provider';

async function testCurveProvider() {
  try {
    logger.info('Testing Curve quote provider');
    
    // Load configuration
    const config = loadConfig();
    
    // Setup provider and signer
    const provider = new ethers.providers.JsonRpcProvider(config.ethereumRpcUrl);
    const wallet = new ethers.Wallet(config.searcherPrivateKey, provider);
    
    // Create Curve quote provider
    const curveProvider = new CurveQuoteProvider(
      wallet,
      config.curveCrvusdUsdcPool,
      config.curveCrvusdVusdPool,
      config.usdcAddress,
      config.crvusdAddress,
      config.vusdAddress
    );
    
    // Initialize and validate pools
    const initialized = await curveProvider.initialize();
    if (!initialized) {
      throw new Error('Failed to initialize Curve provider');
    }
    
    // Get current crvUSD/VUSD price
    logger.info('Fetching crvUSD/VUSD price...');
    const priceResult = await curveProvider.getCrvusdVusdPrice();
    
    if (priceResult.success && priceResult.price) {
      logger.info(`Current crvUSD/VUSD price: ${priceResult.price.toFixed(6)}`);
      
      const deviation = Math.abs(priceResult.price - 1.0);
      logger.info(`Deviation from $1 peg: ${(deviation * 100).toFixed(4)}%`);
      
      if (priceResult.price > 1.01) {
        logger.info('RICH scenario: crvUSD trading above VUSD');
      } else if (priceResult.price < 0.99) {
        logger.info('CHEAP scenario: crvUSD trading below VUSD');
      } else {
        logger.info('Price is near peg, no arbitrage opportunity');
      }
    } else {
      logger.error(`Failed to get price: ${priceResult.error}`);
    }
    
  } catch (error) {
    logger.error('Curve provider test failed', error as Error);
    process.exit(1);
  }
}

testCurveProvider();

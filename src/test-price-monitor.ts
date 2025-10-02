// src/test-price-monitor.ts
// Test script to verify price monitor is working correctly
// Tests continuous price checking and opportunity detection

import { ethers } from 'ethers';
import { loadConfig } from './utils/config';
import { logger } from './utils/logger';
import { CurveQuoteProvider } from './dex-providers/curve-quote-provider';
import { PriceMonitor, ArbitrageOpportunity, ArbitrageScenario } from './price-monitor';

async function testPriceMonitor() {
  try {
    logger.info('=== Testing Price Monitor ===');
    
    // Step 1: Load configuration
    logger.info('Step 1: Loading configuration...');
    const config = loadConfig();
    
    // Step 2: Setup provider and wallet
    logger.info('Step 2: Connecting to Ethereum mainnet...');
    const provider = new ethers.providers.JsonRpcProvider(config.ethereumRpcUrl);
    const wallet = new ethers.Wallet(config.searcherPrivateKey, provider);
    
    // Step 3: Initialize Curve quote provider
    logger.info('Step 3: Initializing Curve quote provider...');
    const curveProvider = new CurveQuoteProvider(
      wallet,
      config.curveCrvusdUsdcPool,
      config.curveCrvusdVusdPool,
      config.usdcAddress,
      config.crvusdAddress,
      config.vusdAddress
    );
    
    const initialized = await curveProvider.initialize();
    if (!initialized) {
      throw new Error('Failed to initialize Curve provider');
    }
    logger.info('Curve provider initialized successfully');
    
    // Step 4: Create price monitor with shorter interval for testing (15 seconds)
    logger.info('Step 4: Creating price monitor (checking every 15 seconds for testing)...');
    const priceMonitor = new PriceMonitor(
      curveProvider,
      15000, // Check every 15 seconds for testing (normally 60000)
      1.01,  // Rich threshold
      0.99   // Cheap threshold
    );
    
    // Step 5: Register callback for opportunities
    logger.info('Step 5: Registering opportunity callback...');
    priceMonitor.setOpportunityCallback((opportunity: ArbitrageOpportunity) => {
      logger.info('='.repeat(60));
      logger.info(`OPPORTUNITY DETECTED!`);
      logger.info(`  Scenario: ${opportunity.scenario}`);
      logger.info(`  Price: ${opportunity.price.toFixed(6)}`);
      logger.info(`  Deviation: ${opportunity.deviation.toFixed(4)}%`);
      logger.info(`  Timestamp: ${opportunity.timestamp.toISOString()}`);
      logger.info('='.repeat(60));
      
      // Display strategy based on scenario
      if (opportunity.scenario === ArbitrageScenario.RICH) {
        logger.info('Strategy: RICH scenario detected');
        logger.info('  → crvUSD is expensive (trading above VUSD)');
        logger.info('  → Flashloan USDC → Swap to crvUSD → Swap to VUSD → Redeem for USDC');
      } else if (opportunity.scenario === ArbitrageScenario.CHEAP) {
        logger.info('Strategy: CHEAP scenario detected');
        logger.info('  → crvUSD is cheap (trading below VUSD)');
        logger.info('  → Flashloan USDC → Mint VUSD → Swap to crvUSD → Swap to USDC');
      }
    });
    
    // Step 6: Start monitoring
    logger.info('Step 6: Starting price monitor...');
    await priceMonitor.start();
    
    // Display current config
    const config_data = priceMonitor.getConfig();
    logger.info('Price monitor configuration:', config_data);
    
    // Step 7: Run for 2 minutes (8 checks at 15-second intervals) then stop
    logger.info('Step 7: Monitoring prices for 2 minutes...');
    logger.info('Press Ctrl+C to stop early');
    
    await new Promise(resolve => setTimeout(resolve, 120000)); // 2 minutes
    
    // Step 8: Stop monitoring
    logger.info('Step 8: Stopping price monitor...');
    priceMonitor.stop();
    
    logger.info('=== Price Monitor Test Complete ===');
    
  } catch (error) {
    logger.error('Price monitor test failed', error as Error);
    process.exit(1);
  }
}

// Handle Ctrl+C gracefully
process.on('SIGINT', () => {
  logger.info('Received SIGINT, shutting down...');
  process.exit(0);
});

testPriceMonitor();

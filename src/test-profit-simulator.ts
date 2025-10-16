// src/test-profit-simulator.ts
// Test script for simplified profit simulator
// Tests RICH scenario with fixed amounts [1K, 5K, 10K]

import { ethers } from 'ethers';
import { loadConfig } from './utils/config';
import { logger } from './utils/logger';
import { CurveQuoteProvider } from './dex-providers/curve-quote-provider';
import { OraclePriceFetcher } from './utils/oracle-price-fetcher';
import { ProfitSimulator, ProfitSimulatorConfig } from './profit-simulator';
import { ArbitrageScenario } from './types/profit-simulation';

async function testProfitSimulator() {
  try {
    logger.info('='.repeat(70));
    logger.info('VUSD/crvUSD Arbitrage Profit Simulator - Test Run');
    logger.info('='.repeat(70));

    // Step 1: Load configuration and setup
    logger.info('\nStep 1: Loading configuration and connecting to Ethereum...');
    const config = loadConfig();
    const provider = new ethers.providers.JsonRpcProvider(config.ethereumRpcUrl);
    const wallet = new ethers.Wallet(config.searcherPrivateKey, provider);
    
    const network = await provider.getNetwork();
    const blockNumber = await provider.getBlockNumber();
    logger.info(`Connected to ${network.name} (chainId: ${network.chainId})`);
    logger.info(`Current block: ${blockNumber}`);

    // Step 2: Initialize Curve quote provider
    logger.info('\nStep 2: Initializing Curve quote provider...');
    const curveProvider = new CurveQuoteProvider(
      wallet,
      config.curveCrvusdUsdcPool,
      config.curveCrvusdVusdPool,
      config.usdcAddress,
      config.crvusdAddress,
      config.vusdAddress
    );
    
    const curveInitialized = await curveProvider.initialize();
    if (!curveInitialized) {
      throw new Error('Failed to initialize Curve provider');
    }
    logger.info('Curve provider initialized successfully');

    // Step 3: Initialize oracle fetcher
    logger.info('\nStep 3: Initializing oracle price fetcher...');
    const oracleFetcher = new OraclePriceFetcher(provider, 60000);
    
    // Get current oracle price
    const oraclePrice = await oracleFetcher.getUsdcPrice();
    if (!oraclePrice.success || !oraclePrice.price) {
      throw new Error('Failed to fetch oracle price');
    }
    logger.info(`Oracle price fetched: $${oraclePrice.price.toFixed(6)}`);
    logger.info(`Oracle within tolerance: ${oracleFetcher.isPriceWithinTolerance(oraclePrice.price) ? 'YES' : 'NO'}`);

    // Step 4: Get current crvUSD/VUSD price
    logger.info('\nStep 4: Fetching current crvUSD/VUSD price from Curve...');
    const priceResult = await curveProvider.getCrvusdVusdPrice();
    
    if (!priceResult.success || !priceResult.price) {
      throw new Error(`Failed to get price: ${priceResult.error}`);
    }
    
    const currentPrice = priceResult.price;
    const deviation = ((currentPrice - 1.0) / 1.0) * 100;
    
    logger.info(`Current crvUSD/VUSD price: ${currentPrice.toFixed(6)}`);
    logger.info(`Deviation from $1.00 peg: ${deviation.toFixed(4)}%`);

    // Step 5: Determine scenario
    logger.info('\nStep 5: Determining arbitrage scenario...');
    let scenario: ArbitrageScenario;
    
    if (currentPrice > 1.01) {
      scenario = ArbitrageScenario.RICH;
      logger.info(`RICH scenario detected (crvUSD > $1.01)`);
      logger.info('Strategy: USDC → crvUSD → VUSD → USDC (via redemption)');
    } else if (currentPrice < 0.99) {
      scenario = ArbitrageScenario.CHEAP;
      logger.info(`CHEAP scenario detected (crvUSD < $0.99)`);
      logger.info('Strategy: USDC → VUSD (mint) → crvUSD → USDC');
    } else {
      // Price is near peg - determine which scenario would be profitable
      logger.info(`Price near peg (${currentPrice.toFixed(6)})`);
      
      if (currentPrice < 1.0) {
        // crvUSD is slightly cheap - try CHEAP scenario
        scenario = ArbitrageScenario.CHEAP;
        logger.info('Price slightly below $1.00, testing CHEAP scenario');
        logger.info('Strategy: USDC → VUSD (mint) → crvUSD → USDC');
      } else {
        // crvUSD is slightly expensive - try RICH scenario
        scenario = ArbitrageScenario.RICH;
        logger.info('Price slightly above $1.00, testing RICH scenario');
        logger.info('Strategy: USDC → crvUSD → VUSD → USDC (via redemption)');
      }
    }

    // Step 6: Initialize profit simulator
    logger.info('\nStep 6: Initializing profit simulator...');
    
    const simulatorConfig: ProfitSimulatorConfig = {
      // Contract addresses from loaded config
      usdcAddress: config.usdcAddress,
      crvusdAddress: config.crvusdAddress,
      vusdAddress: config.vusdAddress,
      vusdMinterAddress: config.vusdMinterAddress,
      vusdRedeemerAddress: config.vusdRedeemerAddress,
      curveCrvusdUsdcPool: config.curveCrvusdUsdcPool,
      curveCrvusdVusdPool: config.curveCrvusdVusdPool,
      uniswapV3UsdcPool: config.uniswapV3UsdcPool,
      
      // Fee configuration (basis points)
      mintFeeBps: 1,           // 0.01%
      redeemFeeBps: 5,        // 0.10%
      flashloanFeeBps: 1,      // 0.01%
      
      // Gas configuration
      gasUnitsEstimate: 300000,
      ethPriceUsd: 0,       // Approximate ETH price, changed from 2500 to 0, ignore gas for now
      
      // Thresholds
      minProfitUsd: 5,         // Minimum $5 profit to execute
      richThreshold: 1.01,
      cheapThreshold: 0.99
    };
    
    const simulator = new ProfitSimulator(
      wallet,
      curveProvider,
      oracleFetcher,
      simulatorConfig
    );
    
    logger.info('Profit simulator initialized');

    // Step 7: Test multiple flashloan amounts
    logger.info('\nStep 7: Testing multiple flashloan amounts...');
    logger.info('Amounts to test: $1, $10,  $1,000, $5,000, $10,000 USDC');
    logger.info('-'.repeat(70));
    
    const bestResult = await simulator.findBestFlashloanAmount(
      scenario,
      [1, 10, 1000, 5000, 10000]
    );

    // Step 8: Display detailed results
    logger.info('\n' + '='.repeat(70));
    logger.info('DETAILED SIMULATION RESULTS');
    logger.info('='.repeat(70));
    
    logger.info(`\nScenario: ${bestResult.scenario}`);
    logger.info(`Timestamp: ${bestResult.timestamp.toISOString()}`);
    logger.info(`Current Price: $${bestResult.currentPrice.toFixed(6)}`);
    logger.info(`Target Price: $${bestResult.targetPrice.toFixed(6)}`);
    logger.info(`Deviation: ${bestResult.priceDeviation.toFixed(4)}%`);
    
    logger.info(`\n--- Flashloan Details ---`);
    logger.info(`Amount: ${bestResult.flashloanAmount.toFixed(2)} USDC`);
    logger.info(`Fee: ${bestResult.flashloanFee.toFixed(4)}% (${bestResult.flashloanFeeAmount.toFixed(2)} USDC)`);
    
    logger.info(`\n--- Oracle Impact ---`);
    logger.info(`Oracle Price: $${bestResult.oracleImpact.oraclePrice.toFixed(6)}`);
    logger.info(`Deviation from Peg: ${bestResult.oracleImpact.deviationFromPeg.toFixed(4)}%`);
    logger.info(`Impact on Redemption: ${bestResult.oracleImpact.impactOnRedeem.toFixed(4)}%`);
    logger.info(`Within Tolerance: ${bestResult.oracleImpact.withinTolerance ? 'YES' : 'NO'}`);
    if (bestResult.oracleImpact.wouldRevert) {
      logger.warn('WARNING: Oracle price would cause transaction to REVERT!');
    }
    
    logger.info(`\n--- Step-by-Step Breakdown ---`);
    for (const step of bestResult.steps) {
      logger.info(`\nStep ${step.stepNumber}: ${step.description}`);
      logger.info(`  Input: ${step.amountIn.toFixed(6)} ${step.tokenInSymbol}`);
      logger.info(`  Output: ${step.amountOut.toFixed(6)} ${step.tokenOutSymbol}`);
      if (step.exchangeRate > 0) {
        logger.info(`  Rate: ${step.exchangeRate.toFixed(6)}`);
      }
      if (step.feePercent) {
        logger.info(`  Fee: ${step.feePercent.toFixed(4)}% (${step.feeAmount?.toFixed(6)} ${step.tokenOutSymbol})`);
      }
      if (step.oracleImpact) {
        logger.info(`  Oracle Impact: ${step.oracleImpact.toFixed(6)} ${step.tokenOutSymbol}`);
      }
      if (step.gasEstimate) {
        logger.info(`  Gas Estimate: ${step.gasEstimate.toLocaleString()} units`);
      }
    }
    
    logger.info(`\n--- Gas Cost ---`);
    logger.info(`Total Gas Units: ${bestResult.gasCost.gasUnits.toLocaleString()}`);
    logger.info(`Gas Price: ${bestResult.gasCost.gasPriceGwei.toFixed(2)} gwei`);
    logger.info(`Gas Cost (ETH): ${bestResult.gasCost.gasCostEth.toFixed(6)} ETH`);
    logger.info(`Gas Cost (USD): $${bestResult.gasCost.gasCostUsd.toFixed(2)} (@ $${bestResult.gasCost.ethPriceUsd} ETH)`);
    
    logger.info(`\n--- Profitability Analysis ---`);
    logger.info(`Total USDC In: ${bestResult.totalAmountIn.toFixed(2)} USDC (flashloan + fee)`);
    logger.info(`Total USDC Out: ${bestResult.totalAmountOut.toFixed(2)} USDC (after all steps)`);
    logger.info(`Gross Profit: $${bestResult.grossProfit.toFixed(2)}`);
    logger.info(`Gas Cost: -$${bestResult.gasCost.gasCostUsd.toFixed(2)}`);
    logger.info(`Net Profit: $${bestResult.netProfit.toFixed(2)}`);
    logger.info(`Profit %: ${bestResult.profitPercent.toFixed(4)}%`);
    logger.info(`Is Profitable: ${bestResult.isProfitable ? 'YES' : 'NO'}`);
    
    logger.info(`\n--- Price Impact ---`);
    logger.info(`Price Before: $${bestResult.currentPrice.toFixed(6)}`);
    logger.info(`Price After: $${bestResult.priceAfterTrade.toFixed(6)}`);
    logger.info(`Price Change: ${bestResult.priceChange.toFixed(6)} (${((bestResult.priceChange / bestResult.currentPrice) * 100).toFixed(4)}%)`);
    
    logger.info(`\n--- Recommendation ---`);
    logger.info(bestResult.recommendation);
    
    if (bestResult.warnings.length > 0) {
      logger.info(`\n--- Warnings ---`);
      for (const warning of bestResult.warnings) {
        logger.warn(`  • ${warning}`);
      }
    }

    // Step 9: Summary
    logger.info('\n' + '='.repeat(70));
    logger.info('TEST SUMMARY');
    logger.info('='.repeat(70));
    logger.info(`Best Flashloan Amount: ${bestResult.flashloanAmount.toLocaleString()} USDC`);
    logger.info(`Expected Net Profit: $${bestResult.netProfit.toFixed(2)}`);
    logger.info(`Current Price: $${bestResult.currentPrice.toFixed(6)}`);
    logger.info(`Price After Trade: $${bestResult.priceAfterTrade.toFixed(6)}`);
    
    if (bestResult.isProfitable) {
      logger.info('\n✓ PROFITABLE ARBITRAGE OPPORTUNITY FOUND');
      logger.info(`  Profit: $${bestResult.netProfit.toFixed(2)} (${bestResult.profitPercent.toFixed(4)}%)`);
    } else {
      logger.info('\n✗ NOT PROFITABLE');
      logger.info(`  Loss: $${Math.abs(bestResult.netProfit).toFixed(2)}`);
    }
    
    if (bestResult.oracleImpact.wouldRevert) {
      logger.warn('\n⚠ CRITICAL: Oracle price would cause transaction to REVERT');
      logger.warn('   Do NOT attempt to execute this arbitrage');
    }

    logger.info('\n' + '='.repeat(70));
    logger.info('Profit simulator test completed successfully!');
    logger.info('='.repeat(70));

  } catch (error) {
    logger.error('Profit simulator test failed', error as Error);
    process.exit(1);
  }
}

// Run the test
testProfitSimulator();

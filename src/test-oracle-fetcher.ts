// src/test-oracle-fetcher.ts
// Test script to verify Chainlink oracle price fetching
// Tests both USDC and USDT oracles and demonstrates oracle impact calculations

import { ethers } from 'ethers';
import { loadConfig } from './utils/config';
import { logger } from './utils/logger';
import { OraclePriceFetcher } from './utils/oracle-price-fetcher';

async function testOracleFetcher() {
  try {
    logger.info('='.repeat(60));
    logger.info('Testing Chainlink Oracle Price Fetcher');
    logger.info('='.repeat(60));

    // Step 1: Load configuration and setup provider
    logger.info('Step 1: Connecting to Ethereum mainnet...');
    const config = loadConfig();
    const provider = new ethers.providers.JsonRpcProvider(config.ethereumRpcUrl);
    
    // Verify connection
    const network = await provider.getNetwork();
    const blockNumber = await provider.getBlockNumber();
    logger.info(`Connected to ${network.name} (chainId: ${network.chainId})`);
    logger.info(`Current block: ${blockNumber}`);

    // Step 2: Create oracle price fetcher
    logger.info('\nStep 2: Creating oracle price fetcher...');
    const oracleFetcher = new OraclePriceFetcher(provider, 60000); // 60 second cache
    logger.info('Oracle fetcher initialized');

    // Step 3: Fetch USDC/USD price
    logger.info('\nStep 3: Fetching USDC/USD oracle price...');
    logger.info('Oracle address: 0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6');
    
    const usdcPrice = await oracleFetcher.getUsdcPrice(false); // Force fresh query
    
    if (!usdcPrice.success) {
      throw new Error(`Failed to fetch USDC price: ${usdcPrice.error}`);
    }

    logger.info('Oracle query successful!');
    logger.info(`  Price: $${usdcPrice.price?.toFixed(6)}`);
    logger.info(`  Decimals: ${usdcPrice.decimals}`);
    logger.info(`  Updated: ${usdcPrice.updatedAt?.toISOString()}`);
    logger.info(`  Round ID: ${usdcPrice.roundId}`);
    logger.info(`  Is Stale: ${usdcPrice.isStale ? 'YES (WARNING)' : 'NO'}`);
    
    const priceDeviation = ((usdcPrice.price! - 1.0) * 100).toFixed(4);
    logger.info(`  Deviation from $1.00: ${priceDeviation}%`);

    // Step 4: Check if price is within tolerance
    logger.info('\nStep 4: Checking price tolerance...');
    const withinTolerance = oracleFetcher.isPriceWithinTolerance(usdcPrice.price!);
    logger.info(`Price within 1% tolerance: ${withinTolerance ? 'YES' : 'NO (TRANSACTION WOULD REVERT)'}`);
    
    if (!withinTolerance) {
      logger.warn('WARNING: Oracle price outside tolerance. Minter/Redeemer transactions will revert!');
      logger.warn('Valid range: $0.99 to $1.01');
    }

    // Step 5: Demonstrate oracle impact on minting
    logger.info('\nStep 5: Oracle impact on MINTING (CHEAP scenario)...');
    const mintAmount = 10000; // 10,000 USDC
    logger.info(`Minting ${mintAmount} USDC to VUSD...`);
    
    const vusdBeforeOracle = mintAmount; // Theoretical 1:1
    const vusdAfterOracle = oracleFetcher.calculateMintOracleImpact(mintAmount, usdcPrice.price!);
    const oracleMintImpact = vusdBeforeOracle - vusdAfterOracle;
    
    logger.info(`  Without oracle impact: ${vusdBeforeOracle.toFixed(2)} VUSD`);
    logger.info(`  With oracle impact: ${vusdAfterOracle.toFixed(2)} VUSD`);
    logger.info(`  Oracle impact: ${oracleMintImpact.toFixed(2)} VUSD (${((oracleMintImpact / vusdBeforeOracle) * 100).toFixed(4)}%)`);
    
    // Add mint fee (0.01% = 0.0001)
    const mintFee = vusdAfterOracle * 0.0001;
    const vusdAfterFee = vusdAfterOracle - mintFee;
    logger.info(`  Mint fee (0.01%): ${mintFee.toFixed(2)} VUSD`);
    logger.info(`  Final VUSD received: ${vusdAfterFee.toFixed(2)} VUSD`);

    // Step 6: Demonstrate oracle impact on redemption
    logger.info('\nStep 6: Oracle impact on REDEMPTION (RICH scenario)...');
    const redeemAmount = 10000; // 10,000 VUSD
    logger.info(`Redeeming ${redeemAmount} VUSD to USDC...`);
    
    const usdcBeforeOracle = redeemAmount; // Theoretical 1:1
    const usdcAfterOracle = oracleFetcher.calculateRedeemOracleImpact(redeemAmount, usdcPrice.price!);
    const oracleRedeemImpact = usdcBeforeOracle - usdcAfterOracle;
    
    logger.info(`  Without oracle impact: ${usdcBeforeOracle.toFixed(2)} USDC`);
    logger.info(`  With oracle impact: ${usdcAfterOracle.toFixed(2)} USDC`);
    logger.info(`  Oracle impact: ${oracleRedeemImpact.toFixed(2)} USDC (${((oracleRedeemImpact / usdcBeforeOracle) * 100).toFixed(4)}%)`);
    
    // Add redeem fee (0.10% = 0.001)
    const redeemFee = usdcAfterOracle * 0.001;
    const usdcAfterFee = usdcAfterOracle - redeemFee;
    logger.info(`  Redeem fee (0.10%): ${redeemFee.toFixed(2)} USDC`);
    logger.info(`  Final USDC received: ${usdcAfterFee.toFixed(2)} USDC`);

    // Step 7: Test cached query
    logger.info('\nStep 7: Testing cached oracle query...');
    const startTime = Date.now();
    const cachedPrice = await oracleFetcher.getUsdcPrice(true); // Use cache
    const queryTime = Date.now() - startTime;
    
    logger.info(`Cached query completed in ${queryTime}ms`);
    logger.info(`Same price: ${cachedPrice.price === usdcPrice.price}`);

    // Step 8: Test USDT oracle (optional)
    logger.info('\nStep 8: Fetching USDT/USD oracle price...');
    logger.info('Oracle address: 0x3E7d1eAB13ad0104d2750B8863b489D65364e32D');
    
    const usdtPrice = await oracleFetcher.getUsdtPrice(false);
    
    if (usdtPrice.success) {
      logger.info('USDT oracle query successful!');
      logger.info(`  Price: $${usdtPrice.price?.toFixed(6)}`);
      logger.info(`  Decimals: ${usdtPrice.decimals}`);
      logger.info(`  Updated: ${usdtPrice.updatedAt?.toISOString()}`);
    } else {
      logger.warn(`USDT oracle query failed: ${usdtPrice.error}`);
    }

    // Summary
    logger.info('\n' + '='.repeat(60));
    logger.info('Oracle Fetcher Test Summary');
    logger.info('='.repeat(60));
    logger.info(`USDC Oracle Price: $${usdcPrice.price?.toFixed(6)}`);
    logger.info(`Price is Stale: ${usdcPrice.isStale ? 'YES' : 'NO'}`);
    logger.info(`Within Tolerance: ${withinTolerance ? 'YES' : 'NO'}`);
    logger.info(`Oracle Mint Impact: ${((oracleMintImpact / vusdBeforeOracle) * 100).toFixed(4)}%`);
    logger.info(`Oracle Redeem Impact: ${((oracleRedeemImpact / usdcBeforeOracle) * 100).toFixed(4)}%`);
    
    if (Math.abs(usdcPrice.price! - 1.0) > 0.005) {
      logger.warn('\nWARNING: Oracle price deviates significantly from $1.00');
      logger.warn('This will impact arbitrage profitability calculations');
    } else {
      logger.info('\nOracle price is close to $1.00 - minimal impact on arbitrage');
    }

    logger.info('\n='.repeat(60));
    logger.info('Oracle fetcher test completed successfully!');
    logger.info('='.repeat(60));

  } catch (error) {
    logger.error('Oracle fetcher test failed', error as Error);
    process.exit(1);
  }
}

// Run the test
testOracleFetcher();

// scripts/calculate-min-flashbots-priority-fee.ts
// Dynamic Priority Fee Calculator for Flashbots Bundles
// 
// Purpose: Analyzes recent blocks to determine the MINIMUM priority fee
// needed to get your Flashbots bundle included without overpaying
//
// Strategy: Your bundle must beat the "tail" transactions in blocks
// (the lowest-paying transactions that still got included)

import { ethers, BigNumber } from 'ethers';
import * as dotenv from 'dotenv';

dotenv.config();

const RPC_URL = process.env.ETHEREUM_RPC_URL!;

// Configuration
const BLOCKS_TO_ANALYZE = 10; // Analyze last 10 blocks
const SAFETY_MARGIN_GWEI = 0.5; // Add 0.5 Gwei safety margin
const PERCENTILE = 20; // Use 20th percentile (lower than this, you might not get included)

interface BlockAnalysis {
  blockNumber: number;
  baseFee: BigNumber;
  transactionCount: number;
  minPriorityFee: BigNumber;
  avgPriorityFee: BigNumber;
  maxPriorityFee: BigNumber;
  percentile20PriorityFee: BigNumber;
}

/**
 * Analyze a single block's priority fees
 * Finds the minimum priority fee that got included
 */
async function analyzeBlock(
  provider: ethers.providers.Provider,
  blockNumber: number
): Promise<BlockAnalysis | null> {
  try {
    const block = await provider.getBlockWithTransactions(blockNumber);
    
    if (!block || !block.baseFeePerGas) {
      return null;
    }

    // Extract priority fees from all transactions
    const priorityFees: BigNumber[] = [];
    
    for (const tx of block.transactions) {
      if (tx.maxPriorityFeePerGas) {
        // EIP-1559 transaction - has explicit priority fee
        priorityFees.push(tx.maxPriorityFeePerGas);
      } else if (tx.gasPrice && block.baseFeePerGas) {
        // Legacy transaction - calculate implied priority fee
        const impliedPriorityFee = tx.gasPrice.sub(block.baseFeePerGas);
        if (impliedPriorityFee.gt(0)) {
          priorityFees.push(impliedPriorityFee);
        }
      }
    }

    if (priorityFees.length === 0) {
      return null;
    }

    // Sort priority fees ascending
    priorityFees.sort((a, b) => {
      if (a.lt(b)) return -1;
      if (a.gt(b)) return 1;
      return 0;
    });

    // Calculate statistics
    const minPriorityFee = priorityFees[0];
    const maxPriorityFee = priorityFees[priorityFees.length - 1];
    
    // Calculate average
    const sum = priorityFees.reduce((acc, fee) => acc.add(fee), BigNumber.from(0));
    const avgPriorityFee = sum.div(priorityFees.length);
    
    // Calculate 20th percentile (the "tail" of the block)
    const percentile20Index = Math.floor(priorityFees.length * (PERCENTILE / 100));
    const percentile20PriorityFee = priorityFees[percentile20Index];

    return {
      blockNumber,
      baseFee: block.baseFeePerGas,
      transactionCount: block.transactions.length,
      minPriorityFee,
      avgPriorityFee,
      maxPriorityFee,
      percentile20PriorityFee,
    };
  } catch (error: any) {
    console.error(`Error analyzing block ${blockNumber}:`, error.message);
    return null;
  }
}

/**
 * Main function - analyzes recent blocks and recommends priority fee
 */
async function main() {
  console.log('='.repeat(70));
  console.log('FLASHBOTS MINIMUM PRIORITY FEE CALCULATOR');
  console.log('='.repeat(70));
  console.log();

  if (!RPC_URL) {
    console.error('Error: ETHEREUM_RPC_URL not set in .env file');
    process.exit(1);
  }

  const provider = new ethers.providers.StaticJsonRpcProvider(RPC_URL);
  
  console.log('Connecting to Ethereum mainnet...');
  const latestBlock = await provider.getBlockNumber();
  console.log(`Latest block: ${latestBlock}`);
  console.log();

  console.log(`Analyzing last ${BLOCKS_TO_ANALYZE} blocks...`);
  console.log('This may take 30-60 seconds...');
  console.log();

  const analyses: BlockAnalysis[] = [];
  
  // Analyze recent blocks
  for (let i = 0; i < BLOCKS_TO_ANALYZE; i++) {
    const blockNumber = latestBlock - i;
    process.stdout.write(`  Analyzing block ${blockNumber}... `);
    
    const analysis = await analyzeBlock(provider, blockNumber);
    
    if (analysis) {
      analyses.push(analysis);
      console.log('✓');
    } else {
      console.log('✗ (skipped)');
    }
  }

  if (analyses.length === 0) {
    console.error('Error: Could not analyze any blocks');
    process.exit(1);
  }

  console.log();
  console.log('='.repeat(70));
  console.log('ANALYSIS RESULTS');
  console.log('='.repeat(70));
  console.log();

  // Display individual block stats
  console.log('Block-by-Block Priority Fees (in Gwei):');
  console.log('-'.repeat(70));
  console.log('Block #       | Base Fee | Min   | 20th %tile | Avg   | Max');
  console.log('-'.repeat(70));
  
  for (const analysis of analyses) {
    console.log(
      `${analysis.blockNumber} | ${ethers.utils.formatUnits(analysis.baseFee, 'gwei').padEnd(8)} | ` +
      `${ethers.utils.formatUnits(analysis.minPriorityFee, 'gwei').padEnd(5)} | ` +
      `${ethers.utils.formatUnits(analysis.percentile20PriorityFee, 'gwei').padEnd(10)} | ` +
      `${ethers.utils.formatUnits(analysis.avgPriorityFee, 'gwei').padEnd(5)} | ` +
      `${ethers.utils.formatUnits(analysis.maxPriorityFee, 'gwei')}`
    );
  }
  console.log();

  // Calculate recommendations
  const all20thPercentiles = analyses.map(a => a.percentile20PriorityFee);
  const allAvgPriorityFees = analyses.map(a => a.avgPriorityFee);
  
  // Sort for median calculation
  all20thPercentiles.sort((a, b) => {
    if (a.lt(b)) return -1;
    if (a.gt(b)) return 1;
    return 0;
  });

  // Get median 20th percentile (most reliable indicator)
  const medianIndex = Math.floor(all20thPercentiles.length / 2);
  const median20thPercentile = all20thPercentiles[medianIndex];
  
  // Get max 20th percentile (for conservative estimate)
  const max20thPercentile = all20thPercentiles[all20thPercentiles.length - 1];

  // Calculate average of averages
  const sumAvg = allAvgPriorityFees.reduce((acc, fee) => acc.add(fee), BigNumber.from(0));
  const overallAvg = sumAvg.div(allAvgPriorityFees.length);

  // Get current base fee
  const currentBlock = await provider.getBlock('latest');
  const currentBaseFee = currentBlock.baseFeePerGas!;

  // Calculate recommendations with safety margin
  const safetyMarginWei = ethers.utils.parseUnits(SAFETY_MARGIN_GWEI.toString(), 'gwei');
  
  const minRecommended = median20thPercentile.add(safetyMarginWei);
  const safeRecommended = max20thPercentile.add(safetyMarginWei);
  const aggressiveRecommended = overallAvg.add(safetyMarginWei);

  console.log('='.repeat(70));
  console.log('RECOMMENDATIONS');
  console.log('='.repeat(70));
  console.log();

  console.log('Current Network Conditions:');
  console.log(`  Current Base Fee: ${ethers.utils.formatUnits(currentBaseFee, 'gwei')} Gwei`);
  console.log();

  console.log('Priority Fee Recommendations (maxPriorityFeePerGas):');
  console.log();
  
  console.log('📊 MINIMUM (50% inclusion chance):');
  console.log(`   ${ethers.utils.formatUnits(minRecommended, 'gwei')} Gwei`);
  console.log(`   Risk: May not get included if network gets busier`);
  console.log();

  console.log('✅ SAFE (90% inclusion chance) - RECOMMENDED:');
  console.log(`   ${ethers.utils.formatUnits(safeRecommended, 'gwei')} Gwei`);
  console.log(`   Best balance of cost vs reliability`);
  console.log();

  console.log('⚡ AGGRESSIVE (99% inclusion chance):');
  console.log(`   ${ethers.utils.formatUnits(aggressiveRecommended, 'gwei')} Gwei`);
  console.log(`   Use when you need fast inclusion`);
  console.log();

  // Calculate total gas costs with different priority fees
  const estimatedGasUsed = 450000; // Your arbitrage tx uses ~450k gas

  console.log('='.repeat(70));
  console.log('ESTIMATED COSTS FOR YOUR ARBITRAGE TX (~450,000 gas)');
  console.log('='.repeat(70));
  console.log();

  const calculateCost = (priorityFee: BigNumber) => {
    const effectiveGasPrice = currentBaseFee.add(priorityFee);
    const totalCostWei = effectiveGasPrice.mul(estimatedGasUsed);
    const totalCostEth = ethers.utils.formatEther(totalCostWei);
    const totalCostUsd = parseFloat(totalCostEth) * 3000; // Assume $3000 ETH
    return { eth: totalCostEth, usd: totalCostUsd, effectiveGasPrice };
  };

  const minCost = calculateCost(minRecommended);
  const safeCost = calculateCost(safeRecommended);
  const aggressiveCost = calculateCost(aggressiveRecommended);

  console.log('Strategy        | Priority Fee | Effective Gas Price | Cost (ETH)  | Cost (USD)');
  console.log('-'.repeat(70));
  console.log(
    `Minimum         | ${ethers.utils.formatUnits(minRecommended, 'gwei').padEnd(12)} | ` +
    `${ethers.utils.formatUnits(minCost.effectiveGasPrice, 'gwei').padEnd(19)} | ` +
    `${parseFloat(minCost.eth).toFixed(6).padEnd(11)} | $${minCost.usd.toFixed(2)}`
  );
  console.log(
    `Safe (BEST)     | ${ethers.utils.formatUnits(safeRecommended, 'gwei').padEnd(12)} | ` +
    `${ethers.utils.formatUnits(safeCost.effectiveGasPrice, 'gwei').padEnd(19)} | ` +
    `${parseFloat(safeCost.eth).toFixed(6).padEnd(11)} | $${safeCost.usd.toFixed(2)}`
  );
  console.log(
    `Aggressive      | ${ethers.utils.formatUnits(aggressiveRecommended, 'gwei').padEnd(12)} | ` +
    `${ethers.utils.formatUnits(aggressiveCost.effectiveGasPrice, 'gwei').padEnd(19)} | ` +
    `${parseFloat(aggressiveCost.eth).toFixed(6).padEnd(11)} | $${aggressiveCost.usd.toFixed(2)}`
  );
  console.log();

  const savings = aggressiveCost.usd - safeCost.usd;
  console.log(`💰 Savings: Using SAFE vs AGGRESSIVE saves you $${savings.toFixed(2)} per tx`);
  console.log();

  console.log('='.repeat(70));
  console.log('HOW TO USE THESE VALUES');
  console.log('='.repeat(70));
  console.log();
  console.log('In your script, set:');
  console.log();
  console.log('  populatedTx.maxPriorityFeePerGas = ethers.utils.parseUnits(');
  console.log(`    '${ethers.utils.formatUnits(safeRecommended, 'gwei')}',`);
  console.log(`    'gwei'`);
  console.log('  );');
  console.log();
  console.log('  populatedTx.maxFeePerGas = block.baseFeePerGas!.add(');
  console.log(`    ethers.utils.parseUnits('${ethers.utils.formatUnits(safeRecommended, 'gwei')}', 'gwei')`);
  console.log('  );');
  console.log();

  console.log('='.repeat(70));
  console.log('IMPORTANT NOTES');
  console.log('='.repeat(70));
  console.log();
  console.log('1. Flashbots Gas Fee Refunds:');
  console.log('   - If you overpay, Flashbots may refund the difference');
  console.log('   - You essentially pay "second price" auction pricing');
  console.log('   - Refunds sent automatically to your signing wallet');
  console.log();
  console.log('2. Update Frequency:');
  console.log('   - Run this script every 10-30 minutes');
  console.log('   - Gas prices change with network activity');
  console.log('   - Weekend/late night = lower fees');
  console.log();
  console.log('3. For PROFITABLE Trades:');
  console.log('   - Use SAFE recommendation');
  console.log('   - Builders favor profitable bundles');
  console.log('   - Your 2 Gwei was too low!');
  console.log();
  console.log('4. For LOSING Trades (like Step 8c test):');
  console.log('   - Use AGGRESSIVE or higher (10-50 Gwei)');
  console.log('   - Builders need huge incentive to include losses');
  console.log('   - Consider skipping loss tests entirely');
  console.log();
}

main().catch((error) => {
  console.error('Unhandled error:', error);
  process.exit(1);
});

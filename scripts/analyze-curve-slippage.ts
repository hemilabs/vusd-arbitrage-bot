// scripts/analyze-curve-slippage.ts
// Script to analyze slippage on Curve pools for different trade sizes
// This helps identify where the 8k USDC failure occurs by showing actual pool behavior

import { ethers } from 'hardhat';
import * as dotenv from 'dotenv';

dotenv.config();

// Curve StableSwap ABI - only the functions we need
const CURVE_POOL_ABI = [
  'function coins(uint256 i) external view returns (address)',
  'function balances(uint256 i) external view returns (uint256)',
  'function get_dy(int128 i, int128 j, uint256 dx) external view returns (uint256)',
  'function A() external view returns (uint256)',
];

// Token ABI for decimals
const ERC20_ABI = [
  'function decimals() external view returns (uint8)',
  'function symbol() external view returns (string)',
];

// Contract addresses
const CURVE_CRVUSD_USDC_POOL = '0x4DEcE678ceceb27446b35C672dC7d61F30bAD69E';
const CURVE_CRVUSD_VUSD_POOL = '0xB1c189dfDe178FE9F90E72727837cC9289fB944F';

// Trade sizes to test (in USDC dollars, we'll convert to proper decimals)
const TRADE_SIZES = [5000, 7500, 10000, 20000];

interface PoolInfo {
  name: string;
  address: string;
  token0Symbol: string;
  token0Decimals: number;
  token1Symbol: string;
  token1Decimals: number;
  token0Balance: number;
  token1Balance: number;
  amplificationCoeff: number;
}

interface SlippageResult {
  tradeSize: number;
  inputAmount: string;
  expectedOutput: string;
  exchangeRate: number;
  idealRate: number;
  slippagePercent: number;
  priceImpactPercent: number;
}

/**
 * Get pool information including balances and token details
 */
async function getPoolInfo(poolAddress: string, poolName: string): Promise<PoolInfo> {
  const pool = await ethers.getContractAt(CURVE_POOL_ABI, poolAddress);
  
  // Get token addresses
  const token0Address = await pool.coins(0);
  const token1Address = await pool.coins(1);
  
  // Get token contracts for metadata
  const token0 = await ethers.getContractAt(ERC20_ABI, token0Address);
  const token1 = await ethers.getContractAt(ERC20_ABI, token1Address);
  
  // Get token details
  const token0Symbol = await token0.symbol();
  const token1Symbol = await token1.symbol();
  const token0Decimals = await token0.decimals();
  const token1Decimals = await token1.decimals();
  
  // Get pool balances
  const token0BalanceRaw = await pool.balances(0);
  const token1BalanceRaw = await pool.balances(1);
  
  const token0Balance = parseFloat(ethers.utils.formatUnits(token0BalanceRaw, token0Decimals));
  const token1Balance = parseFloat(ethers.utils.formatUnits(token1BalanceRaw, token1Decimals));
  
  // Get amplification coefficient
  const amplificationCoeff = (await pool.A()).toNumber();
  
  return {
    name: poolName,
    address: poolAddress,
    token0Symbol,
    token0Decimals,
    token1Symbol,
    token1Decimals,
    token0Balance,
    token1Balance,
    amplificationCoeff,
  };
}

/**
 * Calculate slippage for a given trade
 */
async function calculateSlippage(
  poolAddress: string,
  poolInfo: PoolInfo,
  inputIndex: number,
  outputIndex: number,
  tradeSize: number
): Promise<SlippageResult> {
  const pool = await ethers.getContractAt(CURVE_POOL_ABI, poolAddress);
  
  // Determine which token is input and output
  const inputDecimals = inputIndex === 0 ? poolInfo.token0Decimals : poolInfo.token1Decimals;
  const outputDecimals = outputIndex === 0 ? poolInfo.token0Decimals : poolInfo.token1Decimals;
  
  // Convert trade size to proper decimals
  const inputAmountRaw = ethers.utils.parseUnits(tradeSize.toString(), inputDecimals);
  
  // Get expected output from Curve
  const outputAmountRaw = await pool.get_dy(inputIndex, outputIndex, inputAmountRaw);
  
  // Convert to human-readable
  const inputAmount = parseFloat(ethers.utils.formatUnits(inputAmountRaw, inputDecimals));
  const expectedOutput = parseFloat(ethers.utils.formatUnits(outputAmountRaw, outputDecimals));
  
  // Calculate exchange rate (how much output per 1 input)
  const exchangeRate = expectedOutput / inputAmount;
  
  // Ideal rate for stablecoins is 1.0
  const idealRate = 1.0;
  
  // Calculate slippage percentage
  // Slippage = (ideal_output - actual_output) / ideal_output * 100
  const idealOutput = inputAmount * idealRate;
  const slippagePercent = ((idealOutput - expectedOutput) / idealOutput) * 100;
  
  // Calculate price impact as percentage of pool
  const poolLiquidity = inputIndex === 0 ? poolInfo.token0Balance : poolInfo.token1Balance;
  const priceImpactPercent = (inputAmount / poolLiquidity) * 100;
  
  return {
    tradeSize,
    inputAmount: inputAmount.toFixed(2),
    expectedOutput: expectedOutput.toFixed(2),
    exchangeRate,
    idealRate,
    slippagePercent,
    priceImpactPercent,
  };
}

/**
 * Format and display pool information
 */
function displayPoolInfo(poolInfo: PoolInfo): void {
  console.log('\n' + '='.repeat(80));
  console.log(`POOL: ${poolInfo.name}`);
  console.log('='.repeat(80));
  console.log(`Address: ${poolInfo.address}`);
  console.log(`\nToken 0: ${poolInfo.token0Symbol} (${poolInfo.token0Decimals} decimals)`);
  console.log(`  Balance: ${poolInfo.token0Balance.toLocaleString()} ${poolInfo.token0Symbol}`);
  console.log(`\nToken 1: ${poolInfo.token1Symbol} (${poolInfo.token1Decimals} decimals)`);
  console.log(`  Balance: ${poolInfo.token1Balance.toLocaleString()} ${poolInfo.token1Symbol}`);
  console.log(`\nTotal Liquidity: $${(poolInfo.token0Balance + poolInfo.token1Balance).toLocaleString()}`);
  console.log(`Amplification Coefficient: ${poolInfo.amplificationCoeff}`);
}

/**
 * Display slippage results in a formatted table
 */
function displaySlippageResults(
  direction: string,
  results: SlippageResult[]
): void {
  console.log(`\n${'-'.repeat(80)}`);
  console.log(`${direction}`);
  console.log('-'.repeat(80));
  console.log('Trade Size | Input      | Output     | Rate    | Slippage | Pool Impact');
  console.log('-'.repeat(80));
  
  for (const result of results) {
    const tradeSize = `$${result.tradeSize.toLocaleString()}`.padEnd(10);
    const input = result.inputAmount.padEnd(10);
    const output = result.expectedOutput.padEnd(10);
    const rate = result.exchangeRate.toFixed(6).padEnd(8);
    const slippage = `${result.slippagePercent >= 0 ? '+' : ''}${result.slippagePercent.toFixed(4)}%`.padEnd(9);
    const impact = `${result.priceImpactPercent.toFixed(2)}%`;
    
    // Color code dangerous slippage
    const slippageWarning = Math.abs(result.slippagePercent) > 0.5 ? ' ⚠️ HIGH' : 
                           Math.abs(result.slippagePercent) > 0.1 ? ' ⚠️' : '';
    
    console.log(`${tradeSize} | ${input} | ${output} | ${rate} | ${slippage} | ${impact}${slippageWarning}`);
  }
}

/**
 * Main analysis function
 */
async function main() {
  console.log('\n' + '█'.repeat(80));
  console.log('CURVE POOL SLIPPAGE ANALYSIS');
  console.log('Testing trade sizes: $5k, $7.5k, $10k, $20k');
  console.log('█'.repeat(80));
  
  // Get pool information
  const usdcPoolInfo = await getPoolInfo(CURVE_CRVUSD_USDC_POOL, 'crvUSD/USDC Pool');
  const vusdPoolInfo = await getPoolInfo(CURVE_CRVUSD_VUSD_POOL, 'crvUSD/VUSD Pool');
  
  displayPoolInfo(usdcPoolInfo);
  displayPoolInfo(vusdPoolInfo);
  
  console.log('\n\n' + '█'.repeat(80));
  console.log('SLIPPAGE ANALYSIS RESULTS');
  console.log('█'.repeat(80));
  
  // Test USDC → crvUSD (used in RICH scenario, step 1)
  console.log('\n\n' + '▓'.repeat(80));
  console.log('1. RICH SCENARIO - STEP 1: USDC → crvUSD (on USDC/crvUSD pool)');
  console.log('▓'.repeat(80));
  const usdcToCrvusdResults: SlippageResult[] = [];
  for (const size of TRADE_SIZES) {
    const result = await calculateSlippage(
      CURVE_CRVUSD_USDC_POOL,
      usdcPoolInfo,
      0, // USDC is token 0
      1, // crvUSD is token 1
      size
    );
    usdcToCrvusdResults.push(result);
  }
  displaySlippageResults('USDC → crvUSD', usdcToCrvusdResults);
  
  // Test crvUSD → VUSD (used in RICH scenario, step 2) - THIS IS THE CRITICAL ONE
  console.log('\n\n' + '▓'.repeat(80));
  console.log('2. RICH SCENARIO - STEP 2: crvUSD → VUSD (on crvUSD/VUSD pool) ⚠️ SMALL POOL');
  console.log('▓'.repeat(80));
  const crvusdToVusdResults: SlippageResult[] = [];
  for (const size of TRADE_SIZES) {
    const result = await calculateSlippage(
      CURVE_CRVUSD_VUSD_POOL,
      vusdPoolInfo,
      0, // crvUSD is token 0
      1, // VUSD is token 1
      size
    );
    crvusdToVusdResults.push(result);
  }
  displaySlippageResults('crvUSD → VUSD', crvusdToVusdResults);
  
  // Test VUSD → crvUSD (used in CHEAP scenario, step 2)
  console.log('\n\n' + '▓'.repeat(80));
  console.log('3. CHEAP SCENARIO - STEP 2: VUSD → crvUSD (on crvUSD/VUSD pool) ⚠️ SMALL POOL');
  console.log('▓'.repeat(80));
  const vusdToCrvusdResults: SlippageResult[] = [];
  for (const size of TRADE_SIZES) {
    const result = await calculateSlippage(
      CURVE_CRVUSD_VUSD_POOL,
      vusdPoolInfo,
      1, // VUSD is token 1
      0, // crvUSD is token 0
      size
    );
    vusdToCrvusdResults.push(result);
  }
  displaySlippageResults('VUSD → crvUSD', vusdToCrvusdResults);
  
  // Test crvUSD → USDC (used in CHEAP scenario, step 3)
  console.log('\n\n' + '▓'.repeat(80));
  console.log('4. CHEAP SCENARIO - STEP 3: crvUSD → USDC (on USDC/crvUSD pool)');
  console.log('▓'.repeat(80));
  const crvusdToUsdcResults: SlippageResult[] = [];
  for (const size of TRADE_SIZES) {
    const result = await calculateSlippage(
      CURVE_CRVUSD_USDC_POOL,
      usdcPoolInfo,
      1, // crvUSD is token 1
      0, // USDC is token 0
      size
    );
    crvusdToUsdcResults.push(result);
  }
  displaySlippageResults('crvUSD → USDC', crvusdToUsdcResults);
  
  // Summary and conclusions
  console.log('\n\n' + '█'.repeat(80));
  console.log('ANALYSIS SUMMARY');
  console.log('█'.repeat(80));
  
  // Find the worst slippage for each trade size
  console.log('\nWorst Slippage by Trade Size (across all pools):');
  console.log('-'.repeat(80));
  for (let i = 0; i < TRADE_SIZES.length; i++) {
    const size = TRADE_SIZES[i];
    const slippages = [
      { pool: 'USDC→crvUSD', slippage: usdcToCrvusdResults[i].slippagePercent },
      { pool: 'crvUSD→VUSD', slippage: crvusdToVusdResults[i].slippagePercent },
      { pool: 'VUSD→crvUSD', slippage: vusdToCrvusdResults[i].slippagePercent },
      { pool: 'crvUSD→USDC', slippage: crvusdToUsdcResults[i].slippagePercent },
    ];
    
    const worst = slippages.reduce((prev, curr) => 
      Math.abs(curr.slippage) > Math.abs(prev.slippage) ? curr : prev
    );
    
    console.log(`$${size.toLocaleString()}: Worst pool is ${worst.pool} with ${worst.slippage.toFixed(4)}% slippage`);
  }
  
  // Calculate total round-trip loss for RICH scenario
  console.log('\n\nEstimated Round-Trip Loss (RICH Scenario):');
  console.log('-'.repeat(80));
  console.log('Includes: USDC→crvUSD + crvUSD→VUSD slippage + 0.1% redeem fee + flashloan fee');
  console.log('-'.repeat(80));
  for (let i = 0; i < TRADE_SIZES.length; i++) {
    const size = TRADE_SIZES[i];
    const step1Slippage = usdcToCrvusdResults[i].slippagePercent;
    const step2Slippage = crvusdToVusdResults[i].slippagePercent;
    const redeemFee = 0.1; // 0.1% VUSD redeem fee
    const flashloanFee = 0.01; // 0.01% flashloan fee
    
    const totalLossPercent = step1Slippage + step2Slippage + redeemFee + flashloanFee;
    const totalLossDollars = (size * totalLossPercent) / 100;
    
    const warning = totalLossDollars > size * 0.002 ? ' ⚠️ HIGH LOSS' : ''; // >0.2% is concerning
    
    console.log(`$${size.toLocaleString()}: Loss = ${totalLossPercent.toFixed(4)}% ($${totalLossDollars.toFixed(2)})${warning}`);
  }
  
  // Calculate total round-trip loss for CHEAP scenario
  console.log('\n\nEstimated Round-Trip Loss (CHEAP Scenario):');
  console.log('-'.repeat(80));
  console.log('Includes: 0.01% mint fee + VUSD→crvUSD + crvUSD→USDC slippage + flashloan fee');
  console.log('-'.repeat(80));
  for (let i = 0; i < TRADE_SIZES.length; i++) {
    const size = TRADE_SIZES[i];
    const mintFee = 0.01; // 0.01% VUSD mint fee
    const step2Slippage = vusdToCrvusdResults[i].slippagePercent;
    const step3Slippage = crvusdToUsdcResults[i].slippagePercent;
    const flashloanFee = 0.01; // 0.01% flashloan fee
    
    const totalLossPercent = mintFee + step2Slippage + step3Slippage + flashloanFee;
    const totalLossDollars = (size * totalLossPercent) / 100;
    
    const warning = totalLossDollars > size * 0.002 ? ' ⚠️ HIGH LOSS' : '';
    
    console.log(`$${size.toLocaleString()}: Loss = ${totalLossPercent.toFixed(4)}% ($${totalLossDollars.toFixed(2)})${warning}`);
  }
  
  console.log('\n' + '█'.repeat(80));
  console.log('KEY INSIGHTS:');
  console.log('█'.repeat(80));
  console.log('1. The crvUSD/VUSD pool is ~100x smaller than crvUSD/USDC pool');
  console.log('2. Slippage increases NON-LINEARLY with trade size');
  console.log('3. Pool impact >3% typically causes significant slippage');
  console.log('4. Combined with fees, even small slippage can cause repayment failure');
  console.log('█'.repeat(80) + '\n');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

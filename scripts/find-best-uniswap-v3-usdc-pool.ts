// scripts/find-best-uniswap-v3-usdc-pool.ts
// COMPREHENSIVE UNISWAP V3 POOL SCANNER
// Purpose: Scan all USDC pools on Uniswap V3, rank by liquidity and fees
// This helps us dynamically select the best pool for flashloans instead of hardcoding one address
//
// UPDATED: Now detects and displays USDC token position (token0 or token1) for each pool
//
// How it works:
// 1. Uses Uniswap V3 Factory to discover all USDC pools paired with major tokens
// 2. Checks all 4 fee tiers (0.01%, 0.05%, 0.30%, 1%)
// 3. Queries actual USDC balance in each pool (= max flashloan amount)
// 4. Detects which token position USDC occupies (token0 or token1)
// 5. Calculates score: 20% liquidity weight, 80% fee weight
// 6. Outputs ranked list of pools from best to worst
//
// Usage: npx hardhat run scripts/find-best-uniswap-v3-usdc-pool.ts --network hardhat

import { ethers } from 'hardhat';
import * as dotenv from 'dotenv';

dotenv.config();

// ============================================================================
// CONTRACT ADDRESSES
// ============================================================================

// Uniswap V3 core contracts
const UNISWAP_V3_FACTORY = '0x1F98431c8aD98523631AE4a59f267346ea31F984';

// Token addresses we care about
const USDC_ADDRESS = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const WETH_ADDRESS = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
const DAI_ADDRESS = '0x6B175474E89094C44Da98b954EedeAC495271d0F';
const USDT_ADDRESS = '0xdAC17F958D2ee523a2206206994597C13D831ec7';
const WBTC_ADDRESS = '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599';
const FRAX_ADDRESS = '0x853d955aCEf822Db058eb8505911ED77F175b99e';

// Uniswap V3 fee tiers in basis points (1 basis point = 0.01%)
// 100 = 0.01%, 500 = 0.05%, 3000 = 0.30%, 10000 = 1%
const FEE_TIERS = [100, 500, 3000, 10000];

// Old pool that was causing issues (for comparison)
const OLD_POOL_ADDRESS = '0x919b20Ac45304AEB09C9df5c604b3CD9D99a51cA';

// ============================================================================
// CONTRACT ABIs
// ============================================================================

// Uniswap V3 Factory ABI - only the functions we need
const FACTORY_ABI = [
  'function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool)',
];

// Uniswap V3 Pool ABI - only the functions we need
const POOL_ABI = [
  'function token0() external view returns (address)',
  'function token1() external view returns (address)',
  'function fee() external view returns (uint24)',
  'function liquidity() external view returns (uint128)',
];

// ERC20 ABI - for checking balances and getting token info
const ERC20_ABI = [
  'function balanceOf(address account) external view returns (uint256)',
  'function decimals() external view returns (uint8)',
  'function symbol() external view returns (string)',
];

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface TokenPair {
  name: string;
  address: string;
  symbol: string;
}

interface PoolInfo {
  address: string;
  token0: string;
  token1: string;
  token0Symbol: string;
  token1Symbol: string;
  feeTier: number; // in basis points
  feePercent: number; // human-readable percentage
  usdcBalance: number; // actual USDC in the pool (max flashloan amount)
  liquidityScore: number; // 0-100 based on USDC balance
  feeScore: number; // 0-100 based on fee tier (lower fee = higher score)
  totalScore: number; // weighted combination of liquidity and fee scores
  pairName: string; // e.g., "USDC/WETH"
  usdcIsToken1: boolean; // NEW: Is USDC token1 (true) or token0 (false)?
}

// ============================================================================
// CONFIGURATION
// ============================================================================

// Tokens to check for USDC pairs
// We'll check USDC paired with each of these tokens across all fee tiers
const TOKENS_TO_CHECK: TokenPair[] = [
  { name: 'WETH', address: WETH_ADDRESS, symbol: 'WETH' },
  { name: 'DAI', address: DAI_ADDRESS, symbol: 'DAI' },
  { name: 'USDT', address: USDT_ADDRESS, symbol: 'USDT' },
  { name: 'WBTC', address: WBTC_ADDRESS, symbol: 'WBTC' },
  { name: 'FRAX', address: FRAX_ADDRESS, symbol: 'FRAX' },
];

// Scoring weights (must add up to 1.0)
const LIQUIDITY_WEIGHT = 0.2; // 20% - just need "enough" liquidity
const FEE_WEIGHT = 0.8; // 80% - prioritize low fees for profit

// Liquidity ceiling for normalization (1 billion USDC)
// Any pool with 1B+ USDC gets max liquidity score
const MAX_LIQUIDITY_FOR_SCORING = 1_000_000_000;

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Convert fee tier (basis points) to human-readable percentage
 * @param feeTier Fee in basis points (e.g., 500 = 0.05%)
 * @returns Human-readable percentage string
 */
function formatFeePercent(feeTier: number): number {
  return feeTier / 10000; // Convert basis points to percentage
}

/**
 * Calculate liquidity score (0-100) based on USDC balance
 * Higher USDC balance = higher score
 * @param usdcBalance USDC balance in the pool
 * @returns Score from 0 to 100
 */
function calculateLiquidityScore(usdcBalance: number): number {
  // Normalize to 0-100 scale
  // Pools with MAX_LIQUIDITY_FOR_SCORING or more get 100 points
  const score = Math.min(100, (usdcBalance / MAX_LIQUIDITY_FOR_SCORING) * 100);
  return score;
}

/**
 * Calculate fee score (0-100) based on fee tier
 * Lower fee = higher score (because lower fees are better for us)
 * @param feeTier Fee in basis points
 * @returns Score from 0 to 100
 */
function calculateFeeScore(feeTier: number): number {
  // 0.01% fee (100 bps) = 99 points
  // 0.05% fee (500 bps) = 95 points
  // 0.30% fee (3000 bps) = 70 points
  // 1.00% fee (10000 bps) = 0 points
  const score = 100 - (feeTier / 10000) * 100;
  return score;
}

/**
 * Calculate total weighted score for a pool
 * Combines liquidity score (20%) and fee score (80%)
 * @param liquidityScore Liquidity score (0-100)
 * @param feeScore Fee score (0-100)
 * @returns Total weighted score (0-100)
 */
function calculateTotalScore(liquidityScore: number, feeScore: number): number {
  return liquidityScore * LIQUIDITY_WEIGHT + feeScore * FEE_WEIGHT;
}

/**
 * Format number with commas for readability
 * @param num Number to format
 * @returns Formatted string with commas
 */
function formatNumber(num: number): string {
  return num.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

/**
 * Check if an address is a valid pool (not zero address)
 * @param address Address to check
 * @returns True if valid pool address
 */
function isValidPool(address: string): boolean {
  return address !== ethers.constants.AddressZero;
}

// ============================================================================
// POOL DISCOVERY AND ANALYSIS
// ============================================================================

/**
 * Discover a pool from the factory
 * Uses Uniswap V3 Factory.getPool() to find pool address for a token pair and fee tier
 * @param factory Factory contract instance
 * @param tokenA First token address
 * @param tokenB Second token address (USDC in our case)
 * @param fee Fee tier in basis points
 * @returns Pool address or zero address if doesn't exist
 */
async function discoverPool(
  factory: ethers.Contract,
  tokenA: string,
  tokenB: string,
  fee: number
): Promise<string> {
  try {
    const poolAddress = await factory.getPool(tokenA, tokenB, fee);
    return poolAddress;
  } catch (error: any) {
    console.log(`  Error discovering pool: ${error.message}`);
    return ethers.constants.AddressZero;
  }
}

/**
 * Analyze a pool to get all relevant information
 * Queries pool contract and USDC balance to build complete PoolInfo object
 * 
 * UPDATED: Now automatically detects which token position USDC occupies
 * - Queries pool.token0() and pool.token1()
 * - Compares against USDC_ADDRESS to determine position
 * - Throws error if pool doesn't contain USDC
 * 
 * @param poolAddress Address of the pool to analyze
 * @returns Complete PoolInfo object with all metrics
 */
async function analyzePool(poolAddress: string): Promise<PoolInfo | null> {
  try {
    // Get pool contract
    const pool = await ethers.getContractAt(POOL_ABI, poolAddress);

    // Get pool tokens and fee
    const token0 = await pool.token0();
    const token1 = await pool.token1();
    const feeTier = await pool.fee();

    // UPDATED: Detect USDC position in the pool
    // This is critical for knowing how to call flash() and which fee to use
    let usdcIsToken1: boolean;
    if (token0.toLowerCase() === USDC_ADDRESS.toLowerCase()) {
      // USDC is token0
      // flash() call: flash(recipient, usdcAmount, 0, data)
      // Fee to use: fee0
      usdcIsToken1 = false;
    } else if (token1.toLowerCase() === USDC_ADDRESS.toLowerCase()) {
      // USDC is token1
      // flash() call: flash(recipient, 0, usdcAmount, data)
      // Fee to use: fee1
      usdcIsToken1 = true;
    } else {
      // Pool doesn't contain USDC - this shouldn't happen if we're discovering correctly
      console.log(`  Warning: Pool ${poolAddress} doesn't contain USDC`);
      return null;
    }

    // Get token symbols for display
    const token0Contract = await ethers.getContractAt(ERC20_ABI, token0);
    const token1Contract = await ethers.getContractAt(ERC20_ABI, token1);
    const token0Symbol = await token0Contract.symbol();
    const token1Symbol = await token1Contract.symbol();

    // Determine which token is USDC and get the other token's symbol
    let otherTokenSymbol: string;
    if (token0.toLowerCase() === USDC_ADDRESS.toLowerCase()) {
      otherTokenSymbol = token1Symbol;
    } else if (token1.toLowerCase() === USDC_ADDRESS.toLowerCase()) {
      otherTokenSymbol = token0Symbol;
    } else {
      // Pool doesn't contain USDC
      return null;
    }

    // Get actual USDC balance in the pool
    // This is the maximum amount we can flashloan from this pool
    const usdcContract = await ethers.getContractAt(ERC20_ABI, USDC_ADDRESS);
    const usdcBalanceRaw = await usdcContract.balanceOf(poolAddress);
    const usdcBalance = parseFloat(ethers.utils.formatUnits(usdcBalanceRaw, 6));

    // Calculate scores
    const liquidityScore = calculateLiquidityScore(usdcBalance);
    const feeScore = calculateFeeScore(feeTier);
    const totalScore = calculateTotalScore(liquidityScore, feeScore);
    const feePercent = formatFeePercent(feeTier);

    // Build pair name for display
    const pairName = `USDC/${otherTokenSymbol}`;

    return {
      address: poolAddress,
      token0,
      token1,
      token0Symbol,
      token1Symbol,
      feeTier,
      feePercent,
      usdcBalance,
      liquidityScore,
      feeScore,
      totalScore,
      pairName,
      usdcIsToken1, // NEW: Return detected USDC position
    };
  } catch (error: any) {
    console.log(`  Error analyzing pool ${poolAddress}: ${error.message}`);
    return null;
  }
}

/**
 * Discover all USDC pools on Uniswap V3
 * Iterates through all token pairs and fee tiers to find every USDC pool
 * @param factory Factory contract instance
 * @returns Array of discovered pools (may include nulls for failed analyses)
 */
async function discoverAllPools(factory: ethers.Contract): Promise<(PoolInfo | null)[]> {
  console.log('Discovering USDC pools on Uniswap V3...\n');

  const pools: (PoolInfo | null)[] = [];
  let totalChecked = 0;
  let totalFound = 0;

  // Check each token paired with USDC
  for (const token of TOKENS_TO_CHECK) {
    console.log(`Checking ${token.symbol}/USDC pools...`);

    // Check each fee tier for this token pair
    for (const fee of FEE_TIERS) {
      totalChecked++;
      const feePercent = formatFeePercent(fee);

      // Discover pool from factory
      const poolAddress = await discoverPool(factory, USDC_ADDRESS, token.address, fee);

      if (isValidPool(poolAddress)) {
        totalFound++;
        console.log(`  ✓ Found ${token.symbol}/USDC ${feePercent}% pool: ${poolAddress}`);

        // Analyze the pool to get detailed info (including USDC position)
        const poolInfo = await analyzePool(poolAddress);
        if (poolInfo) {
          pools.push(poolInfo);
          console.log(`    USDC Balance: ${formatNumber(poolInfo.usdcBalance)} USDC`);
          console.log(`    USDC Position: token${poolInfo.usdcIsToken1 ? '1' : '0'}`);
        }
      } else {
        console.log(`  ✗ No ${token.symbol}/USDC ${feePercent}% pool exists`);
      }
    }
    console.log(''); // Empty line for readability
  }

  console.log(`Discovery complete: Found ${totalFound} pools out of ${totalChecked} checked\n`);
  return pools;
}

// ============================================================================
// RANKING AND DISPLAY
// ============================================================================

/**
 * Rank pools by total score (highest to lowest)
 * @param pools Array of pools to rank
 * @returns Sorted array of pools
 */
function rankPools(pools: PoolInfo[]): PoolInfo[] {
  return pools.sort((a, b) => b.totalScore - a.totalScore);
}

/**
 * Display ranked pools in a formatted table
 * UPDATED: Now includes USDC token position column
 * @param pools Ranked array of pools
 */
function displayRankedPools(pools: PoolInfo[]): void {
  console.log('═'.repeat(140));
  console.log('RANKED UNISWAP V3 USDC POOLS');
  console.log('═'.repeat(140));
  console.log('');

  console.log('Scoring methodology:');
  console.log(`  - Liquidity Score (${LIQUIDITY_WEIGHT * 100}%): Higher USDC balance = higher score`);
  console.log(`  - Fee Score (${FEE_WEIGHT * 100}%): Lower fee tier = higher score`);
  console.log(`  - Total Score: Weighted combination of both`);
  console.log('');

  console.log('─'.repeat(140));
  console.log(
    'Rank | Pool Address                               | Pair        | Fee    | USDC Balance      | Token Pos | Score'
  );
  console.log('─'.repeat(140));

  pools.forEach((pool, index) => {
    const rank = (index + 1).toString().padStart(4);
    const address = pool.address.padEnd(42);
    const pair = pool.pairName.padEnd(11);
    const fee = `${pool.feePercent.toFixed(2)}%`.padEnd(6);
    const balance = formatNumber(pool.usdcBalance).padStart(17);
    const tokenPos = `token${pool.usdcIsToken1 ? '1' : '0'}`.padEnd(9);
    const score = `${pool.totalScore.toFixed(2)}/100`;

    // Highlight the old problematic pool if it's in the list
    const highlight = pool.address.toLowerCase() === OLD_POOL_ADDRESS.toLowerCase() ? ' ⚠️  OLD POOL' : '';

    console.log(`${rank} | ${address} | ${pair} | ${fee} | ${balance} | ${tokenPos} | ${score}${highlight}`);
  });

  console.log('─'.repeat(140));
  console.log('');
}

/**
 * Display detailed information about the top pool
 * UPDATED: Now includes USDC token position information
 * @param pool Top-ranked pool
 */
function displayTopPoolDetails(pool: PoolInfo): void {
  console.log('═'.repeat(140));
  console.log('🏆 TOP POOL RECOMMENDATION');
  console.log('═'.repeat(140));
  console.log('');
  console.log(`Pool Address:      ${pool.address}`);
  console.log(`Pair:              ${pool.pairName}`);
  console.log(`Fee Tier:          ${pool.feePercent}% (${pool.feeTier} basis points)`);
  console.log(`USDC Balance:      ${formatNumber(pool.usdcBalance)} USDC`);
  console.log(`Max Flashloan:     ~${formatNumber(pool.usdcBalance)} USDC (minus small buffer for safety)`);
  console.log('');
  console.log('USDC Token Position:');
  console.log(`  USDC is token${pool.usdcIsToken1 ? '1' : '0'} in this pool`);
  if (pool.usdcIsToken1) {
    console.log(`  flash() call: flash(recipient, 0, usdcAmount, data)`);
    console.log(`  Fee to use: fee1`);
  } else {
    console.log(`  flash() call: flash(recipient, usdcAmount, 0, data)`);
    console.log(`  Fee to use: fee0`);
  }
  console.log('');
  console.log('Scores:');
  console.log(`  Liquidity Score: ${pool.liquidityScore.toFixed(2)}/100 (${LIQUIDITY_WEIGHT * 100}% weight)`);
  console.log(`  Fee Score:       ${pool.feeScore.toFixed(2)}/100 (${FEE_WEIGHT * 100}% weight)`);
  console.log(`  Total Score:     ${pool.totalScore.toFixed(2)}/100`);
  console.log('');
  console.log('Token Details:');
  console.log(`  Token0: ${pool.token0Symbol} (${pool.token0})`);
  console.log(`  Token1: ${pool.token1Symbol} (${pool.token1})`);
  console.log('');
  console.log('💡 Use this pool address in your VusdArbitrageBot contract!');
  console.log(`💡 Remember: USDC is token${pool.usdcIsToken1 ? '1' : '0'} - pass usdcIsToken1=${pool.usdcIsToken1} to constructor`);
  console.log('═'.repeat(140));
  console.log('');
}

/**
 * Find and display the old pool in the rankings (if it exists)
 * @param pools Ranked array of pools
 */
function displayOldPoolComparison(pools: PoolInfo[]): void {
  const oldPoolIndex = pools.findIndex(
    (p) => p.address.toLowerCase() === OLD_POOL_ADDRESS.toLowerCase()
  );

  if (oldPoolIndex >= 0) {
    const oldPool = pools[oldPoolIndex];
    const topPool = pools[0];

    console.log('⚠️  OLD POOL COMPARISON');
    console.log('─'.repeat(140));
    console.log('');
    console.log(`Old pool ranking: #${oldPoolIndex + 1} out of ${pools.length}`);
    console.log(`Old pool USDC balance: ${formatNumber(oldPool.usdcBalance)} USDC`);
    console.log(`Old pool USDC position: token${oldPool.usdcIsToken1 ? '1' : '0'}`);
    console.log(`Top pool USDC balance: ${formatNumber(topPool.usdcBalance)} USDC`);
    console.log(`Top pool USDC position: token${topPool.usdcIsToken1 ? '1' : '0'}`);
    console.log('');

    const improvement = ((topPool.usdcBalance / oldPool.usdcBalance) * 100).toFixed(2);
    console.log(
      `Improvement: Top pool has ${improvement}% of the USDC available compared to old pool`
    );
    console.log('');
  }
}

// ============================================================================
// MAIN EXECUTION
// ============================================================================

async function main() {
  console.log('\n');
  console.log('═'.repeat(140));
  console.log('UNISWAP V3 USDC POOL SCANNER');
  console.log('═'.repeat(140));
  console.log('');
  console.log('This script scans all Uniswap V3 pools containing USDC and ranks them by:');
  console.log('  1. USDC Liquidity (20% weight) - How much USDC can be flashloaned');
  console.log('  2. Fee Tier (80% weight) - Lower fees are better');
  console.log('  3. USDC Token Position - Detects if USDC is token0 or token1');
  console.log('');
  console.log(`Checking USDC pairs with: ${TOKENS_TO_CHECK.map((t) => t.symbol).join(', ')}`);
  console.log(`Fee tiers: ${FEE_TIERS.map((f) => `${formatFeePercent(f)}%`).join(', ')}`);
  console.log('');
  console.log('═'.repeat(140));
  console.log('\n');

  // Get factory contract
  const factory = await ethers.getContractAt(FACTORY_ABI, UNISWAP_V3_FACTORY);

  // Discover all pools
  const discoveredPools = await discoverAllPools(factory);

  // Filter out null pools (failed analyses)
  const validPools = discoveredPools.filter((p): p is PoolInfo => p !== null);

  if (validPools.length === 0) {
    console.log('❌ No valid pools found. This might indicate a network issue.');
    return;
  }

  // Rank pools by total score
  const rankedPools = rankPools(validPools);

  // Display results
  displayRankedPools(rankedPools);
  displayTopPoolDetails(rankedPools[0]);
  displayOldPoolComparison(rankedPools);

  // Summary
  console.log('✅ ANALYSIS COMPLETE');
  console.log('');
  console.log('Next steps:');
  console.log('  1. Review the top-ranked pool');
  console.log('  2. Update your VusdArbitrageBot contract to use this pool address');
  console.log('  3. Pass the correct usdcIsToken1 value to the constructor');
  console.log('  4. Run tests to verify flashloans work with the new pool');
  console.log('');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

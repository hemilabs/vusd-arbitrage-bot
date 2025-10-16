// src/utils/uniswap-v3-pool-selector.ts
// UNISWAP V3 POOL SELECTOR UTILITY MODULE
// Purpose: Reusable functions for discovering, ranking, and validating Uniswap V3 pools
// This module is used by tests and production scripts to dynamically select the best pool
//
// UPDATED: Now automatically detects USDC position (token0 or token1) in each pool
//
// Key functions:
// - getBestPoolForFlashloan() - Find optimal pool for a given flashloan amount
// - canPoolHandleFlashloan() - Check if pool has enough liquidity
// - getAllUsdcPools() - Discover all USDC pools on Uniswap V3
// - rankPools() - Sort pools by score (liquidity + fees)
//
// Usage in tests:
//   import { getBestPoolForFlashloan } from '../src/utils/uniswap-v3-pool-selector';
//   const bestPool = await getBestPoolForFlashloan(provider, toUsdc(10000));
//   await contract.executeRich(bestPool.address, toUsdc(10000));

import { ethers, BigNumber } from 'ethers';

// ============================================================================
// CONTRACT ADDRESSES
// ============================================================================

// Uniswap V3 Factory - used to discover pools
const UNISWAP_V3_FACTORY = '0x1F98431c8aD98523631AE4a59f267346ea31F984';

// Token addresses
const USDC_ADDRESS = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const WETH_ADDRESS = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
const DAI_ADDRESS = '0x6B175474E89094C44Da98b954EedeAC495271d0F';
const USDT_ADDRESS = '0xdAC17F958D2ee523a2206206994597C13D831ec7';
const WBTC_ADDRESS = '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599';
const FRAX_ADDRESS = '0x853d955aCEf822Db058eb8505911ED77F175b99e';

// ============================================================================
// CONFIGURATION
// ============================================================================

// Fee tiers in basis points (100 = 0.01%, 500 = 0.05%, 3000 = 0.30%, 10000 = 1%)
const FEE_TIERS = [100, 500, 3000, 10000];

// Tokens to check for USDC pairs
const TOKENS_TO_CHECK = [
  { name: 'WETH', address: WETH_ADDRESS },
  { name: 'DAI', address: DAI_ADDRESS },
  { name: 'USDT', address: USDT_ADDRESS },
  { name: 'WBTC', address: WBTC_ADDRESS },
  { name: 'FRAX', address: FRAX_ADDRESS },
];

// Scoring weights (must add up to 1.0)
// Higher liquidity weight = prioritize pools with more USDC
// Higher fee weight = prioritize pools with lower fees
// ADJUSTED: Prioritize low fees since 100k-1M USDC liquidity is plenty for our needs
const LIQUIDITY_WEIGHT = 0.2; // 20% weight on liquidity (just need "enough", not "maximum")
const FEE_WEIGHT = 0.8; // 80% weight on fees (this is where real profit comes from)

// Liquidity ceiling for scoring normalization
// Pools with 1B+ USDC get maximum liquidity score
const MAX_LIQUIDITY_FOR_SCORING = 1_000_000_000;

// Safety multiplier: pool should have X times more USDC than flashloan amount
// For example, if flashloan is 10k and multiplier is 2.0, pool must have 20k+ USDC
const DEFAULT_MIN_LIQUIDITY_MULTIPLIER = 2.0;

// ============================================================================
// CONTRACT ABIs
// ============================================================================

// Uniswap V3 Factory ABI
const FACTORY_ABI = [
  'function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool)',
];

// Uniswap V3 Pool ABI
const POOL_ABI = [
  'function token0() external view returns (address)',
  'function token1() external view returns (address)',
  'function fee() external view returns (uint24)',
  'function liquidity() external view returns (uint128)',
];

// ERC20 ABI
const ERC20_ABI = [
  'function balanceOf(address account) external view returns (uint256)',
  'function decimals() external view returns (uint8)',
  'function symbol() external view returns (string)',
];

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Information about a Uniswap V3 pool
 */
export interface PoolInfo {
  address: string; // Pool contract address
  token0: string; // First token address
  token1: string; // Second token address
  token0Symbol: string; // First token symbol (e.g., "USDC")
  token1Symbol: string; // Second token symbol (e.g., "DAI")
  feeTier: number; // Fee in basis points (e.g., 100 = 0.01%)
  feePercent: number; // Human-readable fee percentage (e.g., 0.01)
  usdcBalance: number; // Actual USDC in pool (max flashloan amount)
  liquidityScore: number; // Score 0-100 based on USDC balance
  feeScore: number; // Score 0-100 based on fee tier
  totalScore: number; // Weighted combination of liquidity and fee scores
  pairName: string; // Display name (e.g., "USDC/DAI")
  usdcIsToken1: boolean; // NEW: Is USDC token1 (true) or token0 (false)?
}

/**
 * Options for pool selection
 */
export interface PoolSelectionOptions {
  minLiquidityMultiplier?: number; // Pool must have this multiple of flashloan amount
  preferredFeeTier?: number; // Prefer pools with this fee tier (in basis points)
  excludePools?: string[]; // Pool addresses to exclude from selection
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Convert fee tier (basis points) to human-readable percentage
 * @param feeTier Fee in basis points (e.g., 500)
 * @returns Percentage as decimal (e.g., 0.05 for 0.05%)
 */
function formatFeePercent(feeTier: number): number {
  return feeTier / 10000;
}

/**
 * Calculate liquidity score (0-100) based on USDC balance
 * Higher USDC balance = higher score
 * @param usdcBalance USDC balance in the pool
 * @returns Score from 0 to 100
 */
function calculateLiquidityScore(usdcBalance: number): number {
  const score = Math.min(100, (usdcBalance / MAX_LIQUIDITY_FOR_SCORING) * 100);
  return score;
}

/**
 * Calculate fee score (0-100) based on fee tier
 * Lower fee = higher score
 * @param feeTier Fee in basis points
 * @returns Score from 0 to 100
 */
function calculateFeeScore(feeTier: number): number {
  // 0.01% fee = 99 points, 1% fee = 0 points
  const score = 100 - (feeTier / 10000) * 100;
  return score;
}

/**
 * Calculate total weighted score for a pool
 * Combines liquidity score (70%) and fee score (30%)
 * @param liquidityScore Liquidity score (0-100)
 * @param feeScore Fee score (0-100)
 * @returns Total weighted score (0-100)
 */
function calculateTotalScore(liquidityScore: number, feeScore: number): number {
  return liquidityScore * LIQUIDITY_WEIGHT + feeScore * FEE_WEIGHT;
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
// POOL DISCOVERY
// ============================================================================

/**
 * Discover a specific pool from the Uniswap V3 factory
 * Uses factory.getPool() to find pool address for a token pair and fee tier
 * @param provider Ethers provider
 * @param tokenA First token address
 * @param tokenB Second token address
 * @param fee Fee tier in basis points
 * @returns Pool address or zero address if doesn't exist
 */
async function discoverPool(
  provider: ethers.providers.Provider,
  tokenA: string,
  tokenB: string,
  fee: number
): Promise<string> {
  try {
    const factory = new ethers.Contract(UNISWAP_V3_FACTORY, FACTORY_ABI, provider);
    const poolAddress = await factory.getPool(tokenA, tokenB, fee);
    return poolAddress;
  } catch (error: any) {
    console.error(`Error discovering pool: ${error.message}`);
    return ethers.constants.AddressZero;
  }
}

/**
 * Analyze a pool to get complete information
 * Queries pool contract and USDC balance to build PoolInfo object
 * 
 * UPDATED: Now automatically detects which token position USDC occupies
 * - Queries pool.token0() and pool.token1()
 * - Compares against USDC_ADDRESS to determine position
 * - Throws error if pool doesn't contain USDC
 * 
 * @param provider Ethers provider
 * @param poolAddress Address of the pool to analyze
 * @returns Complete PoolInfo object or null if analysis fails
 */
async function analyzePool(
  provider: ethers.providers.Provider,
  poolAddress: string
): Promise<PoolInfo | null> {
  try {
    // Get pool contract
    const pool = new ethers.Contract(poolAddress, POOL_ABI, provider);

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
      // Pool doesn't contain USDC - this should never happen if we're
      // discovering pools correctly, but we throw an error to be safe
      throw new Error(
        `Pool ${poolAddress} does not contain USDC. Token0: ${token0}, Token1: ${token1}`
      );
    }

    // Get token symbols for display
    const token0Contract = new ethers.Contract(token0, ERC20_ABI, provider);
    const token1Contract = new ethers.Contract(token1, ERC20_ABI, provider);
    const token0Symbol = await token0Contract.symbol();
    const token1Symbol = await token1Contract.symbol();

    // Determine which token is USDC and get the other token's symbol
    let otherTokenSymbol: string;
    if (token0.toLowerCase() === USDC_ADDRESS.toLowerCase()) {
      otherTokenSymbol = token1Symbol;
    } else {
      otherTokenSymbol = token0Symbol;
    }

    // Get actual USDC balance in the pool
    // This is the maximum amount we can flashloan from this pool
    const usdcContract = new ethers.Contract(USDC_ADDRESS, ERC20_ABI, provider);
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
    console.error(`Error analyzing pool ${poolAddress}: ${error.message}`);
    return null;
  }
}

/**
 * Discover all USDC pools on Uniswap V3
 * Iterates through all token pairs and fee tiers to find every USDC pool
 * @param provider Ethers provider
 * @returns Array of discovered pools (nulls filtered out)
 */
export async function getAllUsdcPools(
  provider: ethers.providers.Provider
): Promise<PoolInfo[]> {
  const pools: PoolInfo[] = [];

  // Check each token paired with USDC
  for (const token of TOKENS_TO_CHECK) {
    // Check each fee tier for this token pair
    for (const fee of FEE_TIERS) {
      // Discover pool from factory
      const poolAddress = await discoverPool(provider, USDC_ADDRESS, token.address, fee);

      if (isValidPool(poolAddress)) {
        // Analyze the pool to get detailed info (including USDC position)
        const poolInfo = await analyzePool(provider, poolAddress);
        if (poolInfo) {
          pools.push(poolInfo);
        }
      }
    }
  }

  return pools;
}

// ============================================================================
// POOL RANKING
// ============================================================================

/**
 * Rank pools by total score (highest to lowest)
 * Pools with higher scores are better (more liquidity + lower fees)
 * @param pools Array of pools to rank
 * @returns Sorted array of pools (best first)
 */
export function rankPools(pools: PoolInfo[]): PoolInfo[] {
  return pools.sort((a, b) => b.totalScore - a.totalScore);
}

/**
 * Filter pools by minimum liquidity requirement
 * Removes pools that don't have enough USDC for the flashloan amount
 * @param pools Array of pools to filter
 * @param flashloanAmount Flashloan amount in USDC (as number, not BigNumber)
 * @param minLiquidityMultiplier Pool must have this multiple of flashloan amount
 * @returns Filtered array of pools with sufficient liquidity
 */
export function filterPoolsByLiquidity(
  pools: PoolInfo[],
  flashloanAmount: number,
  minLiquidityMultiplier: number = DEFAULT_MIN_LIQUIDITY_MULTIPLIER
): PoolInfo[] {
  const minRequired = flashloanAmount * minLiquidityMultiplier;
  return pools.filter((pool) => pool.usdcBalance >= minRequired);
}

/**
 * Filter pools by preferred fee tier
 * Prioritizes pools with the specified fee tier, but includes others if needed
 * @param pools Array of pools to filter
 * @param preferredFeeTier Preferred fee tier in basis points (e.g., 100 for 0.01%)
 * @returns Pools with preferred fee tier first, then others
 */
export function filterPoolsByFeeTier(
  pools: PoolInfo[],
  preferredFeeTier: number
): PoolInfo[] {
  const preferred = pools.filter((p) => p.feeTier === preferredFeeTier);
  const others = pools.filter((p) => p.feeTier !== preferredFeeTier);
  return [...preferred, ...others];
}

/**
 * Exclude specific pools from selection
 * Useful for avoiding known problematic pools
 * @param pools Array of pools to filter
 * @param excludeAddresses Array of pool addresses to exclude
 * @returns Filtered array without excluded pools
 */
export function excludePools(pools: PoolInfo[], excludeAddresses: string[]): PoolInfo[] {
  const excludeLowercase = excludeAddresses.map((addr) => addr.toLowerCase());
  return pools.filter((pool) => !excludeLowercase.includes(pool.address.toLowerCase()));
}

// ============================================================================
// POOL VALIDATION
// ============================================================================

/**
 * Check if a pool can handle a flashloan of the given amount
 * Validates that pool has enough USDC liquidity
 * @param poolAddress Address of the pool to check
 * @param flashloanAmount Flashloan amount (as BigNumber in USDC decimals)
 * @param provider Ethers provider
 * @param minLiquidityMultiplier Pool must have this multiple of flashloan amount
 * @returns True if pool can handle the flashloan
 */
export async function canPoolHandleFlashloan(
  poolAddress: string,
  flashloanAmount: BigNumber,
  provider: ethers.providers.Provider,
  minLiquidityMultiplier: number = DEFAULT_MIN_LIQUIDITY_MULTIPLIER
): Promise<boolean> {
  try {
    // Get pool info
    const poolInfo = await analyzePool(provider, poolAddress);
    if (!poolInfo) {
      return false;
    }

    // Convert flashloan amount to number for comparison
    const flashloanAmountNumber = parseFloat(ethers.utils.formatUnits(flashloanAmount, 6));

    // Check if pool has enough liquidity (with safety multiplier)
    const minRequired = flashloanAmountNumber * minLiquidityMultiplier;
    return poolInfo.usdcBalance >= minRequired;
  } catch (error: any) {
    console.error(`Error checking pool ${poolAddress}: ${error.message}`);
    return false;
  }
}

/**
 * Validate a pool address
 * Checks that it's a valid Uniswap V3 pool containing USDC
 * @param poolAddress Address to validate
 * @param provider Ethers provider
 * @returns True if valid USDC pool
 */
export async function isValidUsdcPool(
  poolAddress: string,
  provider: ethers.providers.Provider
): Promise<boolean> {
  try {
    const poolInfo = await analyzePool(provider, poolAddress);
    return poolInfo !== null;
  } catch (error: any) {
    return false;
  }
}

// ============================================================================
// MAIN POOL SELECTION FUNCTION
// ============================================================================

/**
 * Get the best pool for a given flashloan amount
 * This is the main function you'll use in tests and production
 * 
 * Selection process:
 * 1. Discover all USDC pools
 * 2. Filter pools with insufficient liquidity
 * 3. Apply optional fee tier preference
 * 4. Exclude problematic pools if specified
 * 5. Rank remaining pools by score
 * 6. Return the best pool
 * 
 * @param provider Ethers provider
 * @param flashloanAmount Flashloan amount (as BigNumber in USDC decimals)
 * @param options Optional configuration for pool selection
 * @returns Best pool for the flashloan, or null if none found
 * 
 * @example
 * // Simple usage - get best pool for 10k USDC flashloan
 * const bestPool = await getBestPoolForFlashloan(provider, toUsdc(10000));
 * await contract.executeRich(bestPool.address, toUsdc(10000));
 * 
 * @example
 * // Advanced usage - prefer 0.01% fee pools, require 3x liquidity
 * const bestPool = await getBestPoolForFlashloan(
 *   provider,
 *   toUsdc(10000),
 *   {
 *     preferredFeeTier: 100, // 0.01% fee
 *     minLiquidityMultiplier: 3.0, // Pool must have 30k+ USDC
 *     excludePools: ['0x919b20Ac45304AEB09C9df5c604b3CD9D99a51cA'] // Exclude old bad pool
 *   }
 * );
 */
export async function getBestPoolForFlashloan(
  provider: ethers.providers.Provider,
  flashloanAmount: BigNumber,
  options: PoolSelectionOptions = {}
): Promise<PoolInfo | null> {
  // Set default options
  const {
    minLiquidityMultiplier = DEFAULT_MIN_LIQUIDITY_MULTIPLIER,
    preferredFeeTier,
    excludePools: excludePoolAddresses = [],
  } = options;

  try {
    // Step 1: Discover all USDC pools
    let pools = await getAllUsdcPools(provider);

    if (pools.length === 0) {
      console.error('No USDC pools found');
      return null;
    }

    // Step 2: Filter pools with insufficient liquidity
    const flashloanAmountNumber = parseFloat(ethers.utils.formatUnits(flashloanAmount, 6));
    pools = filterPoolsByLiquidity(pools, flashloanAmountNumber, minLiquidityMultiplier);

    if (pools.length === 0) {
      console.error(
        `No pools found with sufficient liquidity for ${flashloanAmountNumber} USDC flashloan`
      );
      return null;
    }

    // Step 3: Apply fee tier preference if specified
    if (preferredFeeTier !== undefined) {
      pools = filterPoolsByFeeTier(pools, preferredFeeTier);
    }

    // Step 4: Exclude problematic pools if specified
    if (excludePoolAddresses.length > 0) {
      pools = excludePools(pools, excludePoolAddresses);
    }

    if (pools.length === 0) {
      console.error('No pools remaining after filtering');
      return null;
    }

    // Step 5: Rank pools by total score
    const rankedPools = rankPools(pools);

    // Step 6: Return the best pool
    return rankedPools[0];
  } catch (error: any) {
    console.error(`Error getting best pool: ${error.message}`);
    return null;
  }
}

/**
 * Get top N pools for a flashloan amount
 * Similar to getBestPoolForFlashloan but returns multiple options
 * Useful for having fallback pools in production
 * @param provider Ethers provider
 * @param flashloanAmount Flashloan amount (as BigNumber in USDC decimals)
 * @param topN Number of top pools to return
 * @param options Optional configuration for pool selection
 * @returns Array of top N pools, sorted by score (best first)
 */
export async function getTopPoolsForFlashloan(
  provider: ethers.providers.Provider,
  flashloanAmount: BigNumber,
  topN: number = 3,
  options: PoolSelectionOptions = {}
): Promise<PoolInfo[]> {
  const {
    minLiquidityMultiplier = DEFAULT_MIN_LIQUIDITY_MULTIPLIER,
    preferredFeeTier,
    excludePools: excludePoolAddresses = [],
  } = options;

  try {
    // Get all pools and apply filters (same as getBestPoolForFlashloan)
    let pools = await getAllUsdcPools(provider);

    if (pools.length === 0) {
      return [];
    }

    const flashloanAmountNumber = parseFloat(ethers.utils.formatUnits(flashloanAmount, 6));
    pools = filterPoolsByLiquidity(pools, flashloanAmountNumber, minLiquidityMultiplier);

    if (preferredFeeTier !== undefined) {
      pools = filterPoolsByFeeTier(pools, preferredFeeTier);
    }

    if (excludePoolAddresses.length > 0) {
      pools = excludePools(pools, excludePoolAddresses);
    }

    // Rank and return top N
    const rankedPools = rankPools(pools);
    return rankedPools.slice(0, topN);
  } catch (error: any) {
    console.error(`Error getting top pools: ${error.message}`);
    return [];
  }
}

// ============================================================================
// CONVENIENCE FUNCTIONS
// ============================================================================

/**
 * Get the default USDC/DAI 0.01% pool
 * This is the pool we identified as best: 0x5777d92f208679DB4b9778590Fa3CAB3aC9e2168
 * Use this when you want a reliable default without dynamic selection
 * @returns Pool address
 */
export function getDefaultPool(): string {
  return '0x5777d92f208679DB4b9778590Fa3CAB3aC9e2168';
}

/**
 * Get pool info for a specific address
 * Useful for checking a known pool's current state
 * @param provider Ethers provider
 * @param poolAddress Pool address to query
 * @returns PoolInfo or null if not found/invalid
 */
export async function getPoolInfo(
  provider: ethers.providers.Provider,
  poolAddress: string
): Promise<PoolInfo | null> {
  return analyzePool(provider, poolAddress);
}

/**
 * Compare two pools and return the better one
 * Useful for manual pool comparison
 * @param pool1 First pool
 * @param pool2 Second pool
 * @returns The pool with higher total score
 */
export function comparePoolsgetBetter(pool1: PoolInfo, pool2: PoolInfo): PoolInfo {
  return pool1.totalScore >= pool2.totalScore ? pool1 : pool2;
}

// ============================================================================
// EXPORTS
// ============================================================================

// Export constants for external use
export {
  LIQUIDITY_WEIGHT,
  FEE_WEIGHT,
  DEFAULT_MIN_LIQUIDITY_MULTIPLIER,
  USDC_ADDRESS,
  UNISWAP_V3_FACTORY,
};

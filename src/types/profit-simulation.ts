// src/types/profit-simulation.ts
// Type definitions for profit simulation and arbitrage calculations

import { BigNumber } from 'ethers';

/**
 * Arbitrage scenario types
 */
export enum ArbitrageScenario {
  RICH = 'RICH',   // crvUSD expensive: USDC → crvUSD → VUSD → USDC (redeem)
  CHEAP = 'CHEAP', // crvUSD cheap: USDC → VUSD (mint) → crvUSD → USDC
  NONE = 'NONE'    // No arbitrage opportunity
}

/**
 * Individual step in the arbitrage path
 * Each step represents a swap, mint, or redeem operation
 */
export interface SimulationStep {
  stepNumber: number;
  description: string;           // Human-readable description
  tokenIn: string;               // Input token address
  tokenInSymbol: string;         // Input token symbol
  amountIn: number;              // Input amount (decimal format)
  amountInRaw: BigNumber;        // Input amount (wei format)
  tokenOut: string;              // Output token address
  tokenOutSymbol: string;        // Output token symbol
  amountOut: number;             // Output amount (decimal format)
  amountOutRaw: BigNumber;       // Output amount (wei format)
  exchangeRate: number;          // Effective rate (amountOut / amountIn)
  feePercent?: number;           // Fee percentage (e.g., 0.01 for 0.01%)
  feeAmount?: number;            // Fee amount in output token
  oracleImpact?: number;         // Oracle impact in output token (if applicable)
  poolAddress?: string;          // Pool/contract address used
  gasEstimate?: number;          // Estimated gas for this step
}

/**
 * Oracle price impact details
 */
export interface OracleImpact {
  oraclePrice: number;           // Oracle price (e.g., 0.9997 for USDC)
  deviationFromPeg: number;      // Deviation from $1.00 in percentage
  impactOnMint: number;          // Additional slippage on minting (%)
  impactOnRedeem: number;        // Additional slippage on redemption (%)
  withinTolerance: boolean;      // Whether price is within 1% tolerance
  wouldRevert: boolean;          // Whether transaction would revert
}

/**
 * Gas cost breakdown
 */
export interface GasCost {
  gasUnits: number;              // Estimated gas units
  gasPriceGwei: number;          // Gas price in gwei
  gasCostEth: number;            // Total cost in ETH
  gasCostUsd: number;            // Total cost in USD (assuming ETH price)
  ethPriceUsd: number;           // ETH price used for calculation
}

/**
 * Complete profit simulation result
 */
export interface ProfitSimulation {
  scenario: ArbitrageScenario;
  timestamp: Date;
  
  // Market conditions
  currentPrice: number;              // Current crvUSD/VUSD price
  targetPrice: number;               // Target price (usually 1.00)
  priceDeviation: number;            // How far from peg (%)
  
  // Flashloan details
  flashloanAmount: number;           // Flashloan amount in USDC
  flashloanFee: number;              // Flashloan fee (0.01%)
  flashloanFeeAmount: number;        // Flashloan fee in USDC
  
  // Arbitrage path
  steps: SimulationStep[];           // Detailed breakdown of each step
  
  // Oracle impact
  oracleImpact: OracleImpact;
  
  // Profitability
  totalAmountIn: number;             // Total USDC input (flashloan + fee)
  totalAmountOut: number;            // Total USDC output after all steps
  grossProfit: number;               // Profit before gas
  gasCost: GasCost;                  // Gas cost breakdown
  netProfit: number;                 // Profit after gas
  profitPercent: number;             // Profit as percentage of flashloan
  
  // Recommendation
  isProfitable: boolean;             // Whether this is profitable
  recommendation: string;            // Human-readable recommendation
  
  // Price impact
  priceAfterTrade: number;           // Expected crvUSD/VUSD price after trade
  priceChange: number;               // How much price moved toward $1.00
  
  // Risk factors
  warnings: string[];                // Any warnings or risk factors
}

/**
 * Binary search result for optimal flashloan amount
 */
export interface OptimalFlashloanResult {
  optimalAmount: number;             // Optimal flashloan amount
  expectedProfit: number;            // Expected profit at optimal amount
  priceAfterTrade: number;           // Price after executing optimal amount
  priceChangePercent: number;        // How much closer to $1.00 (%)
  simulationDetails: ProfitSimulation; // Full simulation at optimal amount
  
  // Binary search metadata
  searchIterations: number;          // How many iterations to converge
  searchRange: [number, number];     // Final search range [min, max]
  convergenceError: number;          // How close to target price achieved
}

/**
 * Configuration for profit simulator
 */
export interface SimulatorConfig {
  // Flashloan config
  minFlashloan: number;              // Minimum flashloan amount (e.g., 1000)
  maxFlashloan: number;              // Maximum flashloan amount (e.g., 100000)
  flashloanFeePercent: number;       // Flashloan fee (0.01% = 0.0001)
  
  // Fee config
  mintFeePercent: number;            // VUSD mint fee (0.01% = 0.0001)
  redeemFeePercent: number;          // VUSD redeem fee (0.10% = 0.001)
  
  // Gas config
  gasUnitsEstimate: number;          // Estimated gas units (e.g., 300000)
  gasPriceGwei?: number;             // Gas price in gwei (fetch if not provided)
  ethPriceUsd?: number;              // ETH price in USD (fetch if not provided)
  
  // Optimization config
  targetPrice: number;               // Target crvUSD/VUSD price (usually 1.00)
  pricePrecision: number;            // How precise to get (e.g., 0.001 = within $0.001)
  maxIterations: number;             // Max binary search iterations (e.g., 20)
  
  // Profitability thresholds
  minProfitUsd: number;              // Minimum profit to execute (e.g., 5)
  maxLossUsd?: number;               // Maximum acceptable loss for peg restoration
  
  // Risk management
  maxSlippagePercent: number;        // Maximum acceptable slippage (e.g., 1.0%)
  requireProfitable: boolean;        // Only recommend if profitable
}

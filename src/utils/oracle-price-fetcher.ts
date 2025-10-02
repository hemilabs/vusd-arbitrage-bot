// src/utils/oracle-price-fetcher.ts
// Chainlink Oracle Price Fetcher for VUSD arbitrage bot
// Fetches real-time oracle prices that affect VUSD minting and redemption
//
// CRITICAL: The oracle price directly impacts profitability
// - Minting: If oracle says USDC = $0.99, you get 0.99 VUSD per USDC (on top of 0.01% mint fee)
// - Redeeming: If oracle says USDC = $1.01, you get 0.99 USDC per VUSD (on top of 0.10% redeem fee)
// - Oracle allows max 1% deviation from $1.00 (priceTolerance in Minter/Redeemer contracts)

import { ethers } from 'ethers';
import { logger } from './logger';

// Chainlink Aggregator V3 Interface (from IAggregatorV3.sol)
const CHAINLINK_AGGREGATOR_V3_ABI = [
  'function decimals() external view returns (uint8)',
  'function description() external view returns (string memory)',
  'function version() external view returns (uint256)',
  'function latestRoundData() external view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)'
];

// Known Chainlink oracle addresses (from Minter.sol)
export const ORACLE_ADDRESSES = {
  USDC_USD: '0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6',
  USDT_USD: '0x3E7d1eAB13ad0104d2750B8863b489D65364e32D'
};

// Oracle price result with metadata
export interface OraclePriceResult {
  success: boolean;
  price?: number;           // Price as a decimal (e.g., 1.0008 means $1.0008)
  priceRaw?: ethers.BigNumber;  // Raw price from oracle (with decimals)
  decimals?: number;        // Oracle decimals (usually 8 for Chainlink)
  updatedAt?: Date;         // When the price was last updated
  roundId?: string;         // Round ID from Chainlink
  isStale?: boolean;        // Whether price is older than stale period
  error?: string;
}

/**
 * Oracle Price Fetcher
 * Queries Chainlink oracles that VUSD Minter and Redeemer contracts use
 * 
 * Why this matters:
 * The oracle price creates additional slippage beyond fixed fees:
 * - If USDC oracle = $0.99: Minting gives you 1% LESS VUSD
 * - If USDC oracle = $1.01: Redeeming gives you 1% LESS USDC
 * 
 * This can turn a profitable arbitrage into a loss if not accounted for
 */
export class OraclePriceFetcher {
  private provider: ethers.providers.Provider;
  private oracleCache: Map<string, { price: OraclePriceResult; timestamp: number }> = new Map();
  private cacheDurationMs: number = 60000; // Cache for 60 seconds

  constructor(provider: ethers.providers.Provider, cacheDurationMs: number = 60000) {
    this.provider = provider;
    this.cacheDurationMs = cacheDurationMs;
  }

  /**
   * Get USDC/USD price from Chainlink oracle
   * This is the oracle the VUSD Minter and Redeemer contracts use
   * 
   * @param useCache Whether to use cached price if available
   * @returns OraclePriceResult with current price and metadata
   */
  async getUsdcPrice(useCache: boolean = true): Promise<OraclePriceResult> {
    return this.getOraclePrice(ORACLE_ADDRESSES.USDC_USD, 'USDC/USD', useCache);
  }

  /**
   * Get USDT/USD price from Chainlink oracle
   * 
   * @param useCache Whether to use cached price if available
   * @returns OraclePriceResult with current price and metadata
   */
  async getUsdtPrice(useCache: boolean = true): Promise<OraclePriceResult> {
    return this.getOraclePrice(ORACLE_ADDRESSES.USDT_USD, 'USDT/USD', useCache);
  }

  /**
   * Get price from any Chainlink oracle
   * 
   * @param oracleAddress Chainlink oracle contract address
   * @param description Human-readable description for logging
   * @param useCache Whether to use cached price
   * @returns OraclePriceResult with current price and metadata
   */
  async getOraclePrice(
    oracleAddress: string,
    description: string = 'Unknown',
    useCache: boolean = true
  ): Promise<OraclePriceResult> {
    try {
      // Check cache first
      if (useCache) {
        const cached = this.oracleCache.get(oracleAddress);
        if (cached && Date.now() - cached.timestamp < this.cacheDurationMs) {
          logger.debug(`Using cached oracle price for ${description}: ${cached.price.price?.toFixed(6)}`);
          return cached.price;
        }
      }

      // Create oracle contract instance
      const oracleContract = new ethers.Contract(
        oracleAddress,
        CHAINLINK_AGGREGATOR_V3_ABI,
        this.provider
      );

      // Get oracle metadata
      const decimals = await oracleContract.decimals();
      const oracleDescription = await oracleContract.description();

      // Get latest price data
      // latestRoundData returns: (roundId, answer, startedAt, updatedAt, answeredInRound)
      const latestRound = await oracleContract.latestRoundData();
      
      const roundId = latestRound.roundId;
      const answer = latestRound.answer;  // Raw price with decimals
      const updatedAt = latestRound.updatedAt;

      // Convert raw price to decimal
      // Example: answer = 100080000 (8 decimals) -> price = 1.0008
      const priceDecimal = Number(ethers.utils.formatUnits(answer, decimals));

      // Check if price is stale (older than 24 hours for USDC/USDT)
      const now = Math.floor(Date.now() / 1000);
      const stalePeriod = 24 * 60 * 60; // 24 hours in seconds
      const isStale = now - updatedAt.toNumber() > stalePeriod;

      const result: OraclePriceResult = {
        success: true,
        price: priceDecimal,
        priceRaw: answer,
        decimals: decimals,
        updatedAt: new Date(updatedAt.toNumber() * 1000),
        roundId: roundId.toString(),
        isStale: isStale
      };

      // Log warning if price is stale
      if (isStale) {
        const ageMinutes = Math.floor((now - updatedAt.toNumber()) / 60);
        logger.warn(
          `Oracle price is STALE for ${description}: last updated ${ageMinutes} minutes ago. ` +
          `This may cause transaction revert in Minter/Redeemer contracts.`
        );
      }

      // Cache the result
      this.oracleCache.set(oracleAddress, {
        price: result,
        timestamp: Date.now()
      });

      logger.debug(
        `Fetched oracle price for ${description}: $${priceDecimal.toFixed(6)} ` +
        `(updated ${Math.floor((now - updatedAt.toNumber()) / 60)} minutes ago)`
      );

      return result;

    } catch (error: any) {
      logger.error(`Failed to fetch oracle price for ${description} at ${oracleAddress}: ${error.message}`);
      
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Calculate oracle impact on minting
   * Mimics the logic in Minter.sol _calculateMintage() function
   * 
   * From Minter.sol lines 193-205:
   * _mintage = _latestPrice >= _oneUSD ? _actualAmountIn : (_actualAmountIn * _latestPrice) / _oneUSD;
   * 
   * @param usdcAmount Amount of USDC being minted
   * @param oraclePrice Oracle price (e.g., 0.9969 means USDC = $0.9969)
   * @returns VUSD amount after oracle impact (before mint fee)
   */
  calculateMintOracleImpact(usdcAmount: number, oraclePrice: number): number {
    // If oracle says USDC is worth $1.00 or more, you get 1:1
    // If oracle says USDC is worth less, you get proportionally less VUSD
    if (oraclePrice >= 1.0) {
      return usdcAmount;
    } else {
      return usdcAmount * oraclePrice;
    }
  }

  /**
   * Calculate oracle impact on redemption
   * Mimics the logic in Redeemer.sol _calculateRedeemable() function
   * 
   * From Redeemer.sol lines 128-131:
   * _redeemable = _latestPrice <= _oneUSD ? _vusdAmount : (_vusdAmount * _oneUSD) / _latestPrice;
   * 
   * @param vusdAmount Amount of VUSD being redeemed
   * @param oraclePrice Oracle price (e.g., 1.0008 means USDC = $1.0008)
   * @returns USDC amount after oracle impact (before redeem fee)
   */
  calculateRedeemOracleImpact(vusdAmount: number, oraclePrice: number): number {
    // If oracle says USDC is worth $1.00 or less, you get 1:1
    // If oracle says USDC is worth more, you get proportionally less USDC
    if (oraclePrice <= 1.0) {
      return vusdAmount;
    } else {
      return vusdAmount / oraclePrice;
    }
  }

  /**
   * Check if oracle price is within tolerance (1% for VUSD system)
   * 
   * From Minter.sol and Redeemer.sol:
   * priceTolerance = 100 basis points = 1%
   * Price must be between $0.99 and $1.01
   * 
   * @param oraclePrice Oracle price to check
   * @returns true if within tolerance, false if would cause revert
   */
  isPriceWithinTolerance(oraclePrice: number): boolean {
    const tolerance = 0.01; // 1%
    const upperBound = 1.0 + tolerance;
    const lowerBound = 1.0 - tolerance;
    
    return oraclePrice <= upperBound && oraclePrice >= lowerBound;
  }

  /**
   * Clear the cache (useful for testing or forcing fresh queries)
   */
  clearCache(): void {
    this.oracleCache.clear();
    logger.debug('Oracle price cache cleared');
  }
}

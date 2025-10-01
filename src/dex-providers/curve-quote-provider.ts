// src/dex-providers/curve-quote-provider.ts
// Curve Quote Provider adapted for VUSD arbitrage bot
// Queries Curve StableSwap NG pools for accurate price discovery
// Used to determine crvUSD/VUSD price and calculate arbitrage profitability

import { ethers, BigNumber, Signer } from 'ethers';
import { logger } from '../utils/logger';

// StableSwap NG ABI - only the functions we need
const STABLESWAP_ABI = [
  'function coins(uint256 i) external view returns (address)',
  'function get_dy(int128 i, int128 j, uint256 dx) external view returns (uint256)',
  'function balances(uint256 i) external view returns (uint256)',
];

interface CurvePoolConfig {
  address: string;
  token0: string;  // First token address
  token1: string;  // Second token address
  token0Symbol: string;
  token1Symbol: string;
}

interface QuoteResult {
  success: boolean;
  outputAmount?: BigNumber;
  error?: string;
}

/**
 * Simplified Curve Quote Provider for VUSD Arbitrage
 * Handles only the two pools we need: crvUSD/USDC and crvUSD/VUSD
 */
export class CurveQuoteProvider {
  private signer: Signer;
  private crvusdUsdcPool: CurvePoolConfig;
  private crvusdVusdPool: CurvePoolConfig;

  constructor(
    signer: Signer,
    crvusdUsdcPoolAddress: string,
    crvusdVusdPoolAddress: string,
    usdcAddress: string,
    crvusdAddress: string,
    vusdAddress: string
  ) {
    this.signer = signer;

    // Configure crvUSD/USDC pool
    // Note: We'll discover actual token order during initialization
    this.crvusdUsdcPool = {
      address: crvusdUsdcPoolAddress,
      token0: usdcAddress,  // FIXED: USDC is token0 in this pool
      token1: crvusdAddress,  // FIXED: crvUSD is token1
      token0Symbol: 'USDC',
      token1Symbol: 'crvUSD'
    };

    // Configure crvUSD/VUSD pool
    // Note: We'll verify token order during initialization
    this.crvusdVusdPool = {
      address: crvusdVusdPoolAddress,
      token0: crvusdAddress,
      token1: vusdAddress,
      token0Symbol: 'crvUSD',
      token1Symbol: 'VUSD'
    };
  }

  /**
   * Initialize and validate pool contracts
   * Checks that pools exist on-chain and have expected tokens
   */
  async initialize(): Promise<boolean> {
    try {
      logger.info('Initializing Curve quote provider');
      
      // Validate crvUSD/USDC pool
      await this.validatePool(this.crvusdUsdcPool);
      logger.info(`crvUSD/USDC pool validated at ${this.crvusdUsdcPool.address}`);
      
      // Validate crvUSD/VUSD pool
      await this.validatePool(this.crvusdVusdPool);
      logger.info(`crvUSD/VUSD pool validated at ${this.crvusdVusdPool.address}`);
      
      return true;
    } catch (error: any) {
      logger.error(`Failed to initialize Curve quote provider: ${error.message}`);
      return false;
    }
  }

  /**
   * Validate that a pool contract exists and has expected tokens
   */
  private async validatePool(pool: CurvePoolConfig): Promise<void> {
    const poolContract = new ethers.Contract(pool.address, STABLESWAP_ABI, this.signer);
    
    // Check that contract exists at address
    const code = await this.signer.provider!.getCode(pool.address);
    if (code === '0x') {
      throw new Error(`No contract found at pool address ${pool.address}`);
    }
    
    // Verify tokens in pool match expected tokens
    const token0InPool = await poolContract.coins(0);
    const token1InPool = await poolContract.coins(1);
    
    if (token0InPool.toLowerCase() !== pool.token0.toLowerCase()) {
      throw new Error(`Pool token0 mismatch: expected ${pool.token0}, got ${token0InPool}`);
    }
    if (token1InPool.toLowerCase() !== pool.token1.toLowerCase()) {
      throw new Error(`Pool token1 mismatch: expected ${pool.token1}, got ${token1InPool}`);
    }
  }

  /**
   * Get quote from crvUSD/USDC pool
   * Used in "rich" scenario to convert USDC -> crvUSD
   */
  async getQuoteCrvusdUsdc(
    inputToken: string,
    outputToken: string,
    amountIn: BigNumber
  ): Promise<QuoteResult> {
    return this.getQuote(this.crvusdUsdcPool, inputToken, outputToken, amountIn);
  }

  /**
   * Get quote from crvUSD/VUSD pool
   * This is the main pool we're monitoring for arbitrage opportunities
   */
  async getQuoteCrvusdVusd(
    inputToken: string,
    outputToken: string,
    amountIn: BigNumber
  ): Promise<QuoteResult> {
    return this.getQuote(this.crvusdVusdPool, inputToken, outputToken, amountIn);
  }

  /**
   * Get quote from a specific Curve pool
   * Uses Curve's get_dy function which calculates expected output for given input
   */
  private async getQuote(
    pool: CurvePoolConfig,
    inputToken: string,
    outputToken: string,
    amountIn: BigNumber
  ): Promise<QuoteResult> {
    try {
      const poolContract = new ethers.Contract(pool.address, STABLESWAP_ABI, this.signer);
      
      // Determine which token is which index (0 or 1) in the pool
      let inputIndex: number;
      let outputIndex: number;
      
      if (inputToken.toLowerCase() === pool.token0.toLowerCase()) {
        inputIndex = 0;
        outputIndex = 1;
      } else if (inputToken.toLowerCase() === pool.token1.toLowerCase()) {
        inputIndex = 1;
        outputIndex = 0;
      } else {
        return {
          success: false,
          error: `Input token ${inputToken} not found in pool ${pool.address}`
        };
      }
      
      // Call get_dy to get expected output amount
      // get_dy(i, j, dx) returns expected dy (output) for given dx (input)
      const outputAmount = await poolContract.get_dy(inputIndex, outputIndex, amountIn);
      
      if (outputAmount.isZero()) {
        return {
          success: false,
          error: 'Pool returned zero output amount'
        };
      }
      
      logger.debug(
        `Curve quote: ${ethers.utils.formatUnits(amountIn, 18)} ${inputIndex === 0 ? pool.token0Symbol : pool.token1Symbol} -> ` +
        `${ethers.utils.formatUnits(outputAmount, 18)} ${outputIndex === 0 ? pool.token0Symbol : pool.token1Symbol}`
      );
      
      return {
        success: true,
        outputAmount
      };
      
    } catch (error: any) {
      logger.debug(`Curve quote failed: ${error.message}`);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get current price of crvUSD in terms of VUSD
   * Price = 1.0 means 1 crvUSD = 1 VUSD (perfect peg)
   * Price > 1.0 means crvUSD is expensive relative to VUSD (rich scenario)
   * Price < 1.0 means crvUSD is cheap relative to VUSD (cheap scenario)
   */
  async getCrvusdVusdPrice(): Promise<{ success: boolean; price?: number; error?: string }> {
    try {
      // Use 1 crvUSD as input to get price
      const oneToken = ethers.utils.parseUnits('1', 18);
      
      const quote = await this.getQuoteCrvusdVusd(
        this.crvusdVusdPool.token0, // crvUSD
        this.crvusdVusdPool.token1, // VUSD
        oneToken
      );
      
      if (!quote.success || !quote.outputAmount) {
        return {
          success: false,
          error: quote.error || 'Failed to get quote'
        };
      }
      
      // Calculate price: how much VUSD you get for 1 crvUSD
      const price = parseFloat(ethers.utils.formatUnits(quote.outputAmount, 18));
      
      logger.debug(`crvUSD/VUSD price: ${price.toFixed(6)}`);
      
      return {
        success: true,
        price
      };
      
    } catch (error: any) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get pool balances for debugging/monitoring
   */
  async getPoolBalances(poolAddress: string): Promise<{ token0Balance: BigNumber; token1Balance: BigNumber }> {
    const poolContract = new ethers.Contract(poolAddress, STABLESWAP_ABI, this.signer);
    const token0Balance = await poolContract.balances(0);
    const token1Balance = await poolContract.balances(1);
    return { token0Balance, token1Balance };
  }
}

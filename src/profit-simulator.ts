// src/profit-simulator.ts
// SIMPLIFIED Profit Simulator for VUSD/crvUSD Arbitrage
// Tests fixed flashloan amounts [1K, 5K, 10K] to find most profitable
// Handles 6-decimal tokens (USDC) and 18-decimal tokens (VUSD, crvUSD) correctly

import { ethers, BigNumber, Signer } from 'ethers';
import { logger } from './utils/logger';
import { CurveQuoteProvider } from './dex-providers/curve-quote-provider';
import { OraclePriceFetcher } from './utils/oracle-price-fetcher';
import { 
  ProfitSimulation, 
  SimulationStep, 
  ArbitrageScenario,
  OracleImpact,
  GasCost
} from './types/profit-simulation';

/**
 * Profit Simulator Configuration
 */
export interface ProfitSimulatorConfig {
  // Contract addresses
  usdcAddress: string;
  crvusdAddress: string;
  vusdAddress: string;
  vusdMinterAddress: string;
  vusdRedeemerAddress: string;
  curveCrvusdUsdcPool: string;
  curveCrvusdVusdPool: string;
  uniswapV3UsdcPool: string;
  
  // Fee configuration (basis points)
  mintFeeBps: number;          // Default: 1 (0.01%)
  redeemFeeBps: number;        // Default: 10 (0.10%)
  flashloanFeeBps: number;     // Default: 1 (0.01%)
  
  // Gas configuration
  gasUnitsEstimate: number;    // Default: 300000
  ethPriceUsd?: number;        // Will fetch if not provided
  
  // Profitability thresholds
  minProfitUsd: number;        // Minimum profit to execute
  richThreshold: number;       // Execute RICH when price > this (e.g., 1.01)
  cheapThreshold: number;      // Execute CHEAP when price < this (e.g., 0.99)
}

/**
 * Simplified Profit Simulator
 * Tests fixed flashloan amounts and recommends the best one
 * Handles decimal conversions correctly for 6-decimal USDC and 18-decimal VUSD/crvUSD
 */
export class ProfitSimulator {
  private signer: Signer;
  private curveProvider: CurveQuoteProvider;
  private oracleFetcher: OraclePriceFetcher;
  private config: ProfitSimulatorConfig;
  
  // Token decimals (CRITICAL: USDC is 6 decimals, VUSD/crvUSD are 18)
  private readonly USDC_DECIMALS = 6;
  private readonly VUSD_DECIMALS = 18;
  private readonly CRVUSD_DECIMALS = 18;

  constructor(
    signer: Signer,
    curveProvider: CurveQuoteProvider,
    oracleFetcher: OraclePriceFetcher,
    config: ProfitSimulatorConfig
  ) {
    this.signer = signer;
    this.curveProvider = curveProvider;
    this.oracleFetcher = oracleFetcher;
    this.config = config;
  }

  /**
   * Test multiple flashloan amounts and return best result
   * Default amounts: [1000, 5000, 10000] USDC
   */
  async findBestFlashloanAmount(
    scenario: ArbitrageScenario,
    amounts: number[] = [1000, 5000, 10000]
  ): Promise<ProfitSimulation> {
    
    logger.info(`Testing ${amounts.length} flashloan amounts for ${scenario} scenario...`);
    
    let bestSimulation: ProfitSimulation | null = null;
    
    for (const amount of amounts) {
      logger.info(`\nSimulating with ${amount} USDC flashloan...`);
      
      const simulation = scenario === ArbitrageScenario.RICH
        ? await this.simulateRichScenario(amount)
        : await this.simulateCheapScenario(amount);
      
      logger.info(`  Net Profit: $${simulation.netProfit.toFixed(2)}`);
      logger.info(`  Price After: ${simulation.priceAfterTrade.toFixed(6)}`);
      
      if (!bestSimulation || simulation.netProfit > bestSimulation.netProfit) {
        bestSimulation = simulation;
      }
    }
    
    if (!bestSimulation) {
      throw new Error('No valid simulations found');
    }
    
    logger.info(`\nBest flashloan amount: ${bestSimulation.flashloanAmount} USDC`);
    logger.info(`Expected profit: $${bestSimulation.netProfit.toFixed(2)}`);
    
    return bestSimulation;
  }

  /**
   * Simulate RICH scenario: USDC → crvUSD → VUSD → USDC (redeem)
   * Used when crvUSD is expensive (trading above VUSD)
   */
  async simulateRichScenario(flashloanAmount: number): Promise<ProfitSimulation> {
    const steps: SimulationStep[] = [];
    let currentAmount = flashloanAmount;
    
    // Get current price
    const priceResult = await this.curveProvider.getCrvusdVusdPrice();
    if (!priceResult.success || !priceResult.price) {
      throw new Error('Failed to get current price');
    }
    const currentPrice = priceResult.price;
    
    // Get oracle impact
    const oracleImpact = await this.getOracleImpact();
    
    // Step 1: Flashloan USDC
    const flashloanFee = flashloanAmount * (this.config.flashloanFeeBps / 10000);
    steps.push({
      stepNumber: 1,
      description: 'Flashloan USDC from Uniswap V3',
      tokenIn: 'ETH',
      tokenInSymbol: 'ETH',
      amountIn: 0,
      amountInRaw: BigNumber.from(0),
      tokenOut: this.config.usdcAddress,
      tokenOutSymbol: 'USDC',
      amountOut: flashloanAmount,
      amountOutRaw: this.toTokenDecimals(flashloanAmount, this.USDC_DECIMALS),
      exchangeRate: 0,
      feePercent: this.config.flashloanFeeBps / 100,
      feeAmount: flashloanFee,
      poolAddress: this.config.uniswapV3UsdcPool,
      gasEstimate: 0
    });
    
    // Step 2: Swap USDC → crvUSD on Curve
    const usdcIn = this.toTokenDecimals(currentAmount, this.USDC_DECIMALS);
    const crvusdQuote = await this.curveProvider.getQuoteCrvusdUsdc(
      this.config.usdcAddress,
      this.config.crvusdAddress,
      usdcIn
    );
    
    if (!crvusdQuote.success || !crvusdQuote.outputAmount) {
      throw new Error('Failed to get USDC→crvUSD quote');
    }
    
    const crvusdReceived = this.fromTokenDecimals(crvusdQuote.outputAmount, this.CRVUSD_DECIMALS);
    steps.push({
      stepNumber: 2,
      description: 'Swap USDC → crvUSD on Curve',
      tokenIn: this.config.usdcAddress,
      tokenInSymbol: 'USDC',
      amountIn: currentAmount,
      amountInRaw: usdcIn,
      tokenOut: this.config.crvusdAddress,
      tokenOutSymbol: 'crvUSD',
      amountOut: crvusdReceived,
      amountOutRaw: crvusdQuote.outputAmount,
      exchangeRate: crvusdReceived / currentAmount,
      poolAddress: this.config.curveCrvusdUsdcPool,
      gasEstimate: 80000
    });
    currentAmount = crvusdReceived;
    
    // Step 3: Swap crvUSD → VUSD on Curve
    const crvusdIn = this.toTokenDecimals(currentAmount, this.CRVUSD_DECIMALS);
    const vusdQuote = await this.curveProvider.getQuoteCrvusdVusd(
      this.config.crvusdAddress,
      this.config.vusdAddress,
      crvusdIn
    );
    
    if (!vusdQuote.success || !vusdQuote.outputAmount) {
      throw new Error('Failed to get crvUSD→VUSD quote');
    }
    
    const vusdReceived = this.fromTokenDecimals(vusdQuote.outputAmount, this.VUSD_DECIMALS);
    steps.push({
      stepNumber: 3,
      description: 'Swap crvUSD → VUSD on Curve',
      tokenIn: this.config.crvusdAddress,
      tokenInSymbol: 'crvUSD',
      amountIn: currentAmount,
      amountInRaw: crvusdIn,
      tokenOut: this.config.vusdAddress,
      tokenOutSymbol: 'VUSD',
      amountOut: vusdReceived,
      amountOutRaw: vusdQuote.outputAmount,
      exchangeRate: vusdReceived / currentAmount,
      poolAddress: this.config.curveCrvusdVusdPool,
      gasEstimate: 80000
    });
    currentAmount = vusdReceived;
    
    // Step 4: Redeem VUSD → USDC (with oracle impact + fee)
    // Oracle impact (from Redeemer.sol logic)
    const usdcAfterOracle = this.oracleFetcher.calculateRedeemOracleImpact(
      currentAmount,
      oracleImpact.oraclePrice
    );
    const oracleImpactAmount = currentAmount - usdcAfterOracle;
    
    // Redeem fee (0.10% = 10 basis points)
    const redeemFee = usdcAfterOracle * (this.config.redeemFeeBps / 10000);
    const usdcRedeemed = usdcAfterOracle - redeemFee;
    
    steps.push({
      stepNumber: 4,
      description: 'Redeem VUSD → USDC via VUSD Redeemer',
      tokenIn: this.config.vusdAddress,
      tokenInSymbol: 'VUSD',
      amountIn: currentAmount,
      amountInRaw: this.toTokenDecimals(currentAmount, this.VUSD_DECIMALS),
      tokenOut: this.config.usdcAddress,
      tokenOutSymbol: 'USDC',
      amountOut: usdcRedeemed,
      amountOutRaw: this.toTokenDecimals(usdcRedeemed, this.USDC_DECIMALS),
      exchangeRate: usdcRedeemed / currentAmount,
      feePercent: this.config.redeemFeeBps / 100,
      feeAmount: redeemFee,
      oracleImpact: oracleImpactAmount,
      poolAddress: this.config.vusdRedeemerAddress,
      gasEstimate: 100000
    });
    currentAmount = usdcRedeemed;
    
    // Step 5: Repay flashloan
    const repaymentAmount = flashloanAmount + flashloanFee;
    steps.push({
      stepNumber: 5,
      description: 'Repay Flashloan to Uniswap V3',
      tokenIn: this.config.usdcAddress,
      tokenInSymbol: 'USDC',
      amountIn: repaymentAmount,
      amountInRaw: this.toTokenDecimals(repaymentAmount, this.USDC_DECIMALS),
      tokenOut: 'ETH',
      tokenOutSymbol: 'ETH',
      amountOut: 0,
      amountOutRaw: BigNumber.from(0),
      exchangeRate: 0,
      poolAddress: this.config.uniswapV3UsdcPool,
      gasEstimate: 40000
    });
    
    // Calculate gas cost
    const gasCost = await this.calculateGasCost(
      steps.reduce((sum, step) => sum + (step.gasEstimate || 0), 0)
    );
    
    // Calculate profitability
    const grossProfit = currentAmount - repaymentAmount;
    const netProfit = grossProfit - gasCost.gasCostUsd;
    
    // Estimate price after trade (simplified - just use quote ratio)
    const priceAfterTrade = this.estimatePriceAfterTrade(currentPrice, flashloanAmount, ArbitrageScenario.RICH);
    
    return {
      scenario: ArbitrageScenario.RICH,
      timestamp: new Date(),
      currentPrice,
      targetPrice: 1.0,
      priceDeviation: ((currentPrice - 1.0) / 1.0) * 100,
      flashloanAmount,
      flashloanFee: this.config.flashloanFeeBps / 100,
      flashloanFeeAmount: flashloanFee,
      steps,
      oracleImpact,
      totalAmountIn: repaymentAmount,
      totalAmountOut: currentAmount,
      grossProfit,
      gasCost,
      netProfit,
      profitPercent: (netProfit / flashloanAmount) * 100,
      isProfitable: netProfit > this.config.minProfitUsd,
      recommendation: this.generateRecommendation(netProfit, currentPrice),
      priceAfterTrade,
      priceChange: currentPrice - priceAfterTrade,
      warnings: this.generateWarnings(oracleImpact, currentPrice, netProfit)
    };
  }

  /**
   * Simulate CHEAP scenario: USDC → VUSD (mint) → crvUSD → USDC
   * Used when crvUSD is cheap (trading below VUSD)
   */
  async simulateCheapScenario(flashloanAmount: number): Promise<ProfitSimulation> {
    const steps: SimulationStep[] = [];
    let currentAmount = flashloanAmount;
    
    // Get current price
    const priceResult = await this.curveProvider.getCrvusdVusdPrice();
    if (!priceResult.success || !priceResult.price) {
      throw new Error('Failed to get current price');
    }
    const currentPrice = priceResult.price;
    
    // Get oracle impact
    const oracleImpact = await this.getOracleImpact();
    
    // Step 1: Flashloan USDC
    const flashloanFee = flashloanAmount * (this.config.flashloanFeeBps / 10000);
    steps.push({
      stepNumber: 1,
      description: 'Flashloan USDC from Uniswap V3',
      tokenIn: 'ETH',
      tokenInSymbol: 'ETH',
      amountIn: 0,
      amountInRaw: BigNumber.from(0),
      tokenOut: this.config.usdcAddress,
      tokenOutSymbol: 'USDC',
      amountOut: flashloanAmount,
      amountOutRaw: this.toTokenDecimals(flashloanAmount, this.USDC_DECIMALS),
      exchangeRate: 0,
      feePercent: this.config.flashloanFeeBps / 100,
      feeAmount: flashloanFee,
      poolAddress: this.config.uniswapV3UsdcPool,
      gasEstimate: 0
    });
    
    // Step 2: Mint USDC → VUSD (with oracle impact + mint fee)
    // Oracle impact (from Minter.sol logic)
    const vusdAfterOracle = this.oracleFetcher.calculateMintOracleImpact(
      currentAmount,
      oracleImpact.oraclePrice
    );
    const oracleImpactAmount = currentAmount - vusdAfterOracle;
    
    // Mint fee (0.01% = 1 basis point)
    const mintFee = vusdAfterOracle * (this.config.mintFeeBps / 10000);
    const vusdMinted = vusdAfterOracle - mintFee;
    
    steps.push({
      stepNumber: 2,
      description: 'Mint USDC → VUSD via VUSD Minter',
      tokenIn: this.config.usdcAddress,
      tokenInSymbol: 'USDC',
      amountIn: currentAmount,
      amountInRaw: this.toTokenDecimals(currentAmount, this.USDC_DECIMALS),
      tokenOut: this.config.vusdAddress,
      tokenOutSymbol: 'VUSD',
      amountOut: vusdMinted,
      amountOutRaw: this.toTokenDecimals(vusdMinted, this.VUSD_DECIMALS),
      exchangeRate: vusdMinted / currentAmount,
      feePercent: this.config.mintFeeBps / 100,
      feeAmount: mintFee,
      oracleImpact: oracleImpactAmount,
      poolAddress: this.config.vusdMinterAddress,
      gasEstimate: 100000
    });
    currentAmount = vusdMinted;
    
    // Step 3: Swap VUSD → crvUSD on Curve
    const vusdIn = this.toTokenDecimals(currentAmount, this.VUSD_DECIMALS);
    const crvusdQuote = await this.curveProvider.getQuoteCrvusdVusd(
      this.config.vusdAddress,
      this.config.crvusdAddress,
      vusdIn
    );
    
    if (!crvusdQuote.success || !crvusdQuote.outputAmount) {
      throw new Error('Failed to get VUSD→crvUSD quote');
    }
    
    const crvusdReceived = this.fromTokenDecimals(crvusdQuote.outputAmount, this.CRVUSD_DECIMALS);
    steps.push({
      stepNumber: 3,
      description: 'Swap VUSD → crvUSD on Curve',
      tokenIn: this.config.vusdAddress,
      tokenInSymbol: 'VUSD',
      amountIn: currentAmount,
      amountInRaw: vusdIn,
      tokenOut: this.config.crvusdAddress,
      tokenOutSymbol: 'crvUSD',
      amountOut: crvusdReceived,
      amountOutRaw: crvusdQuote.outputAmount,
      exchangeRate: crvusdReceived / currentAmount,
      poolAddress: this.config.curveCrvusdVusdPool,
      gasEstimate: 80000
    });
    currentAmount = crvusdReceived;
    
    // Step 4: Swap crvUSD → USDC on Curve
    const crvusdIn = this.toTokenDecimals(currentAmount, this.CRVUSD_DECIMALS);
    const usdcQuote = await this.curveProvider.getQuoteCrvusdUsdc(
      this.config.crvusdAddress,
      this.config.usdcAddress,
      crvusdIn
    );
    
    if (!usdcQuote.success || !usdcQuote.outputAmount) {
      throw new Error('Failed to get crvUSD→USDC quote');
    }
    
    const usdcReceived = this.fromTokenDecimals(usdcQuote.outputAmount, this.USDC_DECIMALS);
    steps.push({
      stepNumber: 4,
      description: 'Swap crvUSD → USDC on Curve',
      tokenIn: this.config.crvusdAddress,
      tokenInSymbol: 'crvUSD',
      amountIn: currentAmount,
      amountInRaw: crvusdIn,
      tokenOut: this.config.usdcAddress,
      tokenOutSymbol: 'USDC',
      amountOut: usdcReceived,
      amountOutRaw: usdcQuote.outputAmount,
      exchangeRate: usdcReceived / currentAmount,
      poolAddress: this.config.curveCrvusdUsdcPool,
      gasEstimate: 80000
    });
    currentAmount = usdcReceived;
    
    // Step 5: Repay flashloan
    const repaymentAmount = flashloanAmount + flashloanFee;
    steps.push({
      stepNumber: 5,
      description: 'Repay Flashloan to Uniswap V3',
      tokenIn: this.config.usdcAddress,
      tokenInSymbol: 'USDC',
      amountIn: repaymentAmount,
      amountInRaw: this.toTokenDecimals(repaymentAmount, this.USDC_DECIMALS),
      tokenOut: 'ETH',
      tokenOutSymbol: 'ETH',
      amountOut: 0,
      amountOutRaw: BigNumber.from(0),
      exchangeRate: 0,
      poolAddress: this.config.uniswapV3UsdcPool,
      gasEstimate: 40000
    });
    
    // Calculate gas cost
    const gasCost = await this.calculateGasCost(
      steps.reduce((sum, step) => sum + (step.gasEstimate || 0), 0)
    );
    
    // Calculate profitability
    const grossProfit = currentAmount - repaymentAmount;
    const netProfit = grossProfit - gasCost.gasCostUsd;
    
    // Estimate price after trade (simplified)
    const priceAfterTrade = this.estimatePriceAfterTrade(currentPrice, flashloanAmount, ArbitrageScenario.CHEAP);
    
    return {
      scenario: ArbitrageScenario.CHEAP,
      timestamp: new Date(),
      currentPrice,
      targetPrice: 1.0,
      priceDeviation: ((currentPrice - 1.0) / 1.0) * 100,
      flashloanAmount,
      flashloanFee: this.config.flashloanFeeBps / 100,
      flashloanFeeAmount: flashloanFee,
      steps,
      oracleImpact,
      totalAmountIn: repaymentAmount,
      totalAmountOut: currentAmount,
      grossProfit,
      gasCost,
      netProfit,
      profitPercent: (netProfit / flashloanAmount) * 100,
      isProfitable: netProfit > this.config.minProfitUsd,
      recommendation: this.generateRecommendation(netProfit, currentPrice),
      priceAfterTrade,
      priceChange: priceAfterTrade - currentPrice,
      warnings: this.generateWarnings(oracleImpact, currentPrice, netProfit)
    };
  }

  /**
   * Get oracle impact details
   */
  private async getOracleImpact(): Promise<OracleImpact> {
    const oraclePrice = await this.oracleFetcher.getUsdcPrice();
    
    if (!oraclePrice.success || !oraclePrice.price) {
      throw new Error('Failed to fetch oracle price');
    }
    
    const price = oraclePrice.price;
    const deviationFromPeg = ((price - 1.0) / 1.0) * 100;
    const impactOnMint = price >= 1.0 ? 0 : (1.0 - price) * 100;
    const impactOnRedeem = price <= 1.0 ? 0 : ((price - 1.0) / price) * 100;
    const withinTolerance = this.oracleFetcher.isPriceWithinTolerance(price);
    
    return {
      oraclePrice: price,
      deviationFromPeg,
      impactOnMint,
      impactOnRedeem,
      withinTolerance,
      wouldRevert: !withinTolerance
    };
  }

  /**
   * Calculate gas cost
   */
  private async calculateGasCost(gasUnits: number): Promise<GasCost> {
    // Fetch current gas price from provider
    const gasPriceBigNumber = await this.signer.provider!.getGasPrice();
    const gasPriceGwei = Number(ethers.utils.formatUnits(gasPriceBigNumber, 'gwei'));
    
    // Calculate cost in ETH
    const gasCostWei = gasPriceBigNumber.mul(gasUnits);
    const gasCostEth = Number(ethers.utils.formatEther(gasCostWei));
    
    // Use provided ETH price or default to $2000
    const ethPriceUsd = this.config.ethPriceUsd || 2000;
    const gasCostUsd = gasCostEth * ethPriceUsd;
    
    return {
      gasUnits,
      gasPriceGwei,
      gasCostEth,
      gasCostUsd,
      ethPriceUsd
    };
  }

  /**
   * Estimate price after trade (simplified)
   */
  private estimatePriceAfterTrade(
    currentPrice: number,
    flashloanAmount: number,
    scenario: ArbitrageScenario
  ): number {
    // Simplified estimation: larger trades move price more
    // In RICH scenario, we sell crvUSD so price should decrease
    // This is a rough approximation - actual price depends on pool liquidity
    const priceImpact = (flashloanAmount / 100000) * 0.01; // ~0.01% per $1000
    
    if (scenario === ArbitrageScenario.RICH) {
      return currentPrice - priceImpact;
    } else {
      return currentPrice + priceImpact;
    }
  }

  /**
   * Generate recommendation
   */
  private generateRecommendation(netProfit: number, currentPrice: number): string {
    if (netProfit > this.config.minProfitUsd) {
      return `EXECUTE: Profitable arbitrage with $${netProfit.toFixed(2)} net profit`;
    } else if (netProfit > 0) {
      return `MARGINAL: Profitable but below minimum threshold ($${this.config.minProfitUsd})`;
    } else {
      return `DO NOT EXECUTE: Would lose $${Math.abs(netProfit).toFixed(2)}`;
    }
  }

  /**
   * Generate warnings
   */
  private generateWarnings(
    oracleImpact: OracleImpact,
    currentPrice: number,
    netProfit: number
  ): string[] {
    const warnings: string[] = [];
    
    if (!oracleImpact.withinTolerance) {
      warnings.push('Oracle price outside 1% tolerance - transaction will REVERT');
    }
    
    if (Math.abs(oracleImpact.deviationFromPeg) > 0.5) {
      warnings.push(`Oracle deviates ${oracleImpact.deviationFromPeg.toFixed(4)}% from peg - impacts profitability`);
    }
    
    if (currentPrice > 1.05 || currentPrice < 0.95) {
      warnings.push('Price severely off-peg - high slippage expected');
    }
    
    if (netProfit < 0) {
      warnings.push('Transaction would lose money');
    }
    
    return warnings;
  }

  /**
   * Convert human-readable amount to token decimals
   */
  private toTokenDecimals(amount: number, decimals: number): BigNumber {
    return ethers.utils.parseUnits(amount.toFixed(decimals), decimals);
  }

  /**
   * Convert token decimals to human-readable amount
   */
  private fromTokenDecimals(amount: BigNumber, decimals: number): number {
    return Number(ethers.utils.formatUnits(amount, decimals));
  }
}

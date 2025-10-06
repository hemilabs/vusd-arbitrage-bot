// src/price-monitor.ts
// Price Monitor - Continuously checks crvUSD/VUSD price for arbitrage opportunities
// Polls Curve pool every 60 seconds and detects when price deviates from $1 peg

import { CurveQuoteProvider } from './dex-providers/curve-quote-provider';
import { logger } from './utils/logger';

// Enum defining the two arbitrage scenarios
export enum ArbitrageScenario {
  RICH = 'RICH',   // crvUSD > VUSD (price > 1.01) - sell crvUSD
  CHEAP = 'CHEAP', // crvUSD < VUSD (price < 0.99) - buy crvUSD
  NONE = 'NONE'    // Near peg, no opportunity
}

// Data structure for arbitrage opportunities detected by price monitor
export interface ArbitrageOpportunity {
  scenario: ArbitrageScenario;
  price: number;              // Current crvUSD/VUSD price
  deviation: number;          // Absolute deviation from $1 peg (in percentage)
  timestamp: Date;
}

// Type for callback function when opportunity is detected
export type OpportunityCallback = (opportunity: ArbitrageOpportunity) => void;

/**
 * Price Monitor - Continuously monitors crvUSD/VUSD price on Curve
 * Detects arbitrage opportunities when price deviates significantly from $1 peg
 */
export class PriceMonitor {
  private curveProvider: CurveQuoteProvider;
  private checkIntervalMs: number;
  private richThreshold: number;     // Price above this triggers RICH scenario (e.g., 1.01)
  private cheapThreshold: number;    // Price below this triggers CHEAP scenario (e.g., 0.99)
  private isRunning: boolean = false;
  private intervalId?: NodeJS.Timeout;
  private onOpportunity?: OpportunityCallback;
  private lastScenario: ArbitrageScenario = ArbitrageScenario.NONE;
  
  constructor(
    curveProvider: CurveQuoteProvider,
    checkIntervalMs: number = 60000,  // Default: check every 60 seconds
    richThreshold: number = 1.01,     // Trigger when price > 1.01
    cheapThreshold: number = 0.99     // Trigger when price < 0.99
  ) {
    this.curveProvider = curveProvider;
    this.checkIntervalMs = checkIntervalMs;
    this.richThreshold = richThreshold;
    this.cheapThreshold = cheapThreshold;
  }

  /**
   * Set callback function to be called when arbitrage opportunity is detected
   * This allows the arbitrage executor to be notified of opportunities
   */
  public setOpportunityCallback(callback: OpportunityCallback): void {
    this.onOpportunity = callback;
  }

  /**
   * Start price monitoring loop
   * Checks price immediately, then continues checking at specified interval
   */
  public async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Price monitor is already running');
      return;
    }

    logger.info(
      `Starting price monitor | Interval: ${this.checkIntervalMs / 1000}s | Rich threshold: ${this.richThreshold} | Cheap threshold: ${this.cheapThreshold}`
    );

    this.isRunning = true;

    // Perform first check immediately
    await this.checkPrice();

    // Set up interval to check price repeatedly
    this.intervalId = setInterval(async () => {
      await this.checkPrice();
    }, this.checkIntervalMs);

    logger.info('Price monitor started successfully');
  }

  /**
   * Stop price monitoring loop
   * Clears the interval timer
   */
  public stop(): void {
    if (!this.isRunning) {
      logger.warn('Price monitor is not running');
      return;
    }

    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }

    this.isRunning = false;
    logger.info('Price monitor stopped');
  }

  /**
   * Check current price and detect arbitrage opportunities
   * Called by the monitoring loop at regular intervals
   * 
   * Logic:
   * 1. Query Curve pool for current crvUSD/VUSD price
   * 2. Calculate deviation from $1 peg
   * 3. Determine if price indicates arbitrage opportunity
   * 4. If opportunity detected and scenario changed, notify callback
   */
  private async checkPrice(): Promise<void> {
    try {
      // Query Curve pool for current crvUSD/VUSD exchange rate
      const priceResult = await this.curveProvider.getCrvusdVusdPrice();

      if (!priceResult.success || priceResult.price === undefined) {
        logger.error(`Failed to fetch price from Curve: ${priceResult.error || 'Unknown error'}`);
        return;
      }

      const price = priceResult.price;
      
      // Calculate absolute deviation from $1 peg (as percentage)
      const deviation = Math.abs(price - 1.0);
      const deviationPercent = deviation * 100;

      // Determine which scenario (if any) this price indicates
      const scenario = this.determineScenario(price);

      // Log current price status with explicit values in message
      logger.info(
        `Price check: ${price.toFixed(6)} | Deviation: ${deviationPercent.toFixed(4)}% | Scenario: ${scenario}`
      );

      // If scenario changed (e.g., from NONE to RICH), create opportunity and notify callback
      if (scenario !== ArbitrageScenario.NONE && scenario !== this.lastScenario) {
        const opportunity: ArbitrageOpportunity = {
          scenario,
          price,
          deviation: deviationPercent,
          timestamp: new Date()
        };

        logger.info(
          `Arbitrage opportunity detected! Scenario: ${scenario} | Price: ${price.toFixed(6)} | Deviation: ${deviationPercent.toFixed(4)}%`
        );

        // Notify callback if registered
        if (this.onOpportunity) {
          this.onOpportunity(opportunity);
        }
      }

      // Update last scenario to track changes
      this.lastScenario = scenario;

    } catch (error: any) {
      // Don't stop monitoring on errors, just log and continue
      logger.error(`Error during price check: ${error.message}`);
    }
  }

  /**
   * Determine arbitrage scenario based on current price
   * 
   * @param price - Current crvUSD/VUSD price
   * @returns ArbitrageScenario indicating what action (if any) to take
   * 
   * RICH: crvUSD is expensive relative to VUSD (price > 1.01)
   *       Strategy: Sell crvUSD for VUSD, profit from premium
   * 
   * CHEAP: crvUSD is cheap relative to VUSD (price < 0.99)
   *        Strategy: Buy crvUSD with VUSD, profit from discount
   * 
   * NONE: Price is near peg (0.99 <= price <= 1.01)
   *       No arbitrage opportunity
   */
  private determineScenario(price: number): ArbitrageScenario {
    if (price > this.richThreshold) {
      return ArbitrageScenario.RICH;
    } else if (price < this.cheapThreshold) {
      return ArbitrageScenario.CHEAP;
    } else {
      return ArbitrageScenario.NONE;
    }
  }

  /**
   * Check if monitor is currently running
   */
  public isMonitoring(): boolean {
    return this.isRunning;
  }

  /**
   * Get current configuration
   */
  public getConfig() {
    return {
      checkIntervalMs: this.checkIntervalMs,
      richThreshold: this.richThreshold,
      cheapThreshold: this.cheapThreshold,
      isRunning: this.isRunning
    };
  }
}

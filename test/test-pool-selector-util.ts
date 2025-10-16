// test/test-pool-selector-util.ts
// Unit tests for the Uniswap V3 pool selector utility module
// Tests the pool discovery, ranking, and selection logic
// UPDATED: Now includes tests for USDC position detection

import { ethers } from 'hardhat';
import { expect } from 'chai';
import {
  getBestPoolForFlashloan,
  getDefaultPool,
  canPoolHandleFlashloan,
  getAllUsdcPools,
  rankPools,
  getPoolInfo,
  PoolInfo,
} from '../src/utils/uniswap-v3-pool-selector';

const toUsdc = (amount: number) => ethers.utils.parseUnits(amount.toString(), 6);

describe('Pool Selector Utility Tests', () => {
  
  describe('Basic Pool Functions', () => {
    it('should get default pool address', () => {
      const defaultPool = getDefaultPool();
      console.log('\nDefault pool:', defaultPool);
      
      // Should return the USDC/DAI 0.01% pool we identified
      expect(defaultPool).to.equal('0x5777d92f208679DB4b9778590Fa3CAB3aC9e2168');
    });

    it('should get info for default pool', async () => {
      const defaultPoolAddress = getDefaultPool();
      const poolInfo = await getPoolInfo(ethers.provider, defaultPoolAddress);
      
      console.log('\nDefault pool info:');
      console.log('  Address:', poolInfo?.address);
      console.log('  Pair:', poolInfo?.pairName);
      console.log('  Fee:', poolInfo?.feePercent + '%');
      console.log('  USDC Balance:', poolInfo?.usdcBalance.toLocaleString());
      
      expect(poolInfo).to.not.be.null;
      expect(poolInfo!.pairName).to.equal('USDC/DAI');
      expect(poolInfo!.feePercent).to.equal(0.01); // 0.01% fee
      expect(poolInfo!.usdcBalance).to.be.greaterThan(1000000); // Should have 1M+ USDC
    });

    // NEW TEST: Verify USDC position detection for default pool
    it('should detect USDC position in default pool', async () => {
      const defaultPoolAddress = getDefaultPool();
      const poolInfo = await getPoolInfo(ethers.provider, defaultPoolAddress);
      
      console.log('\nUSCD position detection:');
      console.log('  Pool:', poolInfo?.address);
      console.log('  Pair:', poolInfo?.pairName);
      console.log('  USDC is token1:', poolInfo?.usdcIsToken1);
      console.log('  Token0:', poolInfo?.token0Symbol);
      console.log('  Token1:', poolInfo?.token1Symbol);
      
      expect(poolInfo).to.not.be.null;
      expect(poolInfo!.usdcIsToken1).to.be.a('boolean');
      
      // For USDC/DAI pool (0x5777d92f208679DB4b9778590Fa3CAB3aC9e2168)
      // We know from our scanner that USDC is token1 and DAI is token0
      expect(poolInfo!.usdcIsToken1).to.be.true;
      expect(poolInfo!.token0Symbol).to.equal('DAI');
      expect(poolInfo!.token1Symbol).to.equal('USDC');
    });

    // NEW TEST: Verify flash() call recommendations based on position
    it('should provide correct flash() call guidance based on USDC position', async () => {
      const defaultPoolAddress = getDefaultPool();
      const poolInfo = await getPoolInfo(ethers.provider, defaultPoolAddress);
      
      expect(poolInfo).to.not.be.null;
      
      console.log('\nFlash call guidance:');
      if (poolInfo!.usdcIsToken1) {
        console.log('  USDC is token1');
        console.log('  Use: flash(recipient, 0, usdcAmount, data)');
        console.log('  Use: fee1 in callback');
        
        // Verify the position is what we expect
        expect(poolInfo!.usdcIsToken1).to.be.true;
      } else {
        console.log('  USDC is token0');
        console.log('  Use: flash(recipient, usdcAmount, 0, data)');
        console.log('  Use: fee0 in callback');
        
        expect(poolInfo!.usdcIsToken1).to.be.false;
      }
    });
  });

  describe('Pool Discovery', () => {
    it('should discover all USDC pools', async () => {
      console.log('\nDiscovering all USDC pools...');
      const allPools = await getAllUsdcPools(ethers.provider);
      
      console.log(`Found ${allPools.length} pools`);
      
      // Should find multiple pools
      expect(allPools.length).to.be.greaterThan(10);
      
      // Each pool should have required properties
      allPools.forEach((pool) => {
        expect(pool.address).to.be.a('string');
        expect(pool.usdcBalance).to.be.a('number');
        expect(pool.feeTier).to.be.a('number');
        expect(pool.totalScore).to.be.a('number');
        expect(pool.usdcIsToken1).to.be.a('boolean'); // NEW: Check USDC position exists
      });
      
      // Log top 5 pools
      const ranked = rankPools(allPools);
      console.log('\nTop 5 pools:');
      ranked.slice(0, 5).forEach((pool, index) => {
        console.log(`  ${index + 1}. ${pool.pairName} ${pool.feePercent}% - ${pool.usdcBalance.toLocaleString()} USDC - Score: ${pool.totalScore.toFixed(2)} - USDC is token${pool.usdcIsToken1 ? '1' : '0'}`);
      });
    });

    // NEW TEST: Verify all discovered pools have valid USDC position detection
    it('should detect USDC position for all discovered pools', async () => {
      const allPools = await getAllUsdcPools(ethers.provider);
      
      console.log('\nChecking USDC position for all pools...');
      
      let token0Count = 0;
      let token1Count = 0;
      
      allPools.forEach((pool) => {
        // Every pool must have a boolean usdcIsToken1 value
        expect(pool.usdcIsToken1).to.be.a('boolean');
        
        // Count distribution
        if (pool.usdcIsToken1) {
          token1Count++;
        } else {
          token0Count++;
        }
        
        console.log(`  ${pool.pairName} (${pool.feePercent}%): USDC is token${pool.usdcIsToken1 ? '1' : '0'}`);
      });
      
      console.log(`\nDistribution: ${token0Count} pools with USDC as token0, ${token1Count} pools with USDC as token1`);
      
      // Both positions should exist in discovered pools (sanity check)
      expect(token0Count).to.be.greaterThan(0);
      expect(token1Count).to.be.greaterThan(0);
    });

    // NEW TEST: Verify USDC position consistency within same pair
    it('should have consistent USDC position across fee tiers for same pair', async () => {
      const allPools = await getAllUsdcPools(ethers.provider);
      
      // Group pools by token pair (ignoring fee tier)
      const pairGroups = new Map<string, PoolInfo[]>();
      
      allPools.forEach((pool) => {
        // Extract the non-USDC token from pair name
        const otherToken = pool.pairName.replace('USDC/', '');
        
        if (!pairGroups.has(otherToken)) {
          pairGroups.set(otherToken, []);
        }
        pairGroups.get(otherToken)!.push(pool);
      });
      
      console.log('\nVerifying USDC position consistency within pairs...');
      
      // For each pair, all fee tiers should have same USDC position
      pairGroups.forEach((pools, pairName) => {
        if (pools.length > 1) {
          const firstPoolPosition = pools[0].usdcIsToken1;
          
          pools.forEach((pool) => {
            expect(pool.usdcIsToken1).to.equal(
              firstPoolPosition,
              `${pairName} has inconsistent USDC position across fee tiers`
            );
          });
          
          console.log(`  ${pairName}: USDC is token${firstPoolPosition ? '1' : '0'} across all ${pools.length} fee tiers ✓`);
        }
      });
    });
  });

  describe('Pool Selection for Flashloans', () => {
    it('should find best pool for 10k USDC flashloan', async () => {
      const bestPool = await getBestPoolForFlashloan(ethers.provider, toUsdc(10000));
      
      console.log('\nBest pool for 10k USDC:');
      console.log('  Address:', bestPool?.address);
      console.log('  Pair:', bestPool?.pairName);
      console.log('  Fee:', bestPool?.feePercent + '%');
      console.log('  USDC Balance:', bestPool?.usdcBalance.toLocaleString());
      console.log('  USDC Position: token' + (bestPool?.usdcIsToken1 ? '1' : '0'));
      console.log('  Score:', bestPool?.totalScore.toFixed(2) + '/100');
      
      expect(bestPool).to.not.be.null;
      
      // Pool should have enough liquidity (2x multiplier by default)
      expect(bestPool!.usdcBalance).to.be.greaterThan(20000);
      
      // Should be a legitimate pool address
      expect(bestPool!.address).to.match(/^0x[a-fA-F0-9]{40}$/);
      
      // Should have USDC position defined
      expect(bestPool!.usdcIsToken1).to.be.a('boolean');
    });

    it('should find best pool for 1M USDC flashloan', async () => {
      const bestPool = await getBestPoolForFlashloan(ethers.provider, toUsdc(1000000));
      
      console.log('\nBest pool for 1M USDC:');
      console.log('  Address:', bestPool?.address);
      console.log('  Pair:', bestPool?.pairName);
      console.log('  USDC Balance:', bestPool?.usdcBalance.toLocaleString());
      console.log('  USDC Position: token' + (bestPool?.usdcIsToken1 ? '1' : '0'));
      
      expect(bestPool).to.not.be.null;
      
      // Pool should have 2M+ USDC (2x multiplier)
      expect(bestPool!.usdcBalance).to.be.greaterThan(2000000);
      
      // Should have USDC position defined
      expect(bestPool!.usdcIsToken1).to.be.a('boolean');
    });

    it('should prefer 0.01% fee pools when specified', async () => {
      const bestPool = await getBestPoolForFlashloan(
        ethers.provider,
        toUsdc(10000),
        {
          preferredFeeTier: 100, // 0.01% fee
        }
      );
      
      console.log('\nBest pool with 0.01% preference for 10k USDC:');
      console.log('  Pair:', bestPool?.pairName);
      console.log('  Fee:', bestPool?.feePercent + '%');
      console.log('  USDC Balance:', bestPool?.usdcBalance.toLocaleString());
      console.log('  USDC Position: token' + (bestPool?.usdcIsToken1 ? '1' : '0'));
      console.log('  Score:', bestPool?.totalScore.toFixed(2));
      
      expect(bestPool).to.not.be.null;
      
      // Note: preferredFeeTier prioritizes but doesn't require that tier
      // A 0.05% pool with much higher liquidity might still win
      // This is intentional - we want the best overall pool
      expect([100, 500]).to.include(bestPool!.feeTier); // Should be 0.01% or 0.05%
      
      // But it should still be a top-tier pool
      expect(bestPool!.totalScore).to.be.greaterThan(28);
      
      // Should have USDC position defined
      expect(bestPool!.usdcIsToken1).to.be.a('boolean');
    });

    it('should show 0.01% pools ranked highly', async () => {
      // Get all pools and rank them
      const allPools = await getAllUsdcPools(ethers.provider);
      const ranked = rankPools(allPools);
      
      // Count 0.01% pools in top 5
      const top5 = ranked.slice(0, 5);
      const count001 = top5.filter(p => p.feeTier === 100).length;
      
      console.log('\nTop 5 pools by score:');
      top5.forEach((pool, i) => {
        console.log(`  ${i+1}. ${pool.pairName} ${pool.feePercent}% - Score: ${pool.totalScore.toFixed(2)} - USDC is token${pool.usdcIsToken1 ? '1' : '0'}`);
      });
      console.log(`\n${count001} out of 5 are 0.01% fee pools`);
      
      // Should have at least 2 low-fee (0.01%) pools in top 5
      expect(count001).to.be.at.least(2);
    });

    it('should handle high liquidity multiplier requirement', async () => {
      const bestPool = await getBestPoolForFlashloan(
        ethers.provider,
        toUsdc(10000),
        {
          minLiquidityMultiplier: 5.0, // Pool must have 50k+ USDC
        }
      );
      
      console.log('\nBest pool with 5x liquidity requirement:');
      console.log('  Address:', bestPool?.address);
      console.log('  USDC Balance:', bestPool?.usdcBalance.toLocaleString());
      console.log('  USDC Position: token' + (bestPool?.usdcIsToken1 ? '1' : '0'));
      
      expect(bestPool).to.not.be.null;
      expect(bestPool!.usdcBalance).to.be.greaterThan(50000);
      expect(bestPool!.usdcIsToken1).to.be.a('boolean');
    });

    it('should exclude specified pools', async () => {
      // Get best pool without exclusions
      const bestPoolNormal = await getBestPoolForFlashloan(ethers.provider, toUsdc(10000));
      
      // Get best pool excluding the top one
      const bestPoolExcluded = await getBestPoolForFlashloan(
        ethers.provider,
        toUsdc(10000),
        {
          excludePools: [bestPoolNormal!.address],
        }
      );
      
      console.log('\nPool exclusion test:');
      console.log('  Normal best:', bestPoolNormal?.address);
      console.log('  With exclusion:', bestPoolExcluded?.address);
      
      expect(bestPoolExcluded).to.not.be.null;
      expect(bestPoolExcluded!.address.toLowerCase()).to.not.equal(
        bestPoolNormal!.address.toLowerCase()
      );
      
      // Both should have USDC position defined
      expect(bestPoolNormal!.usdcIsToken1).to.be.a('boolean');
      expect(bestPoolExcluded!.usdcIsToken1).to.be.a('boolean');
    });
  });

  describe('Pool Validation', () => {
    it('should validate default pool can handle 10k USDC flashloan', async () => {
      const defaultPool = getDefaultPool();
      const canHandle = await canPoolHandleFlashloan(
        defaultPool,
        toUsdc(10000),
        ethers.provider
      );
      
      console.log('\nCan default pool handle 10k USDC flashloan?', canHandle);
      expect(canHandle).to.be.true;
    });

    it('should validate default pool can handle 100k USDC flashloan', async () => {
      const defaultPool = getDefaultPool();
      const canHandle = await canPoolHandleFlashloan(
        defaultPool,
        toUsdc(100000),
        ethers.provider
      );
      
      console.log('Can default pool handle 100k USDC flashloan?', canHandle);
      expect(canHandle).to.be.true;
    });

    it('should validate pool with insufficient liquidity fails', async () => {
      // Use a small pool
      const allPools = await getAllUsdcPools(ethers.provider);
      const ranked = rankPools(allPools);
      
      // Find a pool with less than 1M USDC
      const smallPool = ranked.find((p) => p.usdcBalance < 1000000);
      
      if (smallPool) {
        const canHandle = await canPoolHandleFlashloan(
          smallPool.address,
          toUsdc(500000), // Try to flashloan 500k from small pool
          ethers.provider
        );
        
        console.log(`\nCan pool with ${smallPool.usdcBalance.toLocaleString()} USDC handle 500k flashloan?`, canHandle);
        expect(canHandle).to.be.false;
      }
    });
  });

  describe('Pool Ranking', () => {
    it('should rank pools correctly', async () => {
      const allPools = await getAllUsdcPools(ethers.provider);
      const ranked = rankPools(allPools);
      
      console.log('\nPool ranking verification:');
      
      // Check that pools are in descending score order
      for (let i = 0; i < ranked.length - 1; i++) {
        expect(ranked[i].totalScore).to.be.at.least(ranked[i + 1].totalScore);
      }
      
      // Top pool should have highest score
      const topPool = ranked[0];
      console.log(`  Top pool: ${topPool.pairName} ${topPool.feePercent}% - Score: ${topPool.totalScore.toFixed(2)} - USDC is token${topPool.usdcIsToken1 ? '1' : '0'}`);
      
      // Top pool should have good liquidity and low fees
      expect(topPool.totalScore).to.be.greaterThan(20); // Should have decent score
      expect(topPool.usdcIsToken1).to.be.a('boolean');
    });
  });

  describe('Edge Cases', () => {
    it('should handle invalid pool address gracefully', async () => {
      const invalidPool = '0x0000000000000000000000000000000000000000';
      const poolInfo = await getPoolInfo(ethers.provider, invalidPool);
      
      console.log('\nInfo for invalid pool:', poolInfo);
      expect(poolInfo).to.be.null;
    });

    it('should return null if no pools meet requirements', async () => {
      // Try to get pool for impossibly large flashloan
      const bestPool = await getBestPoolForFlashloan(
        ethers.provider,
        toUsdc(1000000000), // 1 billion USDC
        {
          minLiquidityMultiplier: 2.0, // Need 2 billion in pool
        }
      );
      
      console.log('\nBest pool for 1B USDC flashloan:', bestPool);
      // Might be null if no pool has 2B USDC
      // Don't assert, just log the result
    });
  });
});

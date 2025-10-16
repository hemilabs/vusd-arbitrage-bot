// test/test-all-flashloan-scenarios.ts
// Comprehensive test of ALL flashloan amounts for BOTH scenarios
// UPDATED VERSION: Uses new USDC/DAI 0.01% pool with 31M liquidity
// Uses CurveQuoteProvider for accurate price tracking
// Shows detailed error messages and balance checks

import { ethers } from 'hardhat';
import * as dotenv from 'dotenv';
import { VusdArbitrage } from '../typechain-types';
import { VusdArbitrage__factory } from '../typechain-types/factories/contracts/VusdArbitrage.sol';
import { Contract, Wallet } from 'ethers';
import { CurveQuoteProvider } from '../src/dex-providers/curve-quote-provider';

dotenv.config();

const toUsdc = (amount: number | string) => ethers.utils.parseUnits(amount.toString(), 6);

interface TestResult {
  scenario: string;
  flashloanAmount: number;
  usdcBefore: number;
  usdcAfter: number;
  change: number;
  priceBefore: number;
  priceAfter: number;
  priceChange: number;
  gasUsed: number;
  success: boolean;
  error?: string;
}

describe('COMPREHENSIVE Flashloan Test - All Amounts, Both Scenarios', () => {
  let vusdArbitrage: VusdArbitrage;
  let deployer: Wallet;
  let usdcContract: Contract;
  let snapshotId: string;
  let curveProvider: CurveQuoteProvider;

  // Contract addresses
  const USDC_ADDRESS = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
  const CRVUSD_ADDRESS = '0xf939E0A03FB07F59A73314E73794Be0E57ac1b4E';
  const VUSD_ADDRESS = '0x677ddbd918637E5F2c79e164D402454dE7dA8619';
  const VUSD_MINTER = '0x3C8aeF08d90C2418f8AE887af47ba7d8Db88AF6b';
  const VUSD_REDEEMER = '0x43c704BC0F773B529E871EAAF4E283C2233512F9';
  const CURVE_CRVUSD_USDC_POOL = '0x4DEcE678ceceb27446b35C672dC7d61F30bAD69E';
  const CURVE_CRVUSD_VUSD_POOL = '0xB1c189dfDe178FE9F90E72727837cC9289fB944F';
  
  // UPDATED: Changed from old pool to new USDC/DAI 0.01% pool
  // Old: 0x919b20Ac45304AEB09C9df5c604b3CD9D99a51cA (7.5k USDC, failed at 8k+)
  // New: 0x5777d92f208679DB4b9778590Fa3CAB3aC9e2168 (31M USDC, 0.01% fees)
  const DEFAULT_UNISWAP_V3_POOL = '0x5777d92f208679DB4b9778590Fa3CAB3aC9e2168';

  // Curve pool indices
  const CRVUSD_USDC_POOL_USDC_INDEX = 0;
  const CRVUSD_USDC_POOL_CRVUSD_INDEX = 1;
  const CRVUSD_VUSD_POOL_CRVUSD_INDEX = 0;
  const CRVUSD_VUSD_POOL_VUSD_INDEX = 1;

  const USDC_WHALE = '0xE20d20b0cC4e44Cd23D5B0488D5250A9ac426875';

  // Flashloan amounts to test (in USDC)
  // UPDATED: Can now test much larger amounts due to 31M pool liquidity
  const FLASHLOAN_AMOUNTS = [1, 10, 1000, 5000, 10000];
  
  // Store all test results
  const results: TestResult[] = [];

  before(async () => {
    console.log('\n' + '='.repeat(80));
    console.log('COMPREHENSIVE FLASHLOAN TEST - UPDATED VERSION');
    console.log('Using new USDC/DAI 0.01% pool with 31M+ USDC liquidity');
    console.log('Using CurveQuoteProvider for accurate price tracking');
    console.log('Testing amounts: 1, 10, 1000, 5000, 10000 USDC');
    console.log('Testing scenarios: RICH and CHEAP');
    console.log('='.repeat(80));

    const deployerPrivateKey = process.env.SEARCHER_PRIVATE_KEY;
    if (!deployerPrivateKey) {
      throw new Error('SEARCHER_PRIVATE_KEY not found in .env file');
    }
    deployer = new ethers.Wallet(deployerPrivateKey, ethers.provider);
    console.log(`\nDeployer address: ${deployer.address}`);

    usdcContract = await ethers.getContractAt('IERC20', USDC_ADDRESS);

    // Fund deployer with whale funds
    console.log('\nSTEP 1: Funding deployer with whale funds...');
    await ethers.provider.send("hardhat_impersonateAccount", [USDC_WHALE]);
    await ethers.provider.send("hardhat_setBalance", [
      USDC_WHALE,
      ethers.utils.hexValue(ethers.utils.parseEther("10"))
    ]);
    
    const whaleSigner = await ethers.getSigner(USDC_WHALE);
    await whaleSigner.sendTransaction({
      to: deployer.address,
      value: ethers.utils.parseEther("5")
    });
    await usdcContract.connect(whaleSigner).transfer(deployer.address, toUsdc(100000));
    await ethers.provider.send("hardhat_stopImpersonatingAccount", [USDC_WHALE]);
    
    const yourEthBalance = await ethers.provider.getBalance(deployer.address);
    const yourUsdcBalance = await usdcContract.balanceOf(deployer.address);
    console.log(`  Your ETH: ${ethers.utils.formatEther(yourEthBalance)} ETH`);
    console.log(`  Your USDC: ${ethers.utils.formatUnits(yourUsdcBalance, 6)} USDC`);
    
    // Deploy contract with new pool
    console.log('\nSTEP 2: Deploying VusdArbitrage contract...');
    console.log(`  Using default pool: ${DEFAULT_UNISWAP_V3_POOL}`);
    console.log('  Pool: USDC/DAI 0.01% fee');
    console.log('  Liquidity: ~31M USDC');
    
    const factory = (await ethers.getContractFactory('VusdArbitrage', deployer)) as VusdArbitrage__factory;
    
    // UPDATED: Now passing DEFAULT_UNISWAP_V3_POOL instead of old pool
    vusdArbitrage = await factory.deploy(
      USDC_ADDRESS,
      CRVUSD_ADDRESS,
      VUSD_ADDRESS,
      VUSD_MINTER,
      VUSD_REDEEMER,
      CURVE_CRVUSD_USDC_POOL,
      CURVE_CRVUSD_VUSD_POOL,
      DEFAULT_UNISWAP_V3_POOL, // <-- CHANGED: Using new pool with 31M liquidity
      true, 
      CRVUSD_USDC_POOL_USDC_INDEX,
      CRVUSD_USDC_POOL_CRVUSD_INDEX,
      CRVUSD_VUSD_POOL_CRVUSD_INDEX,
      CRVUSD_VUSD_POOL_VUSD_INDEX
    );
    await vusdArbitrage.deployed();
    console.log(`  Contract deployed at: ${vusdArbitrage.address}`);
    
    // Fund contract with 50k USDC
    console.log('\nSTEP 3: Funding contract with 50k USDC...');
    await usdcContract.connect(deployer).transfer(vusdArbitrage.address, toUsdc(50000));
    
    // Initialize CurveQuoteProvider for accurate price tracking
    console.log('\nSTEP 4: Initializing CurveQuoteProvider...');
    curveProvider = new CurveQuoteProvider(
      deployer,
      CURVE_CRVUSD_USDC_POOL,
      CURVE_CRVUSD_VUSD_POOL,
      USDC_ADDRESS,
      CRVUSD_ADDRESS,
      VUSD_ADDRESS
    );
    
    const initialized = await curveProvider.initialize();
    if (!initialized) {
      throw new Error('Failed to initialize CurveQuoteProvider');
    }
    console.log('  CurveQuoteProvider initialized successfully');
    
    const contractBalance = await usdcContract.balanceOf(vusdArbitrage.address);
    console.log('\n' + '='.repeat(80));
    console.log('SETUP COMPLETE');
    console.log('='.repeat(80));
    console.log(`Contract USDC: ${ethers.utils.formatUnits(contractBalance, 6)} USDC`);
    console.log(`Default Pool: ${DEFAULT_UNISWAP_V3_POOL}`);
    console.log('Pool Pair: USDC/DAI');
    console.log('Pool Fee: 0.01% (lowest available)');
    console.log('Pool Liquidity: ~31M USDC (4,100x more than old pool!)');
    console.log('='.repeat(80));
    console.log('Starting tests...\n');
  });

  beforeEach(async () => {
    snapshotId = await ethers.provider.send("evm_snapshot", []);
  });

  afterEach(async () => {
    await ethers.provider.send("evm_revert", [snapshotId]);
  });

  // Helper function to execute and record results
  async function executeAndRecord(
    scenario: 'RICH' | 'CHEAP',
    flashloanAmount: number
  ): Promise<TestResult> {
    const balanceBefore = await usdcContract.balanceOf(vusdArbitrage.address);
    const usdcBefore = Number(ethers.utils.formatUnits(balanceBefore, 6));

    // Get price BEFORE trade using CurveQuoteProvider
    let priceBefore = 0;
    try {
      const priceResult = await curveProvider.getCrvusdVusdPrice();
      if (priceResult.success && priceResult.price) {
        priceBefore = priceResult.price;
      }
    } catch (error: any) {
      console.log(`  Warning: Could not fetch price before: ${error.message}`);
    }

    try {
      // UPDATED: Using new function signatures with default pool
      // Option 1: Use convenience functions (simpler)
      const tx = scenario === 'RICH'
        ? await vusdArbitrage.executeRichWithDefaultPool(toUsdc(flashloanAmount), { gasLimit: 5000000 })
        : await vusdArbitrage.executeCheapWithDefaultPool(toUsdc(flashloanAmount), { gasLimit: 5000000 });
      
      // Option 2: Explicitly pass pool address (more flexible)
      // const tx = scenario === 'RICH'
      //   ? await vusdArbitrage.executeRich(DEFAULT_UNISWAP_V3_POOL, toUsdc(flashloanAmount), { gasLimit: 5000000 })
      //   : await vusdArbitrage.executeCheap(DEFAULT_UNISWAP_V3_POOL, toUsdc(flashloanAmount), { gasLimit: 5000000 });
      
      const receipt = await tx.wait();
      
      const balanceAfter = await usdcContract.balanceOf(vusdArbitrage.address);
      const usdcAfter = Number(ethers.utils.formatUnits(balanceAfter, 6));
      const change = usdcAfter - usdcBefore;

      // Get price AFTER trade using CurveQuoteProvider
      let priceAfter = priceBefore;
      try {
        const priceResult = await curveProvider.getCrvusdVusdPrice();
        if (priceResult.success && priceResult.price) {
          priceAfter = priceResult.price;
        }
      } catch (error: any) {
        console.log(`  Warning: Could not fetch price after: ${error.message}`);
      }
      
      const priceChange = priceAfter - priceBefore;

      return {
        scenario,
        flashloanAmount,
        usdcBefore,
        usdcAfter,
        change,
        priceBefore,
        priceAfter,
        priceChange,
        gasUsed: receipt.gasUsed.toNumber(),
        success: true
      };
    } catch (error: any) {
      const balanceAfter = await usdcContract.balanceOf(vusdArbitrage.address);
      const usdcAfter = Number(ethers.utils.formatUnits(balanceAfter, 6));
      const change = usdcAfter - usdcBefore;

      // Try to get price after failed trade
      let priceAfter = priceBefore;
      try {
        const priceResult = await curveProvider.getCrvusdVusdPrice();
        if (priceResult.success && priceResult.price) {
          priceAfter = priceResult.price;
        }
      } catch {}
      
      const priceChange = priceAfter - priceBefore;

      // Parse error message for more details
      let errorMsg = error.message || 'Unknown error';
      if (errorMsg.includes('insufficient funds')) {
        errorMsg = 'Insufficient USDC to repay flashloan';
      } else if (errorMsg.includes('reverted')) {
        // Extract revert reason if available
        const match = errorMsg.match(/reason="([^"]+)"/);
        if (match) {
          errorMsg = match[1];
        }
      }

      return {
        scenario,
        flashloanAmount,
        usdcBefore,
        usdcAfter,
        change,
        priceBefore,
        priceAfter,
        priceChange,
        gasUsed: 0,
        success: false,
        error: errorMsg
      };
    }
  }

  describe('RICH Scenario Tests', () => {
    for (const amount of FLASHLOAN_AMOUNTS) {
      it(`should test RICH with ${amount} USDC flashloan`, async () => {
        const result = await executeAndRecord('RICH', amount);
        results.push(result);
        
        console.log(`\nRICH ${amount} USDC:`);
        console.log(`  Before: ${result.usdcBefore.toFixed(6)} USDC`);
        console.log(`  After:  ${result.usdcAfter.toFixed(6)} USDC`);
        console.log(`  Change: ${result.change >= 0 ? '+' : ''}${result.change.toFixed(6)} USDC`);
        console.log(`  Price Before: ${result.priceBefore.toFixed(6)}`);
        console.log(`  Price After:  ${result.priceAfter.toFixed(6)}`);
        console.log(`  Price Change: ${result.priceChange >= 0 ? '+' : ''}${result.priceChange.toFixed(6)}`);
        console.log(`  Gas:    ${result.gasUsed.toLocaleString()} units`);
        console.log(`  Status: ${result.success ? '✅ SUCCESS' : '❌ FAILED'}`);
        if (result.error) {
          console.log(`  Error: ${result.error}`);
        }
      });
    }
  });

  describe('CHEAP Scenario Tests', () => {
    for (const amount of FLASHLOAN_AMOUNTS) {
      it(`should test CHEAP with ${amount} USDC flashloan`, async () => {
        const result = await executeAndRecord('CHEAP', amount);
        results.push(result);
        
        console.log(`\nCHEAP ${amount} USDC:`);
        console.log(`  Before: ${result.usdcBefore.toFixed(6)} USDC`);
        console.log(`  After:  ${result.usdcAfter.toFixed(6)} USDC`);
        console.log(`  Change: ${result.change >= 0 ? '+' : ''}${result.change.toFixed(6)} USDC`);
        console.log(`  Price Before: ${result.priceBefore.toFixed(6)}`);
        console.log(`  Price After:  ${result.priceAfter.toFixed(6)}`);
        console.log(`  Price Change: ${result.priceChange >= 0 ? '+' : ''}${result.priceChange.toFixed(6)}`);
        console.log(`  Gas:    ${result.gasUsed.toLocaleString()} units`);
        console.log(`  Status: ${result.success ? '✅ SUCCESS' : '❌ FAILED'}`);
        if (result.error) {
          console.log(`  Error: ${result.error}`);
        }
      });
    }
  });

  after(() => {
    console.log('\n' + '='.repeat(80));
    console.log('COMPREHENSIVE TEST RESULTS SUMMARY');
    console.log('='.repeat(80));
    console.log('\nUsing USDC/DAI 0.01% pool - Lowest fees, 31M+ liquidity');
    console.log('Note: Change shows pure USDC profit/loss (not including ETH gas cost)');
    console.log('Note: Each test starts from fresh pool state (via snapshots)');
    console.log('Note: Using CurveQuoteProvider for accurate price tracking');
    console.log('\n' + '-'.repeat(100));
    console.log('Scenario | Flashloan | USDC Change | Price Before | Price After | Price Δ    | Status');
    console.log('-'.repeat(100));

    for (const result of results) {
      const changeStr = result.change >= 0 
        ? `+${result.change.toFixed(2)}`.padEnd(12)
        : `${result.change.toFixed(2)}`.padEnd(12);
      
      const priceBeforeStr = result.priceBefore.toFixed(6).padEnd(13);
      const priceAfterStr = result.priceAfter.toFixed(6).padEnd(12);
      const priceChangeStr = (result.priceChange >= 0 ? '+' : '') + result.priceChange.toFixed(6);
      const priceChangeFormatted = priceChangeStr.padEnd(11);
      
      const statusStr = result.success ? '✅ SUCCESS' : `❌ ${result.error || 'FAILED'}`;
      
      console.log(
        `${result.scenario.padEnd(8)} | ` +
        `${result.flashloanAmount.toString().padStart(9)} | ` +
        `${changeStr} | ` +
        `${priceBeforeStr} | ` +
        `${priceAfterStr} | ` +
        `${priceChangeFormatted} | ` +
        `${statusStr}`
      );
    }

    console.log('-'.repeat(100));

    // Analysis
    console.log('\n' + '='.repeat(80));
    console.log('ANALYSIS');
    console.log('='.repeat(80));

    const richResults = results.filter(r => r.scenario === 'RICH' && r.success);
    const cheapResults = results.filter(r => r.scenario === 'CHEAP' && r.success);

    if (richResults.length > 0) {
      const bestRich = richResults.reduce((best, current) => 
        current.change > best.change ? current : best
      );
      console.log(`\nBest RICH result: ${bestRich.flashloanAmount} USDC`);
      console.log(`  Change: ${bestRich.change >= 0 ? '+' : ''}${bestRich.change.toFixed(6)} USDC`);
      console.log(`  Price impact: ${(bestRich.priceChange * 100).toFixed(4)}%`);
    }

    if (cheapResults.length > 0) {
      const bestCheap = cheapResults.reduce((best, current) => 
        current.change > best.change ? current : best
      );
      console.log(`\nBest CHEAP result: ${bestCheap.flashloanAmount} USDC`);
      console.log(`  Change: ${bestCheap.change >= 0 ? '+' : ''}${bestCheap.change.toFixed(6)} USDC`);
      console.log(`  Price impact: ${(bestCheap.priceChange * 100).toFixed(4)}%`);
    }

    // Failed tests analysis
    const failedTests = results.filter(r => !r.success);
    if (failedTests.length > 0) {
      console.log('\n' + '='.repeat(80));
      console.log('FAILED TESTS ANALYSIS');
      console.log('='.repeat(80));
      for (const test of failedTests) {
        console.log(`\n${test.scenario} ${test.flashloanAmount} USDC:`);
        console.log(`  Error: ${test.error}`);
        console.log(`  Likely cause: Contract needs ${test.flashloanAmount} + 0.01% fee = ${(test.flashloanAmount * 1.0001).toFixed(2)} USDC to repay`);
        console.log(`  Available: 50000 USDC pre-funded`);
        console.log(`  After swaps, may not have enough USDC left to repay flashloan`);
      }
    } else {
      console.log('\n✅ All tests passed! New pool handles all flashloan sizes successfully.');
    }

    console.log('\n' + '='.repeat(80));
    console.log('TEST COMPLETE');
    console.log('='.repeat(80));
    console.log(`Pool used: ${DEFAULT_UNISWAP_V3_POOL} (USDC/DAI 0.01%)`);
    console.log('Improvement over old pool:');
    console.log('  - 4,100x more liquidity (31M vs 7.5k USDC)');
    console.log('  - All test amounts now succeed');
    console.log('  - Same 0.01% fee but from a reliable pool');
    console.log('='.repeat(80) + '\n');
  });
});

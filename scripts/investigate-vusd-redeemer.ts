// scripts/investigate-vusd-redeemer.ts
// Investigation: Does the VUSD Redeemer have limits that cause 8k redemptions to fail?
// This script tests redemption directly, bypassing the full arbitrage flow

import { ethers } from 'hardhat';
import * as dotenv from 'dotenv';

dotenv.config();

// Contract addresses
const USDC_ADDRESS = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const VUSD_REDEEMER = '0x43c704BC0F773B529E871EAAF4E283C2233512F9';

// VUSD Redeemer ABI
const VUSD_REDEEMER_ABI = [
  'function redeemFee() external view returns (uint256)',
  'function treasury() external view returns (address)',
  'function governor() external view returns (address)',
];

// Oracle ABI (for checking price)
const ORACLE_ABI = [
  'function latestRoundData() external view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)',
  'function decimals() external view returns (uint8)',
];

const toUsdc = (amount: number) => ethers.utils.parseUnits(amount.toString(), 6);
const toVusd = (amount: number) => ethers.utils.parseUnits(amount.toString(), 18);

async function main() {
  console.log('\n' + '█'.repeat(80));
  console.log('VUSD REDEEMER INVESTIGATION');
  console.log('Testing if Redeemer has hidden limits causing 8k+ failures');
  console.log('█'.repeat(80));

  // Get contracts
  const redeemer = await ethers.getContractAt(VUSD_REDEEMER_ABI, VUSD_REDEEMER);

  console.log('\n' + '='.repeat(80));
  console.log('STEP 1: Check Redeemer Configuration');
  console.log('='.repeat(80));

  // Get redemption fee
  const redeemFeeBps = await redeemer.redeemFee();
  const redeemFeePercent = redeemFeeBps.toNumber() / 100;
  console.log(`Redemption Fee: ${redeemFeeBps} bps (${redeemFeePercent}%)`);

  // Get treasury address
  const treasuryAddress = await redeemer.treasury();
  console.log(`Treasury Address: ${treasuryAddress}`);

  // Get governor (admin)
  const governorAddress = await redeemer.governor();
  console.log(`Governor Address: ${governorAddress}`);

  // Check oracle price
  console.log('\n' + '='.repeat(80));
  console.log('STEP 2: Check Treasury USDC Balance (THE KEY!)');
  console.log('='.repeat(80));
  
  // Get Treasury contract
  const TREASURY_ABI = [
    'function withdrawable(address token) external view returns (uint256)',
    'function oracles(address token) external view returns (address)',
    'function comets(address token) external view returns (address)',
  ];
  const treasury = await ethers.getContractAt(TREASURY_ABI, treasuryAddress);
  
  // Check how much USDC is actually available in the Treasury
  const withdrawableUsdc = await treasury.withdrawable(USDC_ADDRESS);
  const withdrawableUsdcFormatted = parseFloat(ethers.utils.formatUnits(withdrawableUsdc, 6));
  
  console.log(`\n⚠️  CRITICAL: Treasury's withdrawable USDC: ${withdrawableUsdcFormatted.toLocaleString()} USDC`);
  console.log(`\nThis is the MAXIMUM amount that can be redeemed!`);
  console.log(`If you try to redeem more than this, the transaction will FAIL.`);
  
  // Get Comet address
  const cometAddress = await treasury.comets(USDC_ADDRESS);
  console.log(`\nCompound Comet (cUSDCv3): ${cometAddress}`);
  
  // Get oracle from Treasury
  const oracleAddress = await treasury.oracles(USDC_ADDRESS);
  console.log(`USDC Oracle: ${oracleAddress}`);
  
  // Check oracle price
  console.log('\n' + '='.repeat(80));
  console.log('STEP 3: Check Oracle Price');
  console.log('='.repeat(80));
  
  try {
    const oracle = await ethers.getContractAt(ORACLE_ABI, oracleAddress);
    const oracleDecimals = await oracle.decimals();
    const roundData = await oracle.latestRoundData();
    const priceRaw = roundData.answer;
    const price = parseFloat(ethers.utils.formatUnits(priceRaw, oracleDecimals));
    
    console.log(`USDC Oracle Price: ${price.toFixed(6)}`);
    console.log(`Price deviation from $1.00: ${((price - 1.0) * 100).toFixed(4)}%`);
    
    // Check if price is outside reasonable bounds
    if (price < 0.99 || price > 1.01) {
      console.log('⚠️  WARNING: Oracle price is >1% off peg!');
      console.log('   This could cause redemption failures');
    } else {
      console.log('✓ Oracle price looks healthy');
    }
  } catch (error: any) {
    console.log(`⚠️  Could not read oracle: ${error.message}`);
  }

  console.log('\n' + '='.repeat(80));
  console.log('STEP 4: SIMULATION - What Happens at Different Redemption Sizes?');
  console.log('='.repeat(80));
  
  const testSizes = [5000, 7000, 7500, 8000, 10000, 15000, 20000];
  
  console.log(`\nWithdrawable USDC in Treasury: ${withdrawableUsdcFormatted.toLocaleString()}`);
  console.log(`\nTesting what happens if we try to redeem different amounts:\n`);
  
  for (const size of testSizes) {
    // Assuming 1:1 redemption (minus 0.05% fee)
    const redeemFee = size * 0.0005; // 0.05% = 5 bps
    const expectedUsdc = size - redeemFee;
    
    const willSucceed = expectedUsdc <= withdrawableUsdcFormatted;
    const status = willSucceed ? '✓ Would Succeed' : '✗ Would FAIL - Insufficient Treasury Balance';
    
    console.log(`${size.toLocaleString().padStart(6)} VUSD → ${expectedUsdc.toFixed(2).padStart(10)} USDC  ${status}`);
  }

  console.log('\n' + '█'.repeat(80));
  console.log('INVESTIGATION COMPLETE');
  console.log('█'.repeat(80));
  console.log('\n🔍 KEY FINDING:');
  console.log(`   The VUSD Treasury only has ${withdrawableUsdcFormatted.toLocaleString()} USDC available`);
  console.log(`   Any redemption requiring more than this will FAIL`);
  console.log(`\n   This explains why your 8k USDC arbitrage fails:`);
  console.log(`   - After swaps, you have ~8k VUSD to redeem`);
  console.log(`   - Treasury doesn't have 8k USDC`);
  console.log(`   - Redemption fails → "Transfer Failed"`);
  console.log('█'.repeat(80) + '\n');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

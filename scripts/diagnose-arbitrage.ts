// scripts/diagnose-arbitrage.ts
// Diagnostic script to check why arbitrage failed on mainnet
// Simulates each step and shows where the loss occurs
// File location: scripts/diagnose-arbitrage.ts

import { ethers } from 'hardhat';
import * as dotenv from 'dotenv';

dotenv.config();

// ABIs
const CURVE_POOL_ABI = [
  'function get_dy(int128 i, int128 j, uint256 dx) external view returns (uint256)',
  'function coins(uint256 i) external view returns (address)',
  'function balances(uint256 i) external view returns (uint256)',
];

const CHAINLINK_ABI = [
  'function latestRoundData() external view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)',
  'function decimals() external view returns (uint8)',
];

const VUSD_MINTER_ABI = [
  'function mintingFee() external view returns (uint256)',
];

const VUSD_REDEEMER_ABI = [
  'function redeemFee() external view returns (uint256)',
];

const ERC20_ABI = [
  'function decimals() external view returns (uint8)',
  'function symbol() external view returns (string)',
];

// Addresses
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const CRVUSD = '0xf939E0A03FB07F59A73314E73794Be0E57ac1b4E';
const VUSD = '0x677ddbd918637E5F2c79e164D402454dE7dA8619';
const CURVE_CRVUSD_USDC_POOL = '0x4DEcE678ceceb27446b35C672dC7d61F30bAD69E';
const CURVE_CRVUSD_VUSD_POOL = '0xB1c189dfDe178FE9F90E72727837cC9289fB944F';
const VUSD_MINTER = '0x3C8aeF08d90C2418f8AE887af47ba7d8Db88AF6b';
const VUSD_REDEEMER = '0x43c704BC0F773B529E871EAAF4E283C2233512F9';
const CHAINLINK_USDC_USD = '0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6';
const UNISWAP_V3_POOL = '0x5777d92f208679DB4b9778590Fa3CAB3aC9e2168';

// Curve pool indices
const USDC_INDEX = 0;
const CRVUSD_INDEX_IN_USDC_POOL = 1;
const CRVUSD_INDEX_IN_VUSD_POOL = 0;
const VUSD_INDEX = 1;

// Helper functions
function formatUsdc(amount: ethers.BigNumber): string {
  return ethers.utils.formatUnits(amount, 6);
}

function formatToken(amount: ethers.BigNumber, decimals: number): string {
  return ethers.utils.formatUnits(amount, decimals);
}

function formatPercent(value: number): string {
  return (value * 100).toFixed(4) + '%';
}

async function main() {
  console.log('========================================');
  console.log('ARBITRAGE DIAGNOSTIC TOOL');
  console.log('========================================');
  console.log('Analyzing why mainnet arbitrage failed\n');

  const provider = ethers.provider;

  // Get current block
  const blockNumber = await provider.getBlockNumber();
  console.log(`Current Block: ${blockNumber}`);
  console.log(`Network: ${(await provider.getNetwork()).name}\n`);

  // ========================================
  // STEP 1: Check Oracle Price
  // ========================================
  console.log('STEP 1: Checking Chainlink Oracle (USDC/USD)');
  console.log('='.repeat(80));

  const oracleContract = new ethers.Contract(CHAINLINK_USDC_USD, CHAINLINK_ABI, provider);
  
  const latestRound = await oracleContract.latestRoundData();
  const oracleDecimals = await oracleContract.decimals();
  const oraclePrice = parseFloat(ethers.utils.formatUnits(latestRound.answer, oracleDecimals));
  
  const updatedAt = new Date(latestRound.updatedAt.toNumber() * 1000);
  const now = new Date();
  const ageMinutes = Math.floor((now.getTime() - updatedAt.getTime()) / 60000);
  
  console.log(`Oracle Price: $${oraclePrice.toFixed(6)}`);
  console.log(`Last Updated: ${updatedAt.toISOString()} (${ageMinutes} minutes ago)`);
  console.log(`Round ID: ${latestRound.roundId.toString()}`);
  
  // Check if within tolerance (1%)
  const withinTolerance = oraclePrice >= 0.99 && oraclePrice <= 1.01;
  console.log(`Within 1% Tolerance: ${withinTolerance ? 'YES' : 'NO'}`);
  
  if (!withinTolerance) {
    console.log('⚠️  WARNING: Oracle price outside 1% tolerance - transactions will REVERT!');
  }
  
  const deviationFromPeg = ((oraclePrice - 1.0) / 1.0) * 100;
  console.log(`Deviation from $1.00: ${deviationFromPeg.toFixed(4)}%\n`);

  // ========================================
  // STEP 2: Check Curve Pool States
  // ========================================
  console.log('STEP 2: Checking Curve Pool Liquidity');
  console.log('='.repeat(80));

  // crvUSD/USDC Pool
  const crvusdUsdcPool = new ethers.Contract(CURVE_CRVUSD_USDC_POOL, CURVE_POOL_ABI, provider);
  const usdcBalance = await crvusdUsdcPool.balances(USDC_INDEX);
  const crvusdBalance1 = await crvusdUsdcPool.balances(CRVUSD_INDEX_IN_USDC_POOL);
  
  console.log('crvUSD/USDC Pool:');
  console.log(`   USDC Balance: ${formatUsdc(usdcBalance)} USDC`);
  console.log(`   crvUSD Balance: ${formatToken(crvusdBalance1, 18)} crvUSD`);
  
  // crvUSD/VUSD Pool
  const crvusdVusdPool = new ethers.Contract(CURVE_CRVUSD_VUSD_POOL, CURVE_POOL_ABI, provider);
  const crvusdBalance2 = await crvusdVusdPool.balances(CRVUSD_INDEX_IN_VUSD_POOL);
  const vusdBalance = await crvusdVusdPool.balances(VUSD_INDEX);
  
  console.log('\ncrvUSD/VUSD Pool:');
  console.log(`   crvUSD Balance: ${formatToken(crvusdBalance2, 18)} crvUSD`);
  console.log(`   VUSD Balance: ${formatToken(vusdBalance, 18)} VUSD\n`);

  // ========================================
  // STEP 3: Check Fees
  // ========================================
  console.log('STEP 3: Checking Protocol Fees');
  console.log('='.repeat(80));

  const minterContract = new ethers.Contract(VUSD_MINTER, VUSD_MINTER_ABI, provider);
  const redeemerContract = new ethers.Contract(VUSD_REDEEMER, VUSD_REDEEMER_ABI, provider);
  
  const mintFee = await minterContract.mintingFee();
  const redeemFee = await redeemerContract.redeemFee();
  
  const mintFeeBps = mintFee.toNumber();
  const redeemFeeBps = redeemFee.toNumber();
  
  console.log(`VUSD Mint Fee: ${mintFeeBps} bps (${(mintFeeBps / 100).toFixed(2)}%)`);
  console.log(`VUSD Redeem Fee: ${redeemFeeBps} bps (${(redeemFeeBps / 100).toFixed(2)}%)`);
  console.log(`Flashloan Fee: 1 bps (0.01%)\n`);

  // ========================================
  // STEP 4: Simulate RICH Scenario
  // ========================================
  console.log('STEP 4: Simulating RICH SCENARIO (USDC → crvUSD → VUSD → USDC)');
  console.log('='.repeat(80));

  const flashloanAmount = ethers.utils.parseUnits('1000', 6);
  console.log(`Starting Amount: ${formatUsdc(flashloanAmount)} USDC\n`);

  // Step 4.1: Flashloan Fee
  const flashloanFee = flashloanAmount.mul(1).div(10000); // 0.01%
  console.log(`4.1: Flashloan Fee`);
  console.log(`     Fee: ${formatUsdc(flashloanFee)} USDC (0.01%)`);
  console.log(`     Must Repay: ${formatUsdc(flashloanAmount.add(flashloanFee))} USDC\n`);

  // Step 4.2: USDC → crvUSD
  console.log(`4.2: Swap USDC → crvUSD on Curve`);
  const crvusdOut = await crvusdUsdcPool.get_dy(
    USDC_INDEX,
    CRVUSD_INDEX_IN_USDC_POOL,
    flashloanAmount
  );
  const crvusdOutScaled = parseFloat(formatToken(crvusdOut, 18));
  const usdcInScaled = parseFloat(formatUsdc(flashloanAmount));
  const curveSlippage1 = ((usdcInScaled - crvusdOutScaled) / usdcInScaled) * 100;
  
  console.log(`     Input: ${formatUsdc(flashloanAmount)} USDC`);
  console.log(`     Output: ${formatToken(crvusdOut, 18)} crvUSD`);
  console.log(`     Slippage: ${curveSlippage1.toFixed(4)}%\n`);

  // Step 4.3: crvUSD → VUSD
  console.log(`4.3: Swap crvUSD → VUSD on Curve`);
  const vusdOut = await crvusdVusdPool.get_dy(
    CRVUSD_INDEX_IN_VUSD_POOL,
    VUSD_INDEX,
    crvusdOut
  );
  const vusdOutScaled = parseFloat(formatToken(vusdOut, 18));
  const curveSlippage2 = ((crvusdOutScaled - vusdOutScaled) / crvusdOutScaled) * 100;
  
  console.log(`     Input: ${formatToken(crvusdOut, 18)} crvUSD`);
  console.log(`     Output: ${formatToken(vusdOut, 18)} VUSD`);
  console.log(`     Slippage: ${curveSlippage2.toFixed(4)}%\n`);

  // Step 4.4: VUSD → USDC (Redeem with oracle impact)
  console.log(`4.4: Redeem VUSD → USDC via VUSD Redeemer`);
  
  // Oracle impact calculation (from Redeemer.sol logic)
  let usdcAfterOracle: number;
  if (oraclePrice <= 1.0) {
    // No oracle impact if USDC <= $1.00
    usdcAfterOracle = vusdOutScaled;
  } else {
    // Oracle impact: reduce USDC received
    usdcAfterOracle = vusdOutScaled / oraclePrice;
  }
  
  const oracleImpact = vusdOutScaled - usdcAfterOracle;
  const oracleImpactPercent = (oracleImpact / vusdOutScaled) * 100;
  
  console.log(`     Input: ${vusdOutScaled.toFixed(6)} VUSD`);
  console.log(`     Oracle Price: $${oraclePrice.toFixed(6)}`);
  console.log(`     After Oracle Impact: ${usdcAfterOracle.toFixed(6)} USDC`);
  console.log(`     Oracle Impact: -${oracleImpact.toFixed(6)} USDC (${oracleImpactPercent.toFixed(4)}%)`);
  
  // Redeem fee
  const redeemFeeAmount = usdcAfterOracle * (redeemFeeBps / 10000);
  const usdcRedeemed = usdcAfterOracle - redeemFeeAmount;
  
  console.log(`     Redeem Fee: ${redeemFeeAmount.toFixed(6)} USDC (${(redeemFeeBps / 100).toFixed(2)}%)`);
  console.log(`     Final Output: ${usdcRedeemed.toFixed(6)} USDC\n`);

  // Step 4.5: Calculate Profit/Loss
  console.log(`4.5: Calculate Profit/Loss`);
  const repaymentRequired = usdcInScaled + parseFloat(formatUsdc(flashloanFee));
  const profitLoss = usdcRedeemed - repaymentRequired;
  const profitLossPercent = (profitLoss / usdcInScaled) * 100;
  
  console.log(`     Amount Received: ${usdcRedeemed.toFixed(6)} USDC`);
  console.log(`     Repayment Required: ${repaymentRequired.toFixed(6)} USDC`);
  console.log(`     Net Result: ${profitLoss >= 0 ? '+' : ''}${profitLoss.toFixed(6)} USDC (${profitLoss >= 0 ? '+' : ''}${profitLossPercent.toFixed(4)}%)`);
  
  if (profitLoss < 0) {
    console.log(`     ❌ LOSS - Transaction would FAIL (insufficient balance for repayment)\n`);
  } else {
    console.log(`     ✅ PROFIT - Transaction would SUCCEED\n`);
  }

  // ========================================
  // STEP 5: Simulate CHEAP Scenario
  // ========================================
  console.log('STEP 5: Simulating CHEAP SCENARIO (USDC → VUSD → crvUSD → USDC)');
  console.log('='.repeat(80));
  console.log(`Starting Amount: ${formatUsdc(flashloanAmount)} USDC\n`);

  // Step 5.1: Flashloan Fee (same)
  console.log(`5.1: Flashloan Fee`);
  console.log(`     Fee: ${formatUsdc(flashloanFee)} USDC (0.01%)`);
  console.log(`     Must Repay: ${formatUsdc(flashloanAmount.add(flashloanFee))} USDC\n`);

  // Step 5.2: USDC → VUSD (Mint with oracle impact)
  console.log(`5.2: Mint USDC → VUSD via VUSD Minter`);
  
  // Oracle impact calculation (from Minter.sol logic)
  let vusdAfterOracle: number;
  if (oraclePrice >= 1.0) {
    // No oracle impact if USDC >= $1.00
    vusdAfterOracle = usdcInScaled;
  } else {
    // Oracle impact: reduce VUSD received
    vusdAfterOracle = usdcInScaled * oraclePrice;
  }
  
  const mintOracleImpact = usdcInScaled - vusdAfterOracle;
  const mintOracleImpactPercent = (mintOracleImpact / usdcInScaled) * 100;
  
  console.log(`     Input: ${usdcInScaled.toFixed(6)} USDC`);
  console.log(`     Oracle Price: $${oraclePrice.toFixed(6)}`);
  console.log(`     After Oracle Impact: ${vusdAfterOracle.toFixed(6)} VUSD`);
  console.log(`     Oracle Impact: -${mintOracleImpact.toFixed(6)} VUSD (${mintOracleImpactPercent.toFixed(4)}%)`);
  
  // Mint fee
  const mintFeeAmount = vusdAfterOracle * (mintFeeBps / 10000);
  const vusdMinted = vusdAfterOracle - mintFeeAmount;
  
  console.log(`     Mint Fee: ${mintFeeAmount.toFixed(6)} VUSD (${(mintFeeBps / 100).toFixed(2)}%)`);
  console.log(`     Final Output: ${vusdMinted.toFixed(6)} VUSD\n`);

  // Step 5.3: VUSD → crvUSD
  const vusdMintedBN = ethers.utils.parseUnits(vusdMinted.toFixed(18), 18);
  console.log(`5.3: Swap VUSD → crvUSD on Curve`);
  const crvusdOut2 = await crvusdVusdPool.get_dy(
    VUSD_INDEX,
    CRVUSD_INDEX_IN_VUSD_POOL,
    vusdMintedBN
  );
  const crvusdOut2Scaled = parseFloat(formatToken(crvusdOut2, 18));
  const curveSlippage3 = ((vusdMinted - crvusdOut2Scaled) / vusdMinted) * 100;
  
  console.log(`     Input: ${vusdMinted.toFixed(6)} VUSD`);
  console.log(`     Output: ${formatToken(crvusdOut2, 18)} crvUSD`);
  console.log(`     Slippage: ${curveSlippage3.toFixed(4)}%\n`);

  // Step 5.4: crvUSD → USDC
  console.log(`5.4: Swap crvUSD → USDC on Curve`);
  const usdcOut2 = await crvusdUsdcPool.get_dy(
    CRVUSD_INDEX_IN_USDC_POOL,
    USDC_INDEX,
    crvusdOut2
  );
  const usdcOut2Scaled = parseFloat(formatUsdc(usdcOut2));
  const curveSlippage4 = ((crvusdOut2Scaled - usdcOut2Scaled) / crvusdOut2Scaled) * 100;
  
  console.log(`     Input: ${formatToken(crvusdOut2, 18)} crvUSD`);
  console.log(`     Output: ${formatUsdc(usdcOut2)} USDC`);
  console.log(`     Slippage: ${curveSlippage4.toFixed(4)}%\n`);

  // Step 5.5: Calculate Profit/Loss
  console.log(`5.5: Calculate Profit/Loss`);
  const profitLoss2 = usdcOut2Scaled - repaymentRequired;
  const profitLossPercent2 = (profitLoss2 / usdcInScaled) * 100;
  
  console.log(`     Amount Received: ${usdcOut2Scaled.toFixed(6)} USDC`);
  console.log(`     Repayment Required: ${repaymentRequired.toFixed(6)} USDC`);
  console.log(`     Net Result: ${profitLoss2 >= 0 ? '+' : ''}${profitLoss2.toFixed(6)} USDC (${profitLoss2 >= 0 ? '+' : ''}${profitLossPercent2.toFixed(4)}%)`);
  
  if (profitLoss2 < 0) {
    console.log(`     ❌ LOSS - Transaction would FAIL (insufficient balance for repayment)\n`);
  } else {
    console.log(`     ✅ PROFIT - Transaction would SUCCEED\n`);
  }

  // ========================================
  // SUMMARY
  // ========================================
  console.log('========================================');
  console.log('DIAGNOSTIC SUMMARY');
  console.log('========================================');
  
  console.log('\n📊 Current Market Conditions:');
  console.log(`   Oracle Price: $${oraclePrice.toFixed(6)}`);
  console.log(`   Within Tolerance: ${withinTolerance ? 'YES ✅' : 'NO ❌'}`);
  console.log(`   Mint Fee: ${(mintFeeBps / 100).toFixed(2)}%`);
  console.log(`   Redeem Fee: ${(redeemFeeBps / 100).toFixed(2)}%`);
  
  console.log('\n💰 RICH Scenario Results:');
  console.log(`   Expected Result: ${profitLoss >= 0 ? '+' : ''}${profitLoss.toFixed(6)} USDC`);
  console.log(`   Status: ${profitLoss >= 0 ? 'PROFITABLE ✅' : 'UNPROFITABLE ❌'}`);
  
  console.log('\n💰 CHEAP Scenario Results:');
  console.log(`   Expected Result: ${profitLoss2 >= 0 ? '+' : ''}${profitLoss2.toFixed(6)} USDC`);
  console.log(`   Status: ${profitLoss2 >= 0 ? 'PROFITABLE ✅' : 'UNPROFITABLE ❌'}`);
  
  console.log('\n🔍 Loss Breakdown (RICH Scenario):');
  console.log(`   Flashloan Fee: -${parseFloat(formatUsdc(flashloanFee)).toFixed(6)} USDC (0.01%)`);
  console.log(`   Curve Slippage (USDC→crvUSD): -${(usdcInScaled * curveSlippage1 / 100).toFixed(6)} USDC (${curveSlippage1.toFixed(4)}%)`);
  console.log(`   Curve Slippage (crvUSD→VUSD): -${(crvusdOutScaled * curveSlippage2 / 100).toFixed(6)} USDC (${curveSlippage2.toFixed(4)}%)`);
  console.log(`   Oracle Impact: -${oracleImpact.toFixed(6)} USDC (${oracleImpactPercent.toFixed(4)}%)`);
  console.log(`   Redeem Fee: -${redeemFeeAmount.toFixed(6)} USDC (${(redeemFeeBps / 100).toFixed(2)}%)`);
  console.log(`   TOTAL LOSS: ${Math.abs(profitLoss).toFixed(6)} USDC`);
  
  console.log('\n📈 What Would Make This Profitable:');
  const neededDeviation = Math.abs(profitLoss) / usdcInScaled;
  console.log(`   Need crvUSD/VUSD price deviation > ${formatPercent(neededDeviation)}`);
  console.log(`   OR oracle price closer to $1.00 (currently $${oraclePrice.toFixed(6)})`);
  console.log(`   OR lower redeem fee (currently ${(redeemFeeBps / 100).toFixed(2)}%)`);
  
  console.log('\n💡 Recommendations:');
  if (!withinTolerance) {
    console.log(`   ⚠️  Oracle price is outside tolerance - wait for it to return to $0.99-$1.01`);
  }
  if (profitLoss < 0 && profitLoss2 < 0) {
    console.log(`   ⏳ Market conditions not favorable - wait for price deviation`);
    console.log(`   🔄 Monitor crvUSD/VUSD Curve pool for better exchange rates`);
    console.log(`   💸 Consider smaller amounts (less slippage)`);
  } else if (profitLoss >= 0) {
    console.log(`   ✅ RICH scenario is profitable - execute now!`);
  } else if (profitLoss2 >= 0) {
    console.log(`   ✅ CHEAP scenario is profitable - execute now!`);
  }
  
  console.log('\n========================================\n');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('\nDiagnostic failed:', error.message);
    process.exit(1);
  });

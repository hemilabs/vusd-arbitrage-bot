// scripts/check-uniswap-pool-liquidity.ts
// Check if the Uniswap V3 USDC pool has enough liquidity for flashloans

import { ethers } from 'hardhat';

const UNISWAP_V3_USDC_POOL = '0x919b20Ac45304AEB09C9df5c604b3CD9D99a51cA';
const USDC_ADDRESS = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';

const POOL_ABI = [
  'function token0() external view returns (address)',
  'function token1() external view returns (address)',
  'function fee() external view returns (uint24)',
  'function liquidity() external view returns (uint128)',
];

const ERC20_ABI = [
  'function balanceOf(address account) external view returns (uint256)',
  'function decimals() external view returns (uint8)',
  'function symbol() external view returns (string)',
];

async function main() {
  console.log('\n' + '█'.repeat(80));
  console.log('UNISWAP V3 POOL LIQUIDITY CHECK');
  console.log('█'.repeat(80));

  const pool = await ethers.getContractAt(POOL_ABI, UNISWAP_V3_USDC_POOL);
  
  // Get pool info
  const token0 = await pool.token0();
  const token1 = await pool.token1();
  const fee = await pool.fee();
  const liquidity = await pool.liquidity();
  
  console.log(`\nPool Address: ${UNISWAP_V3_USDC_POOL}`);
  console.log(`Fee Tier: ${fee / 10000}%`);
  console.log(`Liquidity: ${liquidity.toString()}`);
  
  // Get token contracts
  const token0Contract = await ethers.getContractAt(ERC20_ABI, token0);
  const token1Contract = await ethers.getContractAt(ERC20_ABI, token1);
  
  const token0Symbol = await token0Contract.symbol();
  const token1Symbol = await token1Contract.symbol();
  const token0Decimals = await token0Contract.decimals();
  const token1Decimals = await token1Contract.decimals();
  
  console.log(`\nToken 0: ${token0Symbol} (${token0})`);
  console.log(`Token 1: ${token1Symbol} (${token1})`);
  
  // Check actual USDC balance in the pool
  const usdcContract = await ethers.getContractAt(ERC20_ABI, USDC_ADDRESS);
  const poolUsdcBalance = await usdcContract.balanceOf(UNISWAP_V3_USDC_POOL);
  const poolUsdcBalanceFormatted = parseFloat(ethers.utils.formatUnits(poolUsdcBalance, 6));
  
  console.log('\n' + '='.repeat(80));
  console.log('CRITICAL: USDC BALANCE IN POOL');
  console.log('='.repeat(80));
  console.log(`Pool's USDC balance: ${poolUsdcBalanceFormatted.toLocaleString()} USDC`);
  
  // Test if different flashloan sizes would work
  console.log('\n' + '='.repeat(80));
  console.log('FLASHLOAN SIZE ANALYSIS');
  console.log('='.repeat(80));
  
  const testSizes = [5000, 7000, 7500, 8000, 10000, 20000];
  
  for (const size of testSizes) {
    const canBorrow = size <= poolUsdcBalanceFormatted;
    const status = canBorrow ? '✓ Pool has enough' : '✗ POOL TOO SMALL - This would FAIL!';
    console.log(`${size.toLocaleString().padStart(7)} USDC flashloan: ${status}`);
  }
  
  console.log('\n' + '█'.repeat(80));
  console.log('🔍 DIAGNOSIS:');
  if (poolUsdcBalanceFormatted < 8000) {
    console.log('   ❌ FOUND THE PROBLEM!');
    console.log(`   The Uniswap V3 pool only has ${poolUsdcBalanceFormatted.toLocaleString()} USDC`);
    console.log('   This is why 8k+ flashloans fail!');
  } else {
    console.log('   ✓ Pool has sufficient USDC for flashloans');
    console.log('   The problem must be elsewhere...');
  }
  console.log('█'.repeat(80) + '\n');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

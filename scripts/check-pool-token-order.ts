// scripts/check-pool-token-order.ts
// Quick script to check which token is token0 and token1 in the pool

import { ethers } from 'hardhat';

const POOL_ADDRESS = '0x5777d92f208679DB4b9778590Fa3CAB3aC9e2168';
const USDC_ADDRESS = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const DAI_ADDRESS = '0x6B175474E89094C44Da98b954EedeAC495271d0F';

const POOL_ABI = [
  'function token0() external view returns (address)',
  'function token1() external view returns (address)',
];

const ERC20_ABI = [
  'function symbol() external view returns (string)',
];

async function main() {
  console.log('\n========================================');
  console.log('CHECKING POOL TOKEN ORDER');
  console.log('========================================');
  console.log(`Pool: ${POOL_ADDRESS}\n`);

  const pool = await ethers.getContractAt(POOL_ABI, POOL_ADDRESS);
  
  const token0Address = await pool.token0();
  const token1Address = await pool.token1();
  
  const token0 = await ethers.getContractAt(ERC20_ABI, token0Address);
  const token1 = await ethers.getContractAt(ERC20_ABI, token1Address);
  
  const token0Symbol = await token0.symbol();
  const token1Symbol = await token1.symbol();
  
  console.log(`Token0: ${token0Symbol} (${token0Address})`);
  console.log(`Token1: ${token1Symbol} (${token1Address})`);
  console.log('');
  
  // Check which one is USDC
  if (token0Address.toLowerCase() === USDC_ADDRESS.toLowerCase()) {
    console.log('✅ USDC is token0');
    console.log('   flash(address, usdcAmount, 0, data) ← CORRECT');
  } else if (token1Address.toLowerCase() === USDC_ADDRESS.toLowerCase()) {
    console.log('❌ USDC is token1 (NOT token0!)');
    console.log('   flash(address, 0, usdcAmount, data) ← NEED THIS');
  } else {
    console.log('⚠️  USDC not found in this pool!');
  }
  
  console.log('========================================\n');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

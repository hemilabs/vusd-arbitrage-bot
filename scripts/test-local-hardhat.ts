// scripts/test-local-hardhat.ts
// Test on LOCAL Hardhat fork with console.log for debugging
// This uses the DEBUG version of the contract (with console.log)

import { ethers } from 'hardhat';
import * as dotenv from 'dotenv';

dotenv.config();

const ERC20_ABI = [
  'function balanceOf(address account) external view returns (uint256)',
  'function transfer(address to, uint256 amount) external returns (bool)',
  'function approve(address spender, uint256 amount) external returns (bool)',
];

const UNISWAP_ROUTER_ABI = [
  'function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) external payable returns (uint256 amountOut)',
];

const WETH_ABI = [
  'function deposit() external payable',
  'function approve(address spender, uint256 amount) external returns (bool)',
];

// Addresses
const UNISWAP_ROUTER = '0xE592427A0AEce92De3Edee1F18E0157C05861564';
const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
const USDC_WHALE = '0x40ec5B33f54e0E8A33A975908C5BA1c14e5BbbDf'; // Coinbase

async function impersonateAndFund(address: string) {
  await ethers.provider.send('hardhat_impersonateAccount', [address]);
  await ethers.provider.send('hardhat_setBalance', [
    address,
    ethers.utils.parseEther('10').toHexString(),
  ]);
  return await ethers.getSigner(address);
}

async function main() {
  console.log('🧪 Testing on LOCAL Hardhat Fork with console.log\n');
  console.log('');

  // Get deployer
  const [deployer] = await ethers.getSigners();
  console.log('👤 Deployer:', deployer.address);

  const network = await ethers.provider.getNetwork();
  console.log('🌐 Network:', network.name, `(Chain ID: ${network.chainId})`);

  // Deploy the DEBUG contract (with console.log)
  console.log('\n📦 Deploying DEBUG contract (with console.log)...');
  
  const addresses = {
    usdc: process.env.USDC_ADDRESS!,
    crvUsd: process.env.CRVUSD_ADDRESS!,
    vusd: process.env.VUSD_ADDRESS!,
    vusdMinter: process.env.VUSD_MINTER!,
    vusdRedeemer: process.env.VUSD_REDEEMER!,
    curveCrvusdUsdcPool: process.env.CURVE_CRVUSD_USDC_POOL!,
    curveCrvusdVusdPool: process.env.CURVE_CRVUSD_VUSD_POOL!,
    defaultUniswapV3Pool: process.env.DEFAULT_UNISWAP_V3_POOL || '0x5777d92f208679DB4b9778590Fa3CAB3aC9e2168',
  };

  // Get pool info
  const POOL_ABI = [
    'function token0() external view returns (address)',
    'function token1() external view returns (address)',
  ];
  const pool = new ethers.Contract(addresses.defaultUniswapV3Pool, POOL_ABI, deployer);
  const token1 = await pool.token1();
  const usdcIsToken1 = token1.toLowerCase() === addresses.usdc.toLowerCase();
  
  console.log('   Pool:', addresses.defaultUniswapV3Pool);
  console.log('   USDC is token1:', usdcIsToken1);

  // Curve indices
  const usdcIndex = 0;
  const crvUsdIndexInUsdcPool = 1;
  const crvUsdIndexInVusdPool = 0;
  const vusdIndex = 1;

  // Deploy DEBUG contract (this will compile the debug version with console.log)
  const VusdArbitrage = await ethers.getContractFactory('VusdArbitrage');
  const contract = await VusdArbitrage.deploy(
    addresses.usdc,
    addresses.crvUsd,
    addresses.vusd,
    addresses.vusdMinter,
    addresses.vusdRedeemer,
    addresses.curveCrvusdUsdcPool,
    addresses.curveCrvusdVusdPool,
    addresses.defaultUniswapV3Pool,
    usdcIsToken1,
    usdcIndex,
    crvUsdIndexInUsdcPool,
    crvUsdIndexInVusdPool,
    vusdIndex
  );
  await contract.deployed();
  console.log('✅ Contract deployed at:', contract.address);

  // Get USDC from whale
  console.log('\n🐋 Getting USDC from whale...');
  const whale = await impersonateAndFund(USDC_WHALE);
  const usdc = new ethers.Contract(addresses.usdc, ERC20_ABI, whale);
  
  // Transfer 10k USDC to contract
  const transferAmount = ethers.utils.parseUnits('10000', 6);
  await usdc.transfer(contract.address, transferAmount);
  
  const contractBalance = await usdc.balanceOf(contract.address);
  console.log('✅ Contract funded with:', ethers.utils.formatUnits(contractBalance, 6), 'USDC');

  // Stop impersonating whale
  await ethers.provider.send('hardhat_stopImpersonatingAccount', [USDC_WHALE]);

  // Get contract as deployer
  const contractAsDeployer = contract.connect(deployer);

  // Test RICH scenario
  console.log('');
  console.log('TEST 1: RICH SCENARIO');
  console.log('Path: USDC → crvUSD → VUSD → USDC (via redeem)');
  console.log('');

  const flashloanAmount = ethers.utils.parseUnits('1000', 6);
  console.log('\n💸 Flashloan Amount:', ethers.utils.formatUnits(flashloanAmount, 6), 'USDC');

  const balanceBefore = await usdc.balanceOf(contract.address);
  console.log('💰 Contract Balance Before:', ethers.utils.formatUnits(balanceBefore, 6), 'USDC\n');

  try {
    console.log('🚀 Executing RICH scenario with console.log output:\n');
    console.log('');
    
    const tx = await contractAsDeployer.executeRichWithDefaultPool(flashloanAmount, {
      gasLimit: 5000000,
    });
    
    console.log('');
    console.log('📤 Transaction sent:', tx.hash);
    
    const receipt = await tx.wait();
    console.log('✅ Transaction confirmed!');
    console.log('   Block:', receipt.blockNumber);
    console.log('   Gas Used:', receipt.gasUsed.toString());

    const balanceAfter = await usdc.balanceOf(contract.address);
    console.log('\n💰 Contract Balance After:', ethers.utils.formatUnits(balanceAfter, 6), 'USDC');

    const diff = balanceAfter.sub(balanceBefore);
    if (diff.gt(0)) {
      console.log('✅ PROFIT:', ethers.utils.formatUnits(diff, 6), 'USDC');
    } else if (diff.lt(0)) {
      console.log('⚠️  LOSS:', ethers.utils.formatUnits(diff.abs(), 6), 'USDC');
    } else {
      console.log('➖ BREAK EVEN: 0 USDC');
    }

  } catch (error: any) {
    console.error('\n❌ RICH scenario FAILED:', error.message);
    if (error.reason) {
      console.error('   Reason:', error.reason);
    }
    if (error.error) {
      console.error('   Error:', error.error);
    }
  }

  // Test CHEAP scenario
  console.log('');
  console.log('TEST 2: CHEAP SCENARIO');
  console.log('Path: USDC → VUSD (via mint) → crvUSD → USDC');
  console.log('');

  const balanceBeforeCheap = await usdc.balanceOf(contract.address);
  console.log('\n💰 Contract Balance Before:', ethers.utils.formatUnits(balanceBeforeCheap, 6), 'USDC\n');

  try {
    console.log('🚀 Executing CHEAP scenario with console.log output:\n');
    console.log('');
    
    const tx = await contractAsDeployer.executeCheapWithDefaultPool(flashloanAmount, {
      gasLimit: 5000000,
    });
    
    console.log('');
    console.log('📤 Transaction sent:', tx.hash);
    
    const receipt = await tx.wait();
    console.log('✅ Transaction confirmed!');
    console.log('   Block:', receipt.blockNumber);
    console.log('   Gas Used:', receipt.gasUsed.toString());

    const balanceAfterCheap = await usdc.balanceOf(contract.address);
    console.log('\n💰 Contract Balance After:', ethers.utils.formatUnits(balanceAfterCheap, 6), 'USDC');

    const diff = balanceAfterCheap.sub(balanceBeforeCheap);
    if (diff.gt(0)) {
      console.log('✅ PROFIT:', ethers.utils.formatUnits(diff, 6), 'USDC');
    } else if (diff.lt(0)) {
      console.log('⚠️  LOSS:', ethers.utils.formatUnits(diff.abs(), 6), 'USDC');
    } else {
      console.log('➖ BREAK EVEN: 0 USDC');
    }

  } catch (error: any) {
    console.error('\n❌ CHEAP scenario FAILED:', error.message);
    if (error.reason) {
      console.error('   Reason:', error.reason);
    }
    if (error.error) {
      console.error('   Error:', error.error);
    }
  }

  // Final summary
  console.log('');
  console.log('TESTING COMPLETE');
  console.log('');

  const finalBalance = await usdc.balanceOf(contract.address);
  console.log('\n💰 Final Contract Balance:', ethers.utils.formatUnits(finalBalance, 6), 'USDC');
  
  console.log('\n📝 Summary:');
  console.log('   • Local Hardhat fork with console.log shows full execution trace');
  console.log('   • If this works but Tenderly fails, it\'s a deployment issue');
  console.log('   • If this fails, we can see EXACTLY where in console.log output');
  console.log('\n✅ Test complete!\n');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('\n💥 Test failed:', error);
    process.exit(1);
  });

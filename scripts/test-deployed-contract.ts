// scripts/test-deployed-contract.ts
// Test the deployed VusdArbitrage contract on Tenderly fork
// TENDERLY-COMPATIBLE: Uses Uniswap to buy USDC instead of impersonating whales

import { ethers } from 'hardhat';
import * as dotenv from 'dotenv';

dotenv.config();

// ABIs
const ERC20_ABI = [
  'function balanceOf(address account) external view returns (uint256)',
  'function transfer(address to, uint256 amount) external returns (bool)',
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function decimals() external view returns (uint8)',
  'function symbol() external view returns (string)',
];

const UNISWAP_ROUTER_ABI = [
  'function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) external payable returns (uint256 amountOut)',
];

const WETH_ABI = [
  'function deposit() external payable',
  'function approve(address spender, uint256 amount) external returns (bool)',
];

// Addresses
const DEPLOYED_CONTRACT = '0xcD04f54022822b6f7099308B4b9Ab96D1f1c05F5';
const UNISWAP_ROUTER = '0xE592427A0AEce92De3Edee1F18E0157C05861564'; // SwapRouter
const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';

async function buyUSDC(
  signer: any,
  usdcAddress: string,
  amountUSDC: string
): Promise<void> {
  console.log('\n💱 Buying USDC with ETH via Uniswap...');
  
  // Wrap ETH to WETH
  const weth = new ethers.Contract(WETH, WETH_ABI, signer);
  const ethAmount = ethers.utils.parseEther('1'); // Use 1 ETH to buy USDC
  
  console.log('   1. Wrapping 1 ETH to WETH...');
  const wrapTx = await weth.deposit({ value: ethAmount });
  await wrapTx.wait();
  console.log('      ✅ WETH obtained');

  // Approve Uniswap router
  console.log('   2. Approving Uniswap router...');
  const approveTx = await weth.approve(UNISWAP_ROUTER, ethAmount);
  await approveTx.wait();
  console.log('      ✅ Router approved');

  // Swap WETH for USDC
  console.log('   3. Swapping WETH for USDC...');
  const router = new ethers.Contract(UNISWAP_ROUTER, UNISWAP_ROUTER_ABI, signer);
  
  const params = {
    tokenIn: WETH,
    tokenOut: usdcAddress,
    fee: 500, // 0.05% fee tier
    recipient: signer.address,
    deadline: Math.floor(Date.now() / 1000) + 60 * 20, // 20 minutes
    amountIn: ethAmount,
    amountOutMinimum: 0, // Accept any amount for testing
    sqrtPriceLimitX96: 0,
  };

  const swapTx = await router.exactInputSingle(params);
  await swapTx.wait();
  console.log('      ✅ USDC purchased');

  // Check balance
  const usdc = new ethers.Contract(usdcAddress, ERC20_ABI, signer);
  const balance = await usdc.balanceOf(signer.address);
  console.log(`      Got: ${ethers.utils.formatUnits(balance, 6)} USDC`);
}

async function main() {
  console.log('🧪 Testing Deployed VusdArbitrage Contract on Tenderly\n');

  // Get signer
  const [deployer] = await ethers.getSigners();
  console.log('👤 Tester:', deployer.address);

  const ethBalance = await deployer.getBalance();
  console.log('💰 ETH Balance:', ethers.utils.formatEther(ethBalance), 'ETH');

  // Get network info
  const network = await ethers.provider.getNetwork();
  console.log('🌐 Network:', network.name, `(Chain ID: ${network.chainId})`);

  // Connect to deployed contract
  console.log('\n📍 Deployed Contract:', DEPLOYED_CONTRACT);
  const contract = await ethers.getContractAt('VusdArbitrage', DEPLOYED_CONTRACT);
  console.log('✅ Contract connected');

  // Verify contract owner
  const owner = await contract.owner();
  console.log('👑 Contract Owner:', owner);
  
  if (owner.toLowerCase() !== deployer.address.toLowerCase()) {
    throw new Error('You are not the contract owner! Cannot execute trades.');
  }

  // Get token addresses from contract
  const USDC = await contract.USDC();
  const CRVUSD = await contract.CRVUSD();
  const VUSD = await contract.VUSD();

  console.log('\n💎 Token Addresses:');
  console.log('   USDC:', USDC);
  console.log('   crvUSD:', CRVUSD);
  console.log('   VUSD:', VUSD);

  // Connect to USDC token
  const usdc = await ethers.getContractAt(ERC20_ABI, USDC);

  // Check deployer's USDC balance
  let deployerUSDC = await usdc.balanceOf(deployer.address);
  console.log('\n💰 Your USDC Balance:', ethers.utils.formatUnits(deployerUSDC, 6), 'USDC');

  // Buy USDC if we don't have any
  if (deployerUSDC.eq(0)) {
    await buyUSDC(deployer, USDC, '100000');
    deployerUSDC = await usdc.balanceOf(deployer.address);
  }

  // Transfer ALL your USDC to contract (whatever amount we have)
  console.log('\n📤 Transferring USDC to contract...');
  const transferAmount = deployerUSDC; // Transfer everything we have
  const transferTx = await usdc.transfer(DEPLOYED_CONTRACT, transferAmount);
  await transferTx.wait();
  console.log(`   ✅ Transferred ${ethers.utils.formatUnits(transferAmount, 6)} USDC to contract`);

  // Check contract's USDC balance
  const contractBalance = await usdc.balanceOf(DEPLOYED_CONTRACT);
  console.log('💰 Contract USDC Balance:', ethers.utils.formatUnits(contractBalance, 6), 'USDC');

  // Get default pool info
  const defaultPool = await contract.DEFAULT_UNISWAP_V3_POOL();
  const usdcIsToken1 = await contract.USDC_IS_TOKEN1_IN_DEFAULT_POOL();
  
  console.log('\n🏊 Default Pool Configuration:');
  console.log('   Pool:', defaultPool);
  console.log('   USDC Position:', usdcIsToken1 ? 'token1' : 'token0');

  // Test RICH scenario
  console.log('\n' + '='.repeat(80));
  console.log('TEST 1: RICH SCENARIO (crvUSD expensive vs VUSD)');
  console.log('Path: USDC → crvUSD → VUSD → USDC (via redeem)');
  console.log('='.repeat(80));

  const flashloanAmount = ethers.utils.parseUnits('1000', 6); // 1k USDC flashloan (smaller for testing)
  console.log('\n💸 Flashloan Amount:', ethers.utils.formatUnits(flashloanAmount, 6), 'USDC');

  const balanceBefore = await usdc.balanceOf(DEPLOYED_CONTRACT);
  console.log('💰 Contract Balance Before:', ethers.utils.formatUnits(balanceBefore, 6), 'USDC');

  try {
    console.log('\n🚀 Executing RICH scenario...');
    const tx = await contract.executeRichWithDefaultPool(flashloanAmount, {
      gasLimit: 5000000,
    });
    
    console.log('📤 Transaction sent:', tx.hash);
    console.log('⏳ Waiting for confirmation...');
    
    const receipt = await tx.wait();
    console.log('✅ Transaction confirmed!');
    console.log('   Block:', receipt.blockNumber);
    console.log('   Gas Used:', receipt.gasUsed.toString());

    // Check final balance
    const balanceAfter = await usdc.balanceOf(DEPLOYED_CONTRACT);
    console.log('\n💰 Contract Balance After:', ethers.utils.formatUnits(balanceAfter, 6), 'USDC');

    // Calculate profit/loss
    const diff = balanceAfter.sub(balanceBefore);
    if (diff.gt(0)) {
      console.log('✅ PROFIT:', ethers.utils.formatUnits(diff, 6), 'USDC');
    } else if (diff.lt(0)) {
      console.log('⚠️  LOSS:', ethers.utils.formatUnits(diff.abs(), 6), 'USDC');
    } else {
      console.log('➖ BREAK EVEN: 0 USDC');
    }

    // Parse events from logs
    console.log('\n📋 Transaction Events:');
    let eventCount = 0;
    for (const log of receipt.logs) {
      try {
        const parsed = contract.interface.parseLog(log);
        console.log(`   ${parsed.name}`);
        eventCount++;
      } catch (e) {
        // Skip unparseable logs
      }
    }
    if (eventCount === 0) {
      console.log('   (No contract events emitted)');
    }

  } catch (error: any) {
    console.error('\n❌ RICH scenario failed:', error.message);
    if (error.error?.message) {
      console.error('   Reason:', error.error.message);
    }
  }

  // Test CHEAP scenario
  console.log('\n' + '='.repeat(80));
  console.log('TEST 2: CHEAP SCENARIO (crvUSD cheap vs VUSD)');
  console.log('Path: USDC → VUSD (via mint) → crvUSD → USDC');
  console.log('='.repeat(80));

  const balanceBeforeCheap = await usdc.balanceOf(DEPLOYED_CONTRACT);
  console.log('\n💰 Contract Balance Before:', ethers.utils.formatUnits(balanceBeforeCheap, 6), 'USDC');

  try {
    console.log('\n🚀 Executing CHEAP scenario...');
    const tx = await contract.executeCheapWithDefaultPool(flashloanAmount, {
      gasLimit: 5000000,
    });
    
    console.log('📤 Transaction sent:', tx.hash);
    console.log('⏳ Waiting for confirmation...');
    
    const receipt = await tx.wait();
    console.log('✅ Transaction confirmed!');
    console.log('   Block:', receipt.blockNumber);
    console.log('   Gas Used:', receipt.gasUsed.toString());

    // Check final balance
    const balanceAfterCheap = await usdc.balanceOf(DEPLOYED_CONTRACT);
    console.log('\n💰 Contract Balance After:', ethers.utils.formatUnits(balanceAfterCheap, 6), 'USDC');

    // Calculate profit/loss
    const diff = balanceAfterCheap.sub(balanceBeforeCheap);
    if (diff.gt(0)) {
      console.log('✅ PROFIT:', ethers.utils.formatUnits(diff, 6), 'USDC');
    } else if (diff.lt(0)) {
      console.log('⚠️  LOSS:', ethers.utils.formatUnits(diff.abs(), 6), 'USDC');
    } else {
      console.log('➖ BREAK EVEN: 0 USDC');
    }

    // Parse events
    console.log('\n📋 Transaction Events:');
    let eventCount = 0;
    for (const log of receipt.logs) {
      try {
        const parsed = contract.interface.parseLog(log);
        console.log(`   ${parsed.name}`);
        eventCount++;
      } catch (e) {
        // Skip unparseable logs
      }
    }
    if (eventCount === 0) {
      console.log('   (No contract events emitted)');
    }

  } catch (error: any) {
    console.error('\n❌ CHEAP scenario failed:', error.message);
    if (error.error?.message) {
      console.error('   Reason:', error.error.message);
    }
  }

  // Final summary
  console.log('\n' + '='.repeat(80));
  console.log('TESTING COMPLETE');
  console.log('='.repeat(80));

  const finalBalance = await usdc.balanceOf(DEPLOYED_CONTRACT);
  console.log('\n💰 Final Contract Balance:', ethers.utils.formatUnits(finalBalance, 6), 'USDC');

  console.log('\n✅ Contract testing complete!');
  console.log('\n📝 Next Steps:');
  console.log('   1. Review the results above');
  console.log('   2. If both scenarios work: Deploy to mainnet');
  console.log('   3. If issues found: Fix and redeploy to Tenderly');
  console.log('\n🎊 Ready for mainnet deployment when you are!\n');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('\n💥 Test failed:', error);
    process.exit(1);
  });

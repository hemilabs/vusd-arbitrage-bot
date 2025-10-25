// scripts/test-deployed-contract.ts
// UPDATED to work with the new hardened VusdArbitrage contract
// Tests the deployed contract on Tenderly fork by passing the required params structs.

import { ethers } from 'hardhat';
import * as dotenv from 'dotenv';
import { loadWallet } from '../src/utils/keystore-utils';

dotenv.config();

// --- ABIs ---
const ERC20_ABI = [
  'function balanceOf(address account) external view returns (uint256)',
  'function transfer(address to, uint256 amount) external returns (bool)',
  'function approve(address spender, uint256 amount) external returns (bool)',
];

const WETH_ABI = [
    'function deposit() external payable',
    'function approve(address spender, uint256 amount) external returns (bool)',
];

const UNISWAP_ROUTER_ABI = [
    'function exactInputSingle(tuple(address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) external payable returns (uint256 amountOut)',
];

// --- ADDRESSES ---
// UPDATED with the new contract address from your successful deployment
const DEPLOYED_CONTRACT = '0xc022E25051147f21FB353514E471E8189CA4c750';  
const UNISWAP_ROUTER = '0xE592427A0AEce92De3Edee1F18E0157C05861564';
const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';


async function buyUSDC(signer: ethers.Wallet, usdcAddress: string): Promise<void> {
    console.log('\nBuying USDC to fund test wallet...');
    const weth = new ethers.Contract(WETH, WETH_ABI, signer);
    const ethAmount = ethers.utils.parseEther('1'); // Use 1 ETH to buy USDC

    console.log('   1. Wrapping 1 ETH to WETH...');
    await (await weth.deposit({ value: ethAmount })).wait();
    console.log('      WETH obtained.');

    console.log('   2. Approving Uniswap router...');
    await (await weth.approve(UNISWAP_ROUTER, ethAmount)).wait();
    console.log('      Router approved.');

    console.log('   3. Swapping WETH for USDC...');
    const router = new ethers.Contract(UNISWAP_ROUTER, UNISWAP_ROUTER_ABI, signer);
    const params = {
      tokenIn: WETH,
      tokenOut: usdcAddress,
      fee: 500, // 0.05% fee tier
      recipient: signer.address,
      deadline: Math.floor(Date.now() / 1000) + 60 * 20,
      amountIn: ethAmount,
      amountOutMinimum: 0,
      sqrtPriceLimitX96: 0,
    };
    await (await router.exactInputSingle(params)).wait();
    
    const usdc = new ethers.Contract(usdcAddress, ERC20_ABI, signer);
    const balance = await usdc.balanceOf(signer.address);
    console.log(`      Success! Wallet now has: ${ethers.utils.formatUnits(balance, 6)} USDC`);
}


async function main() {
  console.log('Testing Deployed VusdArbitrage Contract on Tenderly\n');

  console.log('Loading wallet from keystore...');
  const deployer = await loadWallet(ethers.provider);
  console.log('Tester Wallet:', deployer.address);
  console.log('ETH Balance:', ethers.utils.formatEther(await deployer.getBalance()), 'ETH');

  console.log('\nConnecting to deployed contract:', DEPLOYED_CONTRACT);
  const contract = await ethers.getContractAt('VusdArbitrage', DEPLOYED_CONTRACT, deployer);

  const owner = await contract.owner();
  if (owner.toLowerCase() !== deployer.address.toLowerCase()) {
    throw new Error('You are not the contract owner! Cannot execute trades.');
  }
  console.log('   ✅ Confirmed you are the contract owner.');

  const USDC = await contract.USDC();
  const usdc = new ethers.Contract(USDC, ERC20_ABI, deployer);

  let deployerUSDC = await usdc.balanceOf(deployer.address);
  if (deployerUSDC.isZero()) {
    await buyUSDC(deployer, USDC);
    deployerUSDC = await usdc.balanceOf(deployer.address);
  }

  console.log(`\nTransferring ${ethers.utils.formatUnits(deployerUSDC, 6)} USDC to contract for testing...`);
  await (await usdc.transfer(DEPLOYED_CONTRACT, deployerUSDC)).wait();
  console.log('   ✅ Transfer complete.');

  const flashloanAmount = ethers.utils.parseUnits('1000', 6);

  // ========================================================================
  // TEST 1: RICH SCENARIO
  // ========================================================================
  console.log('\n' + '='.repeat(80));
  console.log('TEST 1: RICH SCENARIO (crvUSD expensive vs VUSD)');
  console.log('='.repeat(80));

  const balanceBeforeRich = await usdc.balanceOf(DEPLOYED_CONTRACT);
  console.log('Contract Balance Before:', ethers.utils.formatUnits(balanceBeforeRich, 6), 'USDC');

  try {
    console.log('\nExecuting RICH scenario...');
    
    // *** NEW: Create the params struct ***
    const richParams = {
      minCrvUsdOut: 1, // Use 1 wei for basic execution test
      minVusdOut: 1,
      minUsdcOut: 1,
    };

    const tx = await contract.executeRichWithDefaultPool(flashloanAmount, richParams, {
      gasLimit: 5000000,
    });
    
    console.log('   Transaction sent:', tx.hash);
    console.log('   Waiting for confirmation...');
    const receipt = await tx.wait();
    console.log('   ✅ Transaction confirmed in block', receipt.blockNumber);
    console.log('   Gas Used:', receipt.gasUsed.toString());
    const balanceAfterRich = await usdc.balanceOf(DEPLOYED_CONTRACT);
    console.log('\nContract Balance After:', ethers.utils.formatUnits(balanceAfterRich, 6), 'USDC');

    const diff = balanceAfterRich.sub(balanceBeforeRich);
    console.log(`   Result: ${diff.isNegative() ? 'LOSS of' : 'PROFIT of'} ${ethers.utils.formatUnits(diff.abs(), 6)} USDC`);

  } catch (error: any) {
    console.error('\n   ❌ RICH scenario FAILED:', error.message);
  }

  // ========================================================================
  // TEST 2: CHEAP SCENARIO
  // ========================================================================
  console.log('\n' + '='.repeat(80));
  console.log('TEST 2: CHEAP SCENARIO (crvUSD cheap vs VUSD)');
  console.log('='.repeat(80));

  const balanceBeforeCheap = await usdc.balanceOf(DEPLOYED_CONTRACT);
  console.log('Contract Balance Before:', ethers.utils.formatUnits(balanceBeforeCheap, 6), 'USDC');

  try {
    console.log('\nExecuting CHEAP scenario...');

    // *** NEW: Create the params struct ***
    const cheapParams = {
      minVusdOut: 1, // Use 1 wei for basic execution test
      minCrvUsdOut: 1,
      minUsdcOut: 1,
    };

    const tx = await contract.executeCheapWithDefaultPool(flashloanAmount, cheapParams, {
      gasLimit: 5000000,
    });
    
    console.log('   Transaction sent:', tx.hash);
    console.log('   Waiting for confirmation...');
    const receipt = await tx.wait();
    console.log('   ✅ Transaction confirmed in block', receipt.blockNumber);
    console.log('   Gas Used:', receipt.gasUsed.toString());

    const balanceAfterCheap = await usdc.balanceOf(DEPLOYED_CONTRACT);
    console.log('\nContract Balance After:', ethers.utils.formatUnits(balanceAfterCheap, 6), 'USDC');
    
    const diff = balanceAfterCheap.sub(balanceBeforeCheap);
    console.log(`   Result: ${diff.isNegative() ? 'LOSS of' : 'PROFIT of'} ${ethers.utils.formatUnits(diff.abs(), 6)} USDC`);

  } catch (error: any) {
    console.error('\n   ❌ CHEAP scenario FAILED:', error.message);
  }

  console.log('\n' + '='.repeat(80));
  console.log('TESTING COMPLETE');
  console.log('='.repeat(80));

  const finalBalance = await usdc.balanceOf(DEPLOYED_CONTRACT);
  console.log('\nFinal Contract Balance:', ethers.utils.formatUnits(finalBalance, 6), 'USDC');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('\nTest failed:', error);
    process.exit(1);
  });


// scripts/deploy-vusd-arbitrage-robust.ts
// ROBUST VERSION: Handles timeouts, retries, and better error reporting

import { ethers, Contract } from 'ethers';
import { VusdArbitrage__factory } from '../typechain-types';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

dotenv.config();

const CURVE_POOL_ABI = [
  'function coins(uint256 i) external view returns (address)',
];

const POOL_ABI = [
  'function token0() external view returns (address)',
  'function token1() external view returns (address)',
];

async function main() {
  console.log('🚀 Starting ROBUST VUSD Arbitrage Contract Deployment...\n');

  // --- 1. Setup Provider and Wallet ---
  const rpcUrl = process.env.ETHEREUM_RPC_URL;
  const privateKey = process.env.SEARCHER_PRIVATE_KEY;

  if (!rpcUrl || !privateKey) {
    throw new Error('Missing ETHEREUM_RPC_URL or SEARCHER_PRIVATE_KEY in .env file');
  }

  console.log('🔌 Connecting to RPC...');
  const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
  
  // Test connection
  try {
    const network = await provider.getNetwork();
    console.log(`✅ Connected to ${network.name} (chainId: ${network.chainId})`);
  } catch (error) {
    console.error('❌ Failed to connect to RPC');
    throw error;
  }

  const wallet = new ethers.Wallet(privateKey, provider);
  console.log(`✅ Deployer wallet loaded: ${wallet.address}`);

  // Check balance
  const balance = await wallet.getBalance();
  const balanceEth = ethers.utils.formatEther(balance);
  console.log(`💰 Wallet balance: ${balanceEth} ETH`);
  
  if (balance.lt(ethers.utils.parseEther('0.003'))) {
    throw new Error(`Insufficient balance! Have ${balanceEth} ETH, need at least 0.003 ETH`);
  }

  // Check current gas price
  const gasPrice = await provider.getGasPrice();
  const gasPriceGwei = parseFloat(ethers.utils.formatUnits(gasPrice, 'gwei'));
  console.log(`⛽ Current gas price: ${gasPriceGwei.toFixed(3)} gwei`);

  // --- 2. Load Contract Addresses from .env ---
  console.log('\n📋 Loading configuration...');
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

  for (const [key, value] of Object.entries(addresses)) {
    if (!value) throw new Error(`Missing ${key.toUpperCase()} address in .env file`);
  }
  console.log('✅ All required addresses loaded');

  // --- 3. Discover Curve Pool Token Indices ---
  console.log('\n🔍 Discovering Curve pool token indices...');

  const crvUsdUsdcPool = new Contract(addresses.curveCrvusdUsdcPool, CURVE_POOL_ABI, provider);
  const crvUsdVusdPool = new Contract(addresses.curveCrvusdVusdPool, CURVE_POOL_ABI, provider);

  const usdcIndex = 0;
  const crvUsdIndexInUsdcPool = 1;
  
  const discoveredUsdcAddress = await crvUsdUsdcPool.coins(usdcIndex);
  const discoveredCrvUsdAddress1 = await crvUsdUsdcPool.coins(crvUsdIndexInUsdcPool);

  if (discoveredUsdcAddress.toLowerCase() !== addresses.usdc.toLowerCase()) {
    throw new Error(`CRITICAL: crvUSD/USDC pool index 0 is NOT USDC!`);
  }
  if (discoveredCrvUsdAddress1.toLowerCase() !== addresses.crvUsd.toLowerCase()) {
    throw new Error(`CRITICAL: crvUSD/USDC pool index 1 is NOT crvUSD!`);
  }
  console.log(`   ✅ crvUSD/USDC Pool verified`);

  const crvUsdIndexInVusdPool = 0;
  const vusdIndex = 1;
  
  const discoveredCrvUsdAddress2 = await crvUsdVusdPool.coins(crvUsdIndexInVusdPool);
  const discoveredVusdAddress = await crvUsdVusdPool.coins(vusdIndex);

  if (discoveredCrvUsdAddress2.toLowerCase() !== addresses.crvUsd.toLowerCase()) {
    throw new Error(`CRITICAL: crvUSD/VUSD pool index 0 is NOT crvUSD!`);
  }
  if (discoveredVusdAddress.toLowerCase() !== addresses.vusd.toLowerCase()) {
    throw new Error(`CRITICAL: crvUSD/VUSD pool index 1 is NOT VUSD!`);
  }
  console.log(`   ✅ crvUSD/VUSD Pool verified`);

  // --- 4. Detect USDC Position ---
  console.log('\n🔍 Detecting USDC position in Uniswap V3 pool...');

  const poolContract = new Contract(addresses.defaultUniswapV3Pool, POOL_ABI, provider);
  
  const token0Address = await poolContract.token0();
  const token1Address = await poolContract.token1();

  let usdcIsToken1: boolean;
  if (token0Address.toLowerCase() === addresses.usdc.toLowerCase()) {
    usdcIsToken1 = false;
    console.log('   ✅ USDC is token0');
  } else if (token1Address.toLowerCase() === addresses.usdc.toLowerCase()) {
    usdcIsToken1 = true;
    console.log('   ✅ USDC is token1');
  } else {
    throw new Error(`CRITICAL: Pool does not contain USDC!`);
  }

  // --- 5. Deploy the Contract ---
  console.log('\n🚢 Deploying VusdArbitrage contract...');
  console.log('─'.repeat(80));
  
  const vusdArbitrageFactory = new VusdArbitrage__factory(wallet);

  // Get current nonce
  const nonce = await wallet.getTransactionCount();
  console.log(`Current nonce: ${nonce}`);

  // Deploy with explicit gas settings
  console.log('Creating deployment transaction...');
  const contract = await vusdArbitrageFactory.deploy(
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
    vusdIndex,
    {
      gasLimit: 5000000,
      maxFeePerGas: gasPrice.mul(2), // 2x current gas price
      maxPriorityFeePerGas: ethers.utils.parseUnits('2', 'gwei'), // 2 gwei tip
      nonce: nonce,
    }
  );

  console.log(`\n📤 Transaction broadcast!`);
  console.log(`   Hash: ${contract.deployTransaction.hash}`);
  console.log(`   From: ${contract.deployTransaction.from}`);
  console.log(`   Nonce: ${contract.deployTransaction.nonce}`);
  console.log(`   Gas Limit: ${contract.deployTransaction.gasLimit?.toString()}`);
  
  console.log('\n⏳ Waiting for transaction to be mined...');
  console.log('   (This may take 15-30 seconds)');
  
  // Wait with timeout
  let receipt;
  try {
    receipt = await Promise.race([
      contract.deployTransaction.wait(1),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Timeout waiting for confirmation')), 120000)
      )
    ]) as any;
  } catch (error: any) {
    if (error.message.includes('Timeout')) {
      console.log('\n⚠️  Transaction taking longer than expected...');
      console.log(`   Check status on Etherscan:`);
      console.log(`   https://etherscan.io/tx/${contract.deployTransaction.hash}`);
      throw error;
    }
    throw error;
  }

  console.log('\n✅ Transaction mined!');
  console.log(`   Block: ${receipt.blockNumber}`);
  console.log(`   Gas Used: ${receipt.gasUsed.toString()}`);
  console.log(`   Status: ${receipt.status === 1 ? 'SUCCESS ✅' : 'FAILED ❌'}`);

  if (receipt.status !== 1) {
    throw new Error('Deployment transaction failed on-chain');
  }

  const contractAddress = receipt.contractAddress;
  
  console.log('\n🎉🎉🎉 CONTRACT DEPLOYED SUCCESSFULLY! 🎉🎉🎉\n');
  console.log('╔════════════════════════════════════════════════╗');
  console.log(`║  CONTRACT ADDRESS:                             ║`);
  console.log(`║  ${contractAddress}  ║`);
  console.log('╚════════════════════════════════════════════════╝');
  console.log('');
  console.log(`View on Etherscan: https://etherscan.io/address/${contractAddress}`);

  // --- 6. Save Deployment Info ---
  const deploymentInfo = {
    address: contractAddress,
    network: (await provider.getNetwork()).name,
    chainId: (await provider.getNetwork()).chainId,
    deployer: wallet.address,
    defaultUniswapV3Pool: addresses.defaultUniswapV3Pool,
    usdcIsToken1: usdcIsToken1,
    timestamp: new Date().toISOString(),
    transactionHash: contract.deployTransaction.hash,
    blockNumber: receipt.blockNumber,
    gasUsed: receipt.gasUsed.toString(),
  };

  const deploymentsDir = path.join(__dirname, '..', 'deployments');
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir);
  }
  
  const deploymentFilePath = path.join(deploymentsDir, `VusdArbitrage-${deploymentInfo.chainId}.json`);
  fs.writeFileSync(
    deploymentFilePath,
    JSON.stringify(deploymentInfo, null, 2)
  );

  console.log(`\n✅ Deployment info saved to ${deploymentFilePath}`);
  
  // Display summary
  console.log('\n' + '='.repeat(80));
  console.log('DEPLOYMENT SUMMARY');
  console.log('='.repeat(80));
  console.log(`Network:              ${deploymentInfo.network}`);
  console.log(`Chain ID:             ${deploymentInfo.chainId}`);
  console.log(`Deployer:             ${wallet.address}`);
  console.log(`Contract:             ${contractAddress}`);
  console.log(`Transaction:          ${contract.deployTransaction.hash}`);
  console.log(`Block:                ${receipt.blockNumber}`);
  console.log(`Gas Used:             ${receipt.gasUsed.toString()}`);
  console.log(`Gas Price:            ${gasPriceGwei.toFixed(3)} gwei`);
  console.log('');
  console.log('Pool Configuration:');
  console.log(`  Default Pool:       ${addresses.defaultUniswapV3Pool}`);
  console.log(`  USDC Position:      token${usdcIsToken1 ? '1' : '0'}`);
  console.log('');
  console.log('Curve Pool Indices:');
  console.log(`  crvUSD/USDC:        USDC=${usdcIndex}, crvUSD=${crvUsdIndexInUsdcPool}`);
  console.log(`  crvUSD/VUSD:        crvUSD=${crvUsdIndexInVusdPool}, VUSD=${vusdIndex}`);
  console.log('='.repeat(80));
  console.log('');
  console.log('✅ Deployment complete!');
  console.log('');
  console.log('Next steps:');
  console.log('  1. Verify contract on Etherscan (optional but recommended)');
  console.log('  2. Fund contract with small amount of USDC for testing');
  console.log('  3. Execute test trade via Etherscan Write Contract tab');
  console.log('');
}

main().catch((error) => {
  console.error('\n💥 Deployment failed:');
  console.error(error.message);
  if (error.transaction) {
    console.error('\nTransaction details:');
    console.error('  Hash:', error.transaction.hash || 'not sent');
    console.error('  From:', error.transaction.from);
    console.error('  Nonce:', error.transaction.nonce);
  }
  process.exitCode = 1;
});

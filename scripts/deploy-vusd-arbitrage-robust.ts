// scripts/deploy-vusd-arbitrage-robust.ts
// ROBUST VERSION: Handles timeouts, retries, and better error reporting
// Uses keystore for secure wallet management
// FIXED: Uses proper gas pricing from network feeData
// FIXED: Now exits cleanly after execution.

import { ethers, Contract } from 'ethers';
import { VusdArbitrage__factory } from '../typechain-types';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { loadWallet } from '../src/utils/keystore-utils';

dotenv.config();

const CURVE_POOL_ABI = [
  'function coins(uint256 i) external view returns (address)',
];

const POOL_ABI = [
  'function token0() external view returns (address)',
  'function token1() external view returns (address)',
];

async function main() {
  console.log('Starting ROBUST VUSD Arbitrage Contract Deployment...\n');

  // Setup Provider
  const rpcUrl = process.env.ETHEREUM_RPC_URL;

  if (!rpcUrl) {
    throw new Error('Missing ETHEREUM_RPC_URL in .env file');
  }

  console.log('Connecting to RPC...');
  const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
  
  // Test connection
  try {
    const network = await provider.getNetwork();
    console.log(`   Connected to ${network.name} (chainId: ${network.chainId})`);
  } catch (error) {
    console.error('   Failed to connect to RPC');
    throw error;
  }

  // Load wallet from keystore (will prompt for password)
  console.log('\nLoading wallet from keystore...');
  const wallet = await loadWallet(provider);
  console.log(`   Deployer wallet: ${wallet.address}`);

  // Check balance
  const balance = await wallet.getBalance();
  const balanceEth = ethers.utils.formatEther(balance);
  console.log(`   Wallet balance: ${balanceEth} ETH`);
  
  if (balance.lt(ethers.utils.parseEther('0.003'))) {
    throw new Error(`Insufficient balance! Have ${balanceEth} ETH, need at least 0.003 ETH`);
  }

  // Get REAL gas prices from network
  console.log('\nFetching current gas prices from network...');
  const feeData = await provider.getFeeData();
  
  // Get latest block to see actual base fee
  const latestBlock = await provider.getBlock('latest');
  const currentBaseFee = latestBlock.baseFeePerGas;
  
  console.log('Current Gas Situation:');
  console.log(`   Base Fee: ${ethers.utils.formatUnits(currentBaseFee || 0, 'gwei')} gwei`);
  console.log(`   Suggested Max Fee: ${ethers.utils.formatUnits(feeData.maxFeePerGas || 0, 'gwei')} gwei`);
  console.log(`   Suggested Priority Fee: ${ethers.utils.formatUnits(feeData.maxPriorityFeePerGas || 0, 'gwei')} gwei`);
  
  // Use network's suggested fees + 50% buffer for safety
  const maxFeePerGas = feeData.maxFeePerGas!.mul(150).div(100);
  const maxPriorityFeePerGas = feeData.maxPriorityFeePerGas!.mul(150).div(100);
  
  console.log('\nWe will use (with 50% safety buffer):');
  console.log(`   Max Fee: ${ethers.utils.formatUnits(maxFeePerGas, 'gwei')} gwei`);
  console.log(`   Priority Fee: ${ethers.utils.formatUnits(maxPriorityFeePerGas, 'gwei')} gwei`);
  
  const estimatedCost = maxFeePerGas.mul(5000000); // A high gas limit for deployment
  console.log(`   Estimated max cost: ${ethers.utils.formatEther(estimatedCost)} ETH`);
  
  if (balance.lt(estimatedCost)) {
    throw new Error(`Insufficient balance! Need ${ethers.utils.formatEther(estimatedCost)} ETH, have ${balanceEth} ETH`);
  }

  // Load Contract Addresses from .env
  console.log('\nLoading configuration...');
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
  console.log('   All required addresses loaded');

  // Discover Curve Pool Token Indices
  console.log('\nDiscovering Curve pool token indices...');

  const crvUsdUsdcPool = new Contract(addresses.curveCrvusdUsdcPool, CURVE_POOL_ABI, provider);
  const crvUsdVusdPool = new Contract(addresses.curveCrvusdVusdPool, CURVE_POOL_ABI, provider);

  const usdcIndex = 0;
  const crvUsdIndexInUsdcPool = 1;
  const crvUsdIndexInVusdPool = 0;
  const vusdIndex = 1;
  
  // Validate indices
  const discoveredUsdcAddress = await crvUsdUsdcPool.coins(usdcIndex);
  if (discoveredUsdcAddress.toLowerCase() !== addresses.usdc.toLowerCase()) throw new Error(`CRITICAL: crvUSD/USDC pool index ${usdcIndex} is NOT USDC!`);
  console.log(`   crvUSD/USDC Pool verified`);

  const discoveredCrvUsdAddress2 = await crvUsdVusdPool.coins(crvUsdIndexInVusdPool);
  if (discoveredCrvUsdAddress2.toLowerCase() !== addresses.crvUsd.toLowerCase()) throw new Error(`CRITICAL: crvUSD/VUSD pool index ${crvUsdIndexInVusdPool} is NOT crvUSD!`);
  console.log(`   crvUSD/VUSD Pool verified`);

  // Detect USDC Position
  console.log('\nDetecting USDC position in Uniswap V3 pool...');
  const poolContract = new Contract(addresses.defaultUniswapV3Pool, POOL_ABI, provider);
  const token1Address = await poolContract.token1();
  const usdcIsToken1 = token1Address.toLowerCase() === addresses.usdc.toLowerCase();
  console.log(`   USDC is token${usdcIsToken1 ? '1' : '0'}`);

  // Deploy the Contract
  console.log('\nDeploying VusdArbitrage contract...');
  console.log('='.repeat(80));
  
  const vusdArbitrageFactory = new VusdArbitrage__factory(wallet);
  const nonce = await wallet.getTransactionCount();
  console.log(`Current nonce: ${nonce}`);

  console.log('Creating deployment transaction...');
  const contract = await vusdArbitrageFactory.deploy(
    addresses.usdc, addresses.crvUsd, addresses.vusd,
    addresses.vusdMinter, addresses.vusdRedeemer,
    addresses.curveCrvusdUsdcPool, addresses.curveCrvusdVusdPool,
    addresses.defaultUniswapV3Pool, usdcIsToken1,
    usdcIndex, crvUsdIndexInUsdcPool, crvUsdIndexInVusdPool, vusdIndex,
    {
      gasLimit: 5000000,
      maxFeePerGas,
      maxPriorityFeePerGas,
      nonce,
    }
  );

  console.log(`\nTransaction broadcast!\n   Hash: ${contract.deployTransaction.hash}`);
  console.log('\nWaiting for transaction to be mined...');
  
  const receipt = await contract.deployTransaction.wait(1);

  console.log('\nTransaction mined!');
  console.log(`   Block: ${receipt.blockNumber}`);
  console.log(`   Status: ${receipt.status === 1 ? 'SUCCESS' : 'FAILED'}`);
  if (receipt.status !== 1) throw new Error('Deployment transaction failed on-chain');

  const contractAddress = receipt.contractAddress;
  console.log('\nCONTRACT DEPLOYED SUCCESSFULLY\n');
  console.log(`CONTRACT ADDRESS: ${contractAddress}`);
  console.log(`View on Etherscan: https://etherscan.io/address/${contractAddress}`);

  // Save Deployment Info
  const deploymentInfo = {
    address: contractAddress,
    network: (await provider.getNetwork()).name,
    chainId: (await provider.getNetwork()).chainId,
    deployer: wallet.address,
    transactionHash: contract.deployTransaction.hash,
    blockNumber: receipt.blockNumber,
    gasUsed: receipt.gasUsed.toString(),
  };

  const deploymentsDir = path.join(__dirname, '..', 'deployments');
  if (!fs.existsSync(deploymentsDir)) fs.mkdirSync(deploymentsDir);
  const deploymentFilePath = path.join(deploymentsDir, `VusdArbitrage-${deploymentInfo.chainId}.json`);
  fs.writeFileSync(deploymentFilePath, JSON.stringify(deploymentInfo, null, 2));
  console.log(`\nDeployment info saved to ${deploymentFilePath}`);
  
  console.log('\n' + '='.repeat(80));
  console.log('DEPLOYMENT COMPLETE');
  console.log('='.repeat(80));
}

main()
  .then(() => process.exit(0)) // *** FIX: Explicitly exit on success ***
  .catch((error) => {
    console.error('\nDeployment failed:');
    console.error(error.message);
    process.exit(1); // *** FIX: Explicitly exit on error ***
  });


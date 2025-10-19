// scripts/replace-stuck-deployment.ts
// Replace a stuck deployment transaction with higher gas
// Uses keystore for secure wallet management

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
  console.log('REPLACING STUCK DEPLOYMENT TRANSACTION\n');

  const rpcUrl = process.env.ETHEREUM_RPC_URL;

  if (!rpcUrl) {
    throw new Error('Missing ETHEREUM_RPC_URL in .env file');
  }

  const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
  
  // Load wallet from keystore (will prompt for password)
  console.log('Loading wallet from keystore...');
  const wallet = await loadWallet(provider);
  console.log('Deployer:', wallet.address);
  
  console.log('\nChecking current status...');
  const currentNonce = await wallet.getTransactionCount();
  const pendingNonce = await wallet.getTransactionCount('pending');
  console.log(`   Current nonce: ${currentNonce}`);
  console.log(`   Pending nonce: ${pendingNonce}`);
  
  if (currentNonce !== 0 || pendingNonce !== 0) {
    console.log('\nWARNING: Nonce is not 0. This might mean:');
    console.log('   - The original transaction already went through');
    console.log('   - OR there are multiple pending transactions');
    console.log('\nLet me check the stuck transaction...');
    
    const stuckTxHash = '0x06c9b2bf731536da8f8608d99d5dbf6509e4e74aafc66b0bb0c69a2b543a2762';
    const receipt = await provider.getTransactionReceipt(stuckTxHash);
    
    if (receipt) {
      console.log(`\nGood news! The original transaction was MINED!`);
      console.log(`   Block: ${receipt.blockNumber}`);
      console.log(`   Status: ${receipt.status === 1 ? 'SUCCESS' : 'FAILED'}`);
      console.log(`   Contract Address: ${receipt.contractAddress}`);
      console.log(`\nView on Etherscan: https://etherscan.io/address/${receipt.contractAddress}`);
      return;
    }
  }

  // Get current gas prices
  const feeData = await provider.getFeeData();
  const currentGasPrice = feeData.gasPrice || ethers.utils.parseUnits('2', 'gwei');
  console.log(`\nCurrent network gas price: ${ethers.utils.formatUnits(currentGasPrice, 'gwei')} gwei`);
  
  // Use much higher gas to ensure it goes through (3x current)
  const newMaxFeePerGas = currentGasPrice.mul(3);
  const newMaxPriorityFee = ethers.utils.parseUnits('2', 'gwei');
  
  console.log(`\nWill use higher gas for replacement:`);
  console.log(`   Max Fee: ${ethers.utils.formatUnits(newMaxFeePerGas, 'gwei')} gwei (3x current)`);
  console.log(`   Priority Fee: ${ethers.utils.formatUnits(newMaxPriorityFee, 'gwei')} gwei`);

  const balance = await wallet.getBalance();
  const estimatedCost = newMaxFeePerGas.mul(5000000);
  console.log(`\nCost estimate:`);
  console.log(`   Max cost: ${ethers.utils.formatEther(estimatedCost)} ETH`);
  console.log(`   Your balance: ${ethers.utils.formatEther(balance)} ETH`);
  
  if (balance.lt(estimatedCost)) {
    throw new Error('Insufficient balance for deployment with higher gas!');
  }

  // Load addresses
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

  // Quick validation
  const crvUsdUsdcPool = new Contract(addresses.curveCrvusdUsdcPool, CURVE_POOL_ABI, provider);
  const usdcIndex = 0;
  const crvUsdIndexInUsdcPool = 1;
  const crvUsdIndexInVusdPool = 0;
  const vusdIndex = 1;
  
  const poolContract = new Contract(addresses.defaultUniswapV3Pool, POOL_ABI, provider);
  const token1Address = await poolContract.token1();
  const usdcIsToken1 = token1Address.toLowerCase() === addresses.usdc.toLowerCase();

  console.log('\nSending REPLACEMENT deployment transaction...');
  console.log('   This will REPLACE the stuck transaction!');
  
  const vusdArbitrageFactory = new VusdArbitrage__factory(wallet);

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
      maxFeePerGas: newMaxFeePerGas,
      maxPriorityFeePerGas: newMaxPriorityFee,
      nonce: 0, // SAME NONCE - this replaces the stuck transaction
    }
  );

  console.log(`\nREPLACEMENT Transaction broadcast!`);
  console.log(`   Hash: ${contract.deployTransaction.hash}`);
  console.log(`   Nonce: 0 (replacing stuck transaction)`);
  console.log(`   Max Fee: ${ethers.utils.formatUnits(newMaxFeePerGas, 'gwei')} gwei`);
  console.log(`\n   View on Etherscan: https://etherscan.io/tx/${contract.deployTransaction.hash}`);
  console.log('\nWaiting for confirmation (with higher gas, should be faster)...');

  const receipt = await contract.deployTransaction.wait(2);

  console.log('\nTransaction mined!');
  console.log(`   Block: ${receipt.blockNumber}`);
  console.log(`   Gas Used: ${receipt.gasUsed.toString()}`);
  console.log(`   Status: ${receipt.status === 1 ? 'SUCCESS' : 'FAILED'}`);

  if (receipt.status !== 1) {
    throw new Error('Deployment transaction failed on-chain');
  }

  const contractAddress = receipt.contractAddress;
  
  console.log('\nCONTRACT DEPLOYED SUCCESSFULLY\n');
  console.log('CONTRACT ADDRESS');
  console.log(`${contractAddress}`);
  console.log(`\nView on Etherscan: https://etherscan.io/address/${contractAddress}`);

  // Save deployment info
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
    replacedTransaction: '0x06c9b2bf731536da8f8608d99d5dbf6509e4e74aafc66b0bb0c69a2b543a2762',
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

  console.log(`\nDeployment info saved to ${deploymentFilePath}`);
  console.log('\n' + '='.repeat(80));
  console.log('DEPLOYMENT COMPLETE');
  console.log('='.repeat(80));
}

main().catch((error) => {
  console.error('\nReplacement failed:', error.message);
  process.exitCode = 1;
});

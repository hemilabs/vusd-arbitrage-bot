// scripts/check-balance.ts
// Quick script to check wallet balance on any network

import { ethers } from 'ethers';
import * as dotenv from 'dotenv';

dotenv.config();

async function main() {
  console.log('🔍 Checking Wallet Balance...\n');

  // Get network from command line or default to tenderly
  const network = process.argv[2] || 'tenderly';
  
  // Get RPC URL based on network
  let rpcUrl: string;
  if (network === 'tenderly') {
    rpcUrl = 'https://virtual.mainnet.eu.rpc.tenderly.co/8d322a00-ec8f-4c00-8734-d9bb730566e0';
  } else if (network === 'mainnet') {
    rpcUrl = process.env.ETHEREUM_RPC_URL || '';
  } else {
    throw new Error(`Unknown network: ${network}`);
  }

  console.log(`🌐 Network: ${network}`);
  console.log(`📡 RPC: ${rpcUrl.substring(0, 50)}...`);

  const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
  const privateKey = process.env.SEARCHER_PRIVATE_KEY;
  
  if (!privateKey) {
    throw new Error('Missing SEARCHER_PRIVATE_KEY');
  }

  const wallet = new ethers.Wallet(privateKey, provider);
  
  console.log(`\n💼 Address: ${wallet.address}`);
  
  const balance = await wallet.getBalance();
  const balanceEth = ethers.utils.formatEther(balance);
  
  console.log(`💰 Balance: ${balanceEth} ETH`);
  
  // Get network info
  const networkInfo = await provider.getNetwork();
  console.log(`\n📊 Network Info:`);
  console.log(`   Chain ID: ${networkInfo.chainId}`);
  console.log(`   Name: ${networkInfo.name || 'unknown'}`);
  
  // Check nonce
  const nonce = await wallet.getTransactionCount();
  console.log(`\n🔢 Transaction Count: ${nonce}`);
  
  // Get gas price
  const gasPrice = await provider.getGasPrice();
  const gasPriceGwei = parseFloat(ethers.utils.formatUnits(gasPrice, 'gwei'));
  console.log(`⛽ Current Gas Price: ${gasPriceGwei.toFixed(3)} gwei`);
  
  // Estimate deployment cost
  const estimatedGas = 5000000;
  const maxCost = gasPrice.mul(2).mul(estimatedGas); // 2x gas price for buffer
  const maxCostEth = ethers.utils.formatEther(maxCost);
  console.log(`\n💸 Estimated Max Deployment Cost: ${maxCostEth} ETH`);
  
  if (balance.gt(maxCost)) {
    console.log('✅ Sufficient balance for deployment!');
  } else {
    console.log('❌ Insufficient balance for deployment');
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('❌ Error:', error.message);
    process.exit(1);
  });

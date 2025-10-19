// scripts/test-env.ts
// Validates environment configuration and keystore setup
// Tests RPC connection, keystore loading, and wallet balance

import * as dotenv from 'dotenv';
import { ethers } from 'ethers';
import { loadWallet } from '../src/utils/keystore-utils';
import { promises as fs } from 'fs';

dotenv.config();

async function main() {
  console.log('Testing Environment Configuration...\n');

  // Check ETHEREUM_RPC_URL
  const rpcUrl = process.env.ETHEREUM_RPC_URL;
  if (!rpcUrl) {
    console.error('ERROR: ETHEREUM_RPC_URL is not set in .env file');
    process.exit(1);
  }
  console.log(`ETHEREUM_RPC_URL is set`);
  console.log(`   ${rpcUrl.substring(0, 40)}...`);

  // Check TENDERLY_RPC_URL
  const tenderlyRpcUrl = process.env.TENDERLY_RPC_URL;
  if (!tenderlyRpcUrl) {
    console.error('WARNING: TENDERLY_RPC_URL is not set in .env file');
    console.log('   Add it for Tenderly testing');
  } else {
    console.log(`TENDERLY_RPC_URL is set`);
    console.log(`   ${tenderlyRpcUrl.substring(0, 40)}...`);
  }

  // Check KEYSTORE_PATH
  const keystorePath = process.env.KEYSTORE_PATH;
  if (!keystorePath) {
    console.error('\nERROR: KEYSTORE_PATH is not set in .env file');
    console.error('Please add: KEYSTORE_PATH=./keystore/searcher.json');
    process.exit(1);
  }
  
  console.log(`\nKEYSTORE_PATH is set`);
  console.log(`   ${keystorePath}`);
  
  // Check if keystore file exists
  try {
    await fs.access(keystorePath);
    console.log(`   Keystore file exists`);
  } catch (error) {
    console.error(`\nERROR: Keystore file not found at: ${keystorePath}`);
    console.error('Create it with: yarn ts-node scripts/create-keystore.ts');
    process.exit(1);
  }

  // Test RPC connection
  console.log('\nTesting RPC connection...');
  try {
    const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
    const network = await provider.getNetwork();
    console.log(`   Connected to ${network.name} (chainId: ${network.chainId})`);
    
    const blockNumber = await provider.getBlockNumber();
    console.log(`   Current block: ${blockNumber}`);
    
    const gasPrice = await provider.getGasPrice();
    const gasPriceGwei = parseFloat(ethers.utils.formatUnits(gasPrice, 'gwei'));
    console.log(`   Gas price: ${gasPriceGwei.toFixed(3)} gwei`);
    
  } catch (error: any) {
    console.error('\nERROR: RPC connection failed:', error.message);
    process.exit(1);
  }

  // Test keystore wallet loading
  console.log('\nTesting keystore wallet...');
  console.log('   You will be prompted for your keystore password\n');
  
  try {
    const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
    const wallet = await loadWallet(provider);
    console.log(`\n   Wallet loaded successfully`);
    console.log(`   Address: ${wallet.address}`);
    
    const balance = await wallet.getBalance();
    const balanceEth = ethers.utils.formatEther(balance);
    console.log(`   Balance: ${balanceEth} ETH`);
    
    if (balance.lt(ethers.utils.parseEther('0.003'))) {
      console.warn(`   WARNING: Balance is low (need ~0.003 ETH for deployment)`);
    } else {
      console.log(`   Balance is sufficient for deployment`);
    }
    
    // Test transaction count
    const txCount = await wallet.getTransactionCount();
    const pendingTxCount = await wallet.getTransactionCount('pending');
    console.log(`   Transaction count: ${txCount} (pending: ${pendingTxCount})`);
    
  } catch (error: any) {
    console.error('\nERROR: Keystore wallet test failed:', error.message);
    process.exit(1);
  }

  console.log('\nALL CHECKS PASSED');
  console.log('\nYou can now deploy with:');
  console.log('  yarn hardhat run scripts/deploy-tenderly.ts --network tenderly');
  console.log('  OR');
  console.log('  yarn ts-node scripts/deploy-vusd-arbitrage-robust.ts');
}

main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});

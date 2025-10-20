// scripts/test-keystore.ts
// Simple test to verify keystore loading works correctly
// This should be run FIRST before updating other scripts

import * as dotenv from 'dotenv';
import { ethers } from 'ethers';
import { loadWallet } from '../src/utils/keystore-utils';

dotenv.config();

async function main() {
  console.log('Testing Keystore Loading...\n');
  
  // Step 1: Check KEYSTORE_PATH is set
  console.log('Step 1: Checking environment...');
  const keystorePath = process.env.KEYSTORE_PATH;
  
  if (!keystorePath) {
    console.error('ERROR: KEYSTORE_PATH not set in .env file');
    console.error('Please add: KEYSTORE_PATH=./keystore/searcher.json');
    process.exit(1);
  }
  
  console.log(`   KEYSTORE_PATH: ${keystorePath}`);
  
  // Step 2: Load wallet from keystore (will prompt for password)
  console.log('\nStep 2: Loading wallet from keystore...');
  console.log('   You will be prompted for your keystore password\n');
  
  try {
    const wallet = await loadWallet();
    console.log('\n   SUCCESS: Wallet loaded from keystore');
    console.log(`   Address: ${wallet.address}`);
  } catch (error: any) {
    console.error('\n   ERROR: Failed to load wallet');
    console.error(`   ${error.message}`);
    process.exit(1);
  }
  
  // Step 3: Test with provider connection
  console.log('\nStep 3: Testing wallet with provider...');
  const rpcUrl = process.env.ETHEREUM_RPC_URL;
  
  if (!rpcUrl) {
    console.error('   WARNING: ETHEREUM_RPC_URL not set, skipping provider test');
  } else {
    try {
      const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
      const wallet = await loadWallet(provider);
      
      const balance = await wallet.getBalance();
      const network = await provider.getNetwork();
      
      console.log('   SUCCESS: Wallet connected to provider');
      console.log(`   Network: ${network.name} (Chain ID: ${network.chainId})`);
      console.log(`   Balance: ${ethers.utils.formatEther(balance)} ETH`);
    } catch (error: any) {
      console.error('   ERROR: Failed to connect to provider');
      console.error(`   ${error.message}`);
      process.exit(1);
    }
  }
  
  // Success
  console.log('\nALL TESTS PASSED');
  console.log('Keystore utility is working correctly');
  console.log('\nYou can now proceed to update other scripts\n');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('\nTest failed:', error);
    process.exit(1);
  });

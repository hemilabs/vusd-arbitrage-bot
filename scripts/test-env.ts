// scripts/test-env.ts
// Quick script to test environment variables and RPC connection

import * as dotenv from 'dotenv';
import { ethers } from 'ethers';

dotenv.config();

async function main() {
  console.log('🔍 Testing Environment Configuration...\n');

  // Check ETHEREUM_RPC_URL
  const rpcUrl = process.env.ETHEREUM_RPC_URL;
  if (!rpcUrl) {
    console.error('❌ ETHEREUM_RPC_URL is not set in .env file');
    process.exit(1);
  }
  console.log(`✅ ETHEREUM_RPC_URL is set`);
  console.log(`   ${rpcUrl.substring(0, 40)}...`);

  // Check SEARCHER_PRIVATE_KEY
  const privateKey = process.env.SEARCHER_PRIVATE_KEY;
  if (!privateKey) {
    console.error('❌ SEARCHER_PRIVATE_KEY is not set in .env file');
    process.exit(1);
  }
  
  if (!privateKey.startsWith('0x')) {
    console.error('❌ SEARCHER_PRIVATE_KEY must start with 0x');
    process.exit(1);
  }
  
  if (privateKey.length !== 66) {
    console.error(`❌ SEARCHER_PRIVATE_KEY has wrong length: ${privateKey.length} (should be 66)`);
    process.exit(1);
  }
  
  console.log(`✅ SEARCHER_PRIVATE_KEY is set (length: ${privateKey.length})`);
  console.log(`   ${privateKey.substring(0, 10)}...${privateKey.substring(62)}`);

  // Test RPC connection
  console.log('\n🔌 Testing RPC connection...');
  try {
    const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
    const network = await provider.getNetwork();
    console.log(`✅ Connected to ${network.name} (chainId: ${network.chainId})`);
    
    const blockNumber = await provider.getBlockNumber();
    console.log(`✅ Current block: ${blockNumber}`);
    
    const gasPrice = await provider.getGasPrice();
    const gasPriceGwei = parseFloat(ethers.utils.formatUnits(gasPrice, 'gwei'));
    console.log(`✅ Gas price: ${gasPriceGwei.toFixed(3)} gwei`);
    
    // Test wallet
    console.log('\n👛 Testing wallet...');
    const wallet = new ethers.Wallet(privateKey, provider);
    console.log(`✅ Wallet address: ${wallet.address}`);
    
    const balance = await wallet.getBalance();
    const balanceEth = ethers.utils.formatEther(balance);
    console.log(`✅ Wallet balance: ${balanceEth} ETH`);
    
    if (balance.lt(ethers.utils.parseEther('0.003'))) {
      console.warn(`⚠️  Warning: Balance is low (need ~0.003 ETH for deployment)`);
    }
    
    // Test transaction count
    const txCount = await wallet.getTransactionCount();
    const pendingTxCount = await wallet.getTransactionCount('pending');
    console.log(`✅ Transaction count: ${txCount} (pending: ${pendingTxCount})`);
    
    console.log('\n✅ ALL CHECKS PASSED!');
    console.log('\nYou can now deploy with:');
    console.log('  npx ts-node scripts/deploy-vusd-arbitrage-robust.ts');
    
  } catch (error: any) {
    console.error('\n❌ RPC connection failed:', error.message);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});

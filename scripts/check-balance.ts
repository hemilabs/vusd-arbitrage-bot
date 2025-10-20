// scripts/check-balance.ts
// Check wallet balance on different networks
// Now uses encrypted keystore instead of plaintext private key

import { ethers } from 'ethers';
import * as dotenv from 'dotenv';
import { loadWallet } from '../src/utils/keystore-utils';

dotenv.config();

async function main() {
  const args = process.argv.slice(2);
  const network = args[0] || 'mainnet';

  console.log(`Checking balance on ${network}...\n`);

  let rpcUrl: string;
  let networkName: string;

  if (network === 'tenderly') {
    rpcUrl = process.env.TENDERLY_RPC_URL || '';
    if (!rpcUrl) {
      throw new Error('TENDERLY_RPC_URL not set in .env file');
    }
    networkName = 'Tenderly Fork';
  } else if (network === 'mainnet') {
    rpcUrl = process.env.ETHEREUM_RPC_URL || '';
    if (!rpcUrl) {
      throw new Error('ETHEREUM_RPC_URL not set in .env file');
    }
    networkName = 'Ethereum Mainnet';
  } else {
    throw new Error(`Unknown network: ${network}. Use 'mainnet' or 'tenderly'`);
  }

  // Create provider
  const provider = new ethers.providers.JsonRpcProvider(rpcUrl);

  // Load wallet from keystore (will prompt for password)
  console.log('Loading wallet from keystore...');
  const wallet = await loadWallet(provider);

  console.log(`Network: ${networkName}`);
  console.log(`Wallet: ${wallet.address}\n`);

  // Get balance
  const balance = await wallet.getBalance();
  const balanceEth = ethers.utils.formatEther(balance);

  console.log(`Balance: ${balanceEth} ETH`);

  // Get network info
  const networkInfo = await provider.getNetwork();
  console.log(`Chain ID: ${networkInfo.chainId}`);

  // Get block number
  const blockNumber = await provider.getBlockNumber();
  console.log(`Block: ${blockNumber}`);

  console.log('\nBalance check complete!');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('\nError:', error.message);
    process.exit(1);
  });

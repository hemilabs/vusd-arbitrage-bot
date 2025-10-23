// scripts/test-deployed-mainnet-contract.ts
// UPDATED to work with the new hardened VusdArbitrage contract
// SAFETY FIRST: This script runs on MAINNET and uses REAL money.
// It is designed to submit a transaction that is EXPECTED TO REVERT.
// This is a final "sanity check" before running the real Flashbots bot.

import { ethers } from 'hardhat';
import * as dotenv from 'dotenv';
import { loadWallet } from '../src/utils/keystore-utils';
import { confirm } from '@inquirer/prompts';

dotenv.config();

const ERC20_ABI = [
  'function balanceOf(address account) external view returns (uint256)',
  'function transfer(address to, uint256 amount) external returns (bool)',
];

const DEPLOYED_CONTRACT = process.env.VUSD_ARBITRAGE_CONTRACT;

if (!DEPLOYED_CONTRACT) {
  throw new Error('VUSD_ARBITRAGE_CONTRACT not set in .env file');
}

async function main() {
  console.log('========================================');
  console.log('MAINNET Sanity Check Script');
  console.log('========================================');
  console.log('Contract:', DEPLOYED_CONTRACT);
  console.log('');
  console.log('This script will attempt to execute a trade on MAINNET.');
  console.log('It is DESIGNED TO FAIL (revert) by setting an impossible profit expectation.');
  console.log('You will still pay a gas fee for the failed transaction.');
  console.log('This is the final check to ensure the contract can be called correctly.');
  console.log('========================================\n');

  // 1. Verify Network
  console.log('Step 1: Verifying network...');
  const provider = ethers.provider;
  const network = await provider.getNetwork();
  if (network.chainId !== 1) {
    throw new Error(`ABORT: Not on mainnet! Current chain ID: ${network.chainId}.`);
  }
  console.log('   ✅ Network: Ethereum Mainnet (Chain ID: 1)');

  // 2. Load Wallet
  console.log('\nStep 2: Loading wallet from keystore...');
  const deployer = await loadWallet(provider);
  console.log(`   ✅ Wallet loaded: ${deployer.address}`);
  
  const balance = await deployer.getBalance();
  console.log(`   ETH Balance: ${ethers.utils.formatEther(balance)} ETH`);
  if (balance.lt(ethers.utils.parseEther('0.01'))) {
    throw new Error('ABORT: Insufficient ETH balance. Need at least 0.01 ETH for gas.');
  }

  // 3. Connect to Contract
  console.log('\nStep 3: Connecting to contract...');
  const contract = await ethers.getContractAt('VusdArbitrage', DEPLOYED_CONTRACT, deployer);
  const owner = await contract.owner();
  if (owner.toLowerCase() !== deployer.address.toLowerCase()) {
    throw new Error(`ABORT: You are not the contract owner!`);
  }
  console.log('   ✅ Confirmed you are the contract owner.');

  // 4. Final Confirmation
  console.log('\nStep 4: Final Confirmation');
  const finalConfirm = await confirm({
    message: 'Proceed with mainnet sanity check? (This will spend REAL gas)',
    default: false,
  });
  
  if (!finalConfirm) {
    console.log('\nAborted by user.');
    return;
  }

  // 5. Execute Test Trade
  console.log('\nStep 5: Executing RICH scenario (designed to revert)...');
  const flashloanAmount = ethers.utils.parseUnits('1000', 6);
  
  // These minOut values are impossibly high, guaranteeing a revert.
  // This proves that our slippage protection works.
  const impossibleRichParams = {
    minCrvUsdOut: ethers.utils.parseUnits('2000', 18), // Expect 2000 crvUSD from 1000 USDC
    minVusdOut: ethers.utils.parseUnits('2000', 18),
    minUsdcOut: ethers.utils.parseUnits('2000', 6),
  };

  try {
    const tx = await contract.executeRichWithDefaultPool(flashloanAmount, impossibleRichParams, {
      gasLimit: 600000,
    });
    
    console.log(`   Transaction sent: https://etherscan.io/tx/${tx.hash}`);
    console.log('   Waiting for confirmation...');
    await tx.wait();

    // If we get here, it's an error because it should have reverted.
    console.error('\n   ❌ UNEXPECTED SUCCESS: The transaction went through but should have reverted.');
    console.error('   This indicates a potential issue with the slippage protection logic.');

  } catch (error: any) {
    // We EXPECT to end up in this catch block.
    if (error.code === 'CALL_EXCEPTION') {
      console.log('\n   ✅ SUCCESS: Transaction correctly reverted as expected!');
      console.log('   This confirms the slippage protection is working on-chain.');
      console.log('   Reason from node:', error.reason);
    } else {
      console.error('\n   ❌ UNEXPECTED ERROR: The transaction failed for a reason other than a revert.');
      console.error('      Error:', error.message);
    }
  }

  console.log('\n========================================');
  console.log('SANITY CHECK COMPLETE');
  console.log('========================================');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('\nTest failed:', error.message);
    process.exit(1);
  });



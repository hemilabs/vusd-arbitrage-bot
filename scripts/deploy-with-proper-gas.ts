// scripts/deploy-with-proper-gas.ts
// FINAL VERSION: Uses ACTUAL current gas prices from network
// Uses keystore for secure wallet management

import { ethers, Contract } from 'ethers';
import { VusdArbitrage__factory } from '../typechain-types';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { loadWallet } from '../src/utils/keystore-utils';

dotenv.config();

const CURVE_POOL_ABI = ['function coins(uint256 i) external view returns (address)'];
const POOL_ABI = ['function token0() external view returns (address)', 'function token1() external view returns (address)'];

async function main() {
  console.log('FINAL Deployment with PROPER Gas Pricing\n');

  const rpcUrl = process.env.ETHEREUM_RPC_URL;

  if (!rpcUrl) {
    throw new Error('Missing ETHEREUM_RPC_URL');
  }

  const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
  
  // Load wallet from keystore (will prompt for password)
  console.log('Loading wallet from keystore...');
  const wallet = await loadWallet(provider);
  console.log('Deployer:', wallet.address);
  
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
  
  const estimatedCost = maxFeePerGas.mul(5000000);
  console.log(`   Estimated max cost: ${ethers.utils.formatEther(estimatedCost)} ETH`);
  
  const balance = await wallet.getBalance();
  console.log(`   Your balance: ${ethers.utils.formatEther(balance)} ETH`);
  
  if (balance.lt(estimatedCost)) {
    throw new Error('Insufficient balance!');
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

  console.log('\nQuick validation...');
  const poolContract = new Contract(addresses.defaultUniswapV3Pool, POOL_ABI, provider);
  const token1Address = await poolContract.token1();
  const usdcIsToken1 = token1Address.toLowerCase() === addresses.usdc.toLowerCase();
  console.log(`   USDC is token${usdcIsToken1 ? '1' : '0'}`);

  const usdcIndex = 0;
  const crvUsdIndexInUsdcPool = 1;
  const crvUsdIndexInVusdPool = 0;
  const vusdIndex = 1;

  console.log('\nDeploying with PROPER gas pricing...');
  
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
      maxFeePerGas: maxFeePerGas,
      maxPriorityFeePerGas: maxPriorityFeePerGas,
      nonce: 0, // Replace stuck transactions
    }
  );

  console.log(`\nTransaction Broadcast!`);
  console.log(`   Hash: ${contract.deployTransaction.hash}`);
  console.log(`   Nonce: 0`);
  console.log(`   Max Fee: ${ethers.utils.formatUnits(maxFeePerGas, 'gwei')} gwei`);
  console.log(`   Priority Fee: ${ethers.utils.formatUnits(maxPriorityFeePerGas, 'gwei')} gwei`);
  console.log(`\n   This should go through IMMEDIATELY with proper gas!`);
  console.log(`\n   Watch on Etherscan: https://etherscan.io/tx/${contract.deployTransaction.hash}`);
  
  console.log('\nWaiting for confirmation (should be fast with proper gas)...');

  try {
    const receipt = await contract.deployTransaction.wait(2);
    
    console.log('\nSUCCESS\n');
    console.log('CONTRACT DEPLOYED');
    console.log(`${receipt.contractAddress}`);
    console.log('');
    console.log(`Etherscan: https://etherscan.io/address/${receipt.contractAddress}`);
    console.log(`Block: ${receipt.blockNumber}`);
    console.log(`Gas Used: ${receipt.gasUsed.toString()}`);
    console.log(`Actual Cost: ${ethers.utils.formatEther(receipt.gasUsed.mul(receipt.effectiveGasPrice))} ETH`);
    
    // Save deployment
    const deploymentInfo = {
      address: receipt.contractAddress,
      transactionHash: contract.deployTransaction.hash,
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed.toString(),
      deployer: wallet.address,
      timestamp: new Date().toISOString(),
    };
    
    const deploymentsDir = path.join(__dirname, '..', 'deployments');
    if (!fs.existsSync(deploymentsDir)) fs.mkdirSync(deploymentsDir);
    
    fs.writeFileSync(
      path.join(deploymentsDir, 'VusdArbitrage-1.json'),
      JSON.stringify(deploymentInfo, null, 2)
    );
    
    console.log('\nDeployment info saved to deployments/VusdArbitrage-1.json');
    console.log('\nALL DONE! Contract is live on mainnet!');
    
  } catch (error: any) {
    console.error('\nWait timed out, but transaction might still be processing...');
    console.log('Check status at: https://etherscan.io/tx/' + contract.deployTransaction.hash);
    console.log('Expected contract address: 0xcD04f54022822b6f7099308B4b9Ab96D1f1c05F5');
  }
}

main().catch((error) => {
  console.error('\nError:', error.message);
  process.exitCode = 1;
});

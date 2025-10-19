// scripts/deploy-tenderly.ts
// Deploy VusdArbitrage contract to Tenderly fork
// Uses keystore for secure wallet management

import { ethers } from 'hardhat';
import { VusdArbitrage__factory } from '../typechain-types';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { loadWallet } from '../src/utils/keystore-utils';

dotenv.config();

const POOL_ABI = [
  'function token0() external view returns (address)',
  'function token1() external view returns (address)'
];

async function main() {
  console.log('Deploying VusdArbitrage Contract to Tenderly\n');

  // Load wallet from keystore (will prompt for password)
  console.log('Loading wallet from keystore...');
  const deployer = await loadWallet(ethers.provider);
  console.log('Deployer:', deployer.address);

  // Get network info
  const network = await ethers.provider.getNetwork();
  console.log('Network:', network.name || `Chain ID ${network.chainId}`);
  console.log('Chain ID:', network.chainId);

  // Check balance
  const balance = await deployer.getBalance();
  console.log('Balance:', ethers.utils.formatEther(balance), 'ETH');

  // Get gas prices from network
  console.log('\nFetching gas prices...');
  const feeData = await ethers.provider.getFeeData();
  
  const latestBlock = await ethers.provider.getBlock('latest');
  const currentBaseFee = latestBlock.baseFeePerGas;
  
  console.log('Gas Situation:');
  console.log(`   Base Fee: ${ethers.utils.formatUnits(currentBaseFee || 0, 'gwei')} gwei`);
  console.log(`   Suggested Max Fee: ${ethers.utils.formatUnits(feeData.maxFeePerGas || 0, 'gwei')} gwei`);
  console.log(`   Suggested Priority Fee: ${ethers.utils.formatUnits(feeData.maxPriorityFeePerGas || 0, 'gwei')} gwei`);

  // Use network's suggested fees with 50% buffer
  const maxFeePerGas = feeData.maxFeePerGas!.mul(150).div(100);
  const maxPriorityFeePerGas = feeData.maxPriorityFeePerGas!.mul(150).div(100);

  console.log('\nUsing (with 50% buffer):');
  console.log(`   Max Fee: ${ethers.utils.formatUnits(maxFeePerGas, 'gwei')} gwei`);
  console.log(`   Priority Fee: ${ethers.utils.formatUnits(maxPriorityFeePerGas, 'gwei')} gwei`);

  const estimatedCost = maxFeePerGas.mul(5000000);
  console.log(`   Estimated max cost: ${ethers.utils.formatEther(estimatedCost)} ETH`);

  if (balance.lt(estimatedCost)) {
    throw new Error(`Insufficient balance! Need ${ethers.utils.formatEther(estimatedCost)} ETH, have ${ethers.utils.formatEther(balance)} ETH`);
  }

  // Load contract addresses
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

  // Validate USDC position in pool
  console.log('\nValidating pool configuration...');
  const poolContract = new ethers.Contract(addresses.defaultUniswapV3Pool, POOL_ABI, ethers.provider);
  const token1Address = await poolContract.token1();
  const usdcIsToken1 = token1Address.toLowerCase() === addresses.usdc.toLowerCase();
  console.log(`   Pool: ${addresses.defaultUniswapV3Pool}`);
  console.log(`   USDC is token${usdcIsToken1 ? '1' : '0'}`);

  // Curve pool indices
  const usdcIndex = 0;
  const crvUsdIndexInUsdcPool = 1;
  const crvUsdIndexInVusdPool = 0;
  const vusdIndex = 1;

  console.log('\nDeploying contract...');

  // Get contract factory with deployer as signer
  const VusdArbitrage = new VusdArbitrage__factory(deployer);

  // Get current nonce
  const nonce = await deployer.getTransactionCount();
  console.log(`   Current nonce: ${nonce}`);

  // Deploy with proper gas settings
  const contract = await VusdArbitrage.deploy(
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
    }
  );

  console.log('\nTransaction broadcast!');
  console.log(`   Hash: ${contract.deployTransaction.hash}`);
  console.log(`   Nonce: ${contract.deployTransaction.nonce}`);

  console.log('\nWaiting for confirmation...');
  await contract.deployed();

  console.log('\nSUCCESS\n');
  console.log('CONTRACT DEPLOYED');
  console.log(`Address: ${contract.address}`);

  // Get deployment receipt
  const receipt = await contract.deployTransaction.wait();
  console.log(`\nBlock: ${receipt.blockNumber}`);
  console.log(`Gas Used: ${receipt.gasUsed.toString()}`);
  console.log(`Actual Cost: ${ethers.utils.formatEther(receipt.gasUsed.mul(receipt.effectiveGasPrice))} ETH`);

  // Save deployment info
  const deploymentInfo = {
    address: contract.address,
    network: network.name || 'unknown',
    chainId: network.chainId,
    deployer: deployer.address,
    transactionHash: contract.deployTransaction.hash,
    blockNumber: receipt.blockNumber,
    gasUsed: receipt.gasUsed.toString(),
    timestamp: new Date().toISOString(),
    defaultPool: addresses.defaultUniswapV3Pool,
    usdcIsToken1: usdcIsToken1,
  };

  const deploymentsDir = path.join(__dirname, '..', 'deployments');
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir);
  }

  const filename = `VusdArbitrage-${network.chainId}.json`;
  fs.writeFileSync(
    path.join(deploymentsDir, filename),
    JSON.stringify(deploymentInfo, null, 2)
  );

  console.log(`\nDeployment info saved to deployments/${filename}`);

  // Network-specific links
  if (network.chainId === 1) {
    console.log(`\nView on Etherscan: https://etherscan.io/address/${contract.address}`);
  } else {
    console.log(`\nDeployed on network: ${network.name || network.chainId}`);
    console.log(`Contract address: ${contract.address}`);
  }

  console.log('\nDeployment complete!\n');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('\nDeployment failed:', error.message);
    process.exit(1);
  });

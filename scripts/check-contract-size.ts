// scripts/check-contract-size.ts
// Quick script to check contract bytecode size and estimate deployment cost

import * as fs from 'fs';
import * as path from 'path';
import { ethers } from 'ethers';

async function main() {
  console.log('📏 Checking VusdArbitrageBot Contract Size...\n');

  // Load the compiled artifact
  const artifactPath = path.join(
    __dirname,
    '..',
    'artifacts',
    'contracts',
    'VusdArbitrageBot.sol',
    'VusdArbitrageBot.json'
  );

  if (!fs.existsSync(artifactPath)) {
    console.error('❌ Contract not compiled yet. Run: yarn hardhat compile');
    process.exit(1);
  }

  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  
  // Get bytecode sizes
  const deployBytecode = artifact.bytecode;
  const runtimeBytecode = artifact.deployedBytecode;
  
  const deploySize = (deployBytecode.length - 2) / 2; // Remove '0x' and convert hex to bytes
  const runtimeSize = (runtimeBytecode.length - 2) / 2;
  
  const maxContractSize = 24576; // 24 KB limit (EIP-170)
  
  console.log('📦 Contract Bytecode Sizes:');
  console.log('─────────────────────────────────────────');
  console.log(`Deployment Bytecode:  ${deploySize.toLocaleString()} bytes`);
  console.log(`Runtime Bytecode:     ${runtimeSize.toLocaleString()} bytes`);
  console.log(`Contract Size Limit:  ${maxContractSize.toLocaleString()} bytes`);
  console.log(`Remaining Space:      ${(maxContractSize - runtimeSize).toLocaleString()} bytes`);
  console.log(`Usage:                ${((runtimeSize / maxContractSize) * 100).toFixed(2)}%`);
  
  if (runtimeSize > maxContractSize) {
    console.log('\n❌ CONTRACT TOO LARGE! Will not deploy.');
  } else if (runtimeSize > maxContractSize * 0.95) {
    console.log('\n⚠️  WARNING: Very close to size limit!');
  } else {
    console.log('\n✅ Contract size is within limits');
  }

  // Estimate deployment gas
  console.log('\n⛽ Deployment Gas Estimates:');
  console.log('─────────────────────────────────────────');
  
  // Rough formula: 21,000 base + ~200 gas per byte of bytecode + constructor execution
  const baseGas = 21000;
  const bytecodeGas = deploySize * 200;
  const constructorGas = 500000; // Estimate for complex constructor
  const estimatedGas = baseGas + bytecodeGas + constructorGas;
  
  console.log(`Estimated Deployment Gas: ${estimatedGas.toLocaleString()} gas`);
  
  // Calculate costs at different gas prices
  const gasPrices = [
    { label: 'Current Low (0.133 gwei)', gwei: 0.133 },
    { label: 'Current Avg (0.133 gwei)', gwei: 0.133 },
    { label: 'Medium (5 gwei)', gwei: 5 },
    { label: 'High (20 gwei)', gwei: 20 },
  ];
  
  const ethPrice = 4012.38; // From your screenshot
  
  console.log('\n💰 Deployment Cost at Different Gas Prices:');
  console.log('─────────────────────────────────────────');
  console.log('Gas Price          ETH Cost      USD Cost');
  
  for (const price of gasPrices) {
    const ethCost = (estimatedGas * price.gwei) / 1e9;
    const usdCost = ethCost * ethPrice;
    console.log(`${price.label.padEnd(18)} ${ethCost.toFixed(6)} ETH  $${usdCost.toFixed(2)}`);
  }
  
  console.log('\n📊 Console.log Impact:');
  console.log('─────────────────────────────────────────');
  console.log('With console.log:     Current size');
  console.log('Without console.log:  ~3-5 KB smaller (estimated)');
  console.log('Gas savings:          ~600,000 - 1,000,000 gas');
  console.log(`USD savings:          $${((750000 * 0.133) / 1e9 * ethPrice).toFixed(2)} (at current gas)`);
  
  console.log('\n🎯 Recommendation:');
  console.log('─────────────────────────────────────────');
  if (estimatedGas * 0.133 / 1e9 * ethPrice < 5) {
    console.log('✅ Gas costs are VERY LOW right now!');
    console.log('   Perfect time to deploy WITH console.log for debugging.');
  } else {
    console.log('⚠️  Consider removing console.log to save on gas costs.');
  }
}

main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});

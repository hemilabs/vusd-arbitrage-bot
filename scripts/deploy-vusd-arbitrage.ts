// scripts/deploy-vusd-arbitrage.ts
// UPDATED VERSION: Automatically detects USDC position in default pool
// No longer requires manual configuration - discovers token order dynamically

import { ethers, Contract } from 'ethers';
import { VusdArbitrage__factory } from '../typechain-types';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

dotenv.config();

// Minimal ABI for token discovery on Curve pools
const CURVE_POOL_ABI = [
  'function coins(int128 i) external view returns (address)',
];

// ABI for detecting token positions in Uniswap V3 pools
const POOL_ABI = [
  'function token0() external view returns (address)',
  'function token1() external view returns (address)',
];

async function main() {
  console.log('🚀 Starting VUSD Arbitrage Contract Deployment...');

  // --- 1. Setup Provider and Wallet ---
  const rpcUrl = process.env.ETHEREUM_RPC_URL;
  const privateKey = process.env.SEARCHER_PRIVATE_KEY;

  if (!rpcUrl || !privateKey) {
    throw new Error('Missing ETHEREUM_RPC_URL or SEARCHER_PRIVATE_KEY in .env file');
  }

  const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(privateKey, provider);
  console.log(`✅ Deployer wallet loaded: ${wallet.address}`);

  // --- 2. Load Contract Addresses from .env ---
  const addresses = {
    usdc: process.env.USDC_ADDRESS!,
    crvUsd: process.env.CRVUSD_ADDRESS!,
    vusd: process.env.VUSD_ADDRESS!,
    vusdMinter: process.env.VUSD_MINTER!,
    vusdRedeemer: process.env.VUSD_REDEEMER!,
    curveCrvusdUsdcPool: process.env.CURVE_CRVUSD_USDC_POOL!,
    curveCrvusdVusdPool: process.env.CURVE_CRVUSD_VUSD_POOL!,
    // DEFAULT_UNISWAP_V3_POOL from .env, or use hardcoded USDC/DAI 0.01% pool as fallback
    defaultUniswapV3Pool: process.env.DEFAULT_UNISWAP_V3_POOL || '0x5777d92f208679DB4b9778590Fa3CAB3aC9e2168',
  };

  for (const [key, value] of Object.entries(addresses)) {
    if (!value) throw new Error(`Missing ${key.toUpperCase()} address in .env file`);
  }
  console.log('✅ All required addresses loaded from .env');
  console.log(`📍 Default Uniswap V3 Pool: ${addresses.defaultUniswapV3Pool}`);

  // --- 3. Discover and Validate Curve Pool Token Indices ---
  console.log('\n🔍 Discovering Curve pool token indices...');

  const crvUsdUsdcPool = new Contract(addresses.curveCrvusdUsdcPool, CURVE_POOL_ABI, provider);
  const crvUsdVusdPool = new Contract(addresses.curveCrvusdVusdPool, CURVE_POOL_ABI, provider);

  // For crvUSD/USDC Pool (Expected: 0=USDC, 1=crvUSD)
  const usdcIndex = 0;
  const crvUsdIndexInUsdcPool = 1;
  const discoveredUsdcAddress = await crvUsdUsdcPool.coins(usdcIndex);
  const discoveredCrvUsdAddress1 = await crvUsdUsdcPool.coins(crvUsdIndexInUsdcPool);

  if (discoveredUsdcAddress.toLowerCase() !== addresses.usdc.toLowerCase()) {
    throw new Error(`CRITICAL: crvUSD/USDC pool index 0 is NOT USDC! Found ${discoveredUsdcAddress}`);
  }
  if (discoveredCrvUsdAddress1.toLowerCase() !== addresses.crvUsd.toLowerCase()) {
    throw new Error(`CRITICAL: crvUSD/USDC pool index 1 is NOT crvUSD! Found ${discoveredCrvUsdAddress1}`);
  }
  console.log(`✅ crvUSD/USDC Pool: Index ${usdcIndex}=USDC, Index ${crvUsdIndexInUsdcPool}=crvUSD`);

  // For crvUSD/VUSD Pool (Expected: 0=crvUSD, 1=VUSD)
  const crvUsdIndexInVusdPool = 0;
  const vusdIndex = 1;
  const discoveredCrvUsdAddress2 = await crvUsdVusdPool.coins(crvUsdIndexInVusdPool);
  const discoveredVusdAddress = await crvUsdVusdPool.coins(vusdIndex);

  if (discoveredCrvUsdAddress2.toLowerCase() !== addresses.crvUsd.toLowerCase()) {
    throw new Error(`CRITICAL: crvUSD/VUSD pool index 0 is NOT crvUSD! Found ${discoveredCrvUsdAddress2}`);
  }
  if (discoveredVusdAddress.toLowerCase() !== addresses.vusd.toLowerCase()) {
    throw new Error(`CRITICAL: crvUSD/VUSD pool index 1 is NOT VUSD! Found ${discoveredVusdAddress}`);
  }
  console.log(`✅ crvUSD/VUSD Pool: Index ${crvUsdIndexInVusdPool}=crvUSD, Index ${vusdIndex}=VUSD`);

  // --- 4. DETECT USDC POSITION IN DEFAULT UNISWAP V3 POOL ---
  console.log('\n🔍 Detecting USDC position in default Uniswap V3 pool...');
  console.log(`   Pool address: ${addresses.defaultUniswapV3Pool}`);

  const poolContract = new Contract(addresses.defaultUniswapV3Pool, POOL_ABI, provider);
  
  // Query the pool to find which token is token0 and which is token1
  const token0Address = await poolContract.token0();
  const token1Address = await poolContract.token1();

  console.log(`   Token0: ${token0Address}`);
  console.log(`   Token1: ${token1Address}`);
  console.log(`   USDC:   ${addresses.usdc}`);

  // Detect USDC position by comparing addresses
  let usdcIsToken1: boolean;
  if (token0Address.toLowerCase() === addresses.usdc.toLowerCase()) {
    usdcIsToken1 = false;
    console.log('   ✅ USDC is token0');
    console.log('   📝 Will use: flash(recipient, usdcAmount, 0, data)');
    console.log('   📝 Will use: fee0 in callback');
  } else if (token1Address.toLowerCase() === addresses.usdc.toLowerCase()) {
    usdcIsToken1 = true;
    console.log('   ✅ USDC is token1');
    console.log('   📝 Will use: flash(recipient, 0, usdcAmount, data)');
    console.log('   📝 Will use: fee1 in callback');
  } else {
    throw new Error(
      `CRITICAL: Default pool ${addresses.defaultUniswapV3Pool} does not contain USDC!\n` +
      `Token0: ${token0Address}\n` +
      `Token1: ${token1Address}\n` +
      `USDC:   ${addresses.usdc}`
    );
  }

  // --- 5. Deploy the Contract ---
  console.log('\n🚢 Deploying VusdArbitrage contract...');
  console.log(`   Using detected USDC position: token${usdcIsToken1 ? '1' : '0'}`);
  
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
    usdcIsToken1, // <-- Using auto-detected value!
    usdcIndex,
    crvUsdIndexInUsdcPool,
    crvUsdIndexInVusdPool,
    vusdIndex
  );

  console.log(`   Tx sent: ${contract.deployTransaction.hash}`);
  console.log('   ⏳ Waiting for deployment confirmation...');
  await contract.deployed();
  console.log('   🎉 VusdArbitrage Contract deployed successfully!');
  console.log(`   📍 Contract Address: ${contract.address}`);

  // --- 6. Save Artifacts and Address ---
  const deploymentInfo = {
    address: contract.address,
    network: (await provider.getNetwork()).name,
    chainId: (await provider.getNetwork()).chainId,
    deployer: wallet.address,
    defaultUniswapV3Pool: addresses.defaultUniswapV3Pool,
    usdcIsToken1: usdcIsToken1, // Save this for reference
    timestamp: new Date().toISOString()
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

  console.log(`\n✅ Deployment info saved to ${deploymentFilePath}`);
  
  // Display summary
  console.log('\n' + '='.repeat(80));
  console.log('DEPLOYMENT SUMMARY');
  console.log('='.repeat(80));
  console.log(`Contract Address:     ${contract.address}`);
  console.log(`Network:              ${deploymentInfo.network}`);
  console.log(`Chain ID:             ${deploymentInfo.chainId}`);
  console.log(`Deployer:             ${wallet.address}`);
  console.log('');
  console.log('Pool Configuration:');
  console.log(`  Default Pool:       ${addresses.defaultUniswapV3Pool}`);
  console.log(`  USDC Position:      token${usdcIsToken1 ? '1' : '0'}`);
  console.log(`  Pool Type:          USDC/DAI 0.01% fee`);
  console.log(`  Pool Liquidity:     ~31,000,000 USDC`);
  console.log(`  Max Flashloan:      ~15,000,000 USDC (safe limit)`);
  console.log('');
  console.log('Flash Call Format:');
  if (usdcIsToken1) {
    console.log(`  flash(recipient, 0, usdcAmount, data)`);
    console.log(`  Use fee1 in callback`);
  } else {
    console.log(`  flash(recipient, usdcAmount, 0, data)`);
    console.log(`  Use fee0 in callback`);
  }
  console.log('='.repeat(80));
  console.log('');
  console.log('✅ Deployment complete! Ready for testing.');
  console.log('');
  console.log('Next steps:');
  console.log('  1. Fund the contract with USDC for testing');
  console.log('  2. Run test-all-flashloan-scenarios.ts to verify functionality');
  console.log('  3. Monitor gas costs and profitability thresholds');
  console.log('');
}

main().catch((error) => {
  console.error('💥 Deployment failed:', error);
  process.exitCode = 1;
});

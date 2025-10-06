// scripts/deploy-vusd-arbitrage.ts
import { ethers, Contract } from 'ethers';
import { VusdArbitrage__factory } from '../typechain-types'; // Make sure to compile first!
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

dotenv.config();

// Minimal ABI for token discovery on Curve pools
const CURVE_POOL_ABI = [
  'function coins(int128 i) external view returns (address)',
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
    uniswapV3UsdcPool: process.env.UNISWAP_V3_USDC_POOL!,
  };

  for (const [key, value] of Object.entries(addresses)) {
    if (!value) throw new Error(`Missing ${key.toUpperCase()} address in .env file`);
  }
  console.log('✅ All required addresses loaded from .env');

  // --- 3. Discover and Validate Curve Pool Token Indices ---
  console.log('🔍 Discovering Curve pool token indices...');

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
  console.log(`- crvUSD/USDC Pool: Index ${usdcIndex}=USDC, Index ${crvUsdIndexInUsdcPool}=crvUSD (Correct)`);


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
  console.log(`- crvUSD/VUSD Pool: Index ${crvUsdIndexInVusdPool}=crvUSD, Index ${vusdIndex}=VUSD (Correct)`);
  console.log('✅ Token index validation successful!');

  // --- 4. Deploy the Contract ---
  console.log('🚢 Deploying VusdArbitrage contract...');
  const vusdArbitrageFactory = new VusdArbitrage__factory(wallet);

  const contract = await vusdArbitrageFactory.deploy(
    addresses.usdc,
    addresses.crvUsd,
    addresses.vusd,
    addresses.vusdMinter,
    addresses.vusdRedeemer,
    addresses.curveCrvusdUsdcPool,
    addresses.curveCrvusdVusdPool,
    addresses.uniswapV3UsdcPool,
    usdcIndex,
    crvUsdIndexInUsdcPool,
    crvUsdIndexInVusdPool,
    vusdIndex
  );

  console.log(`Tx sent: ${contract.deployTransaction.hash}`);
  console.log('⏳ Waiting for deployment confirmation...');
  await contract.deployed();
  console.log('🎉 VusdArbitrage Contract deployed successfully!');
  console.log(`📍 Contract Address: ${contract.address}`);

  // --- 5. Save Artifacts and Address ---
  const deploymentInfo = {
    address: contract.address,
    network: (await provider.getNetwork()).name,
    chainId: (await provider.getNetwork()).chainId,
    deployer: wallet.address,
    timestamp: new Date().toISOString()
  };

  const deploymentsDir = path.join(__dirname, '..', 'deployments');
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir);
  }
  fs.writeFileSync(
    path.join(deploymentsDir, `VusdArbitrage-${deploymentInfo.chainId}.json`),
    JSON.stringify(deploymentInfo, null, 2)
  );

  console.log(`✅ Deployment info saved to deployments/VusdArbitrage-${deploymentInfo.chainId}.json`);
}

main().catch((error) => {
  console.error('💥 Deployment failed:', error);
  process.exitCode = 1;
});

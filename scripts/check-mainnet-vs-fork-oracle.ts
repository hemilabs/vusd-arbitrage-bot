// scripts/check-mainnet-vs-fork-oracle.ts
// Compare oracle state between real mainnet and Tenderly fork

import { ethers } from 'ethers';
import * as dotenv from 'dotenv';

dotenv.config();

const ORACLE_ADDRESS = '0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6'; // USDC/USD
const ORACLE_ABI = [
  'function latestRoundData() external view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)'
];

async function checkOracle(providerUrl: string, name: string) {
  console.log(`\n=== ${name} ===`);
  
  const provider = new ethers.providers.JsonRpcProvider(providerUrl);
  const oracle = new ethers.Contract(ORACLE_ADDRESS, ORACLE_ABI, provider);
  
  try {
    const latestRound = await oracle.latestRoundData();
    const block = await provider.getBlock('latest');
    
    const oracleUpdateTime = latestRound.updatedAt.toNumber();
    const blockTime = block.timestamp;
    const age = blockTime - oracleUpdateTime;
    const ageHours = age / 3600;
    
    console.log('Oracle last updated:', new Date(oracleUpdateTime * 1000).toISOString());
    console.log('Current block time: ', new Date(blockTime * 1000).toISOString());
    console.log('Current block number:', block.number);
    console.log('Oracle age:', ageHours.toFixed(2), 'hours');
    console.log('Is stale (>24h)?:', ageHours > 24);
    console.log('Oracle price:', ethers.utils.formatUnits(latestRound.answer, 8));
    
    return {
      name,
      oracleUpdateTime,
      blockTime,
      blockNumber: block.number,
      ageHours,
      isStale: ageHours > 24
    };
  } catch (error: any) {
    console.log('ERROR:', error.message);
    return null;
  }
}

async function main() {
  console.log('Comparing Oracle State: Mainnet vs Tenderly Fork');
  console.log('='.repeat(60));
  
  // Check real mainnet
  const mainnetUrl = process.env.ETHEREUM_RPC_URL;
  if (!mainnetUrl) {
    console.log('ERROR: ETHEREUM_RPC_URL not set in .env');
    return;
  }
  
  const mainnetData = await checkOracle(mainnetUrl, 'REAL MAINNET');
  
  // Check Tenderly fork
  const tenderlyUrl = "https://virtual.mainnet.eu.rpc.tenderly.co/fefb5542-60fb-4d31-a6a1-4c4b93a5fe6f";
  const forkData = await checkOracle(tenderlyUrl, 'TENDERLY FORK');
  
  // Compare
  if (mainnetData && forkData) {
    console.log('\n' + '='.repeat(60));
    console.log('COMPARISON');
    console.log('='.repeat(60));
    
    const timeDiff = forkData.blockTime - mainnetData.blockTime;
    const timeDiffHours = timeDiff / 3600;
    
    console.log(`Fork is ${timeDiffHours.toFixed(2)} hours ahead of mainnet`);
    console.log(`Mainnet oracle: ${mainnetData.isStale ? 'STALE' : 'FRESH'}`);
    console.log(`Fork oracle: ${forkData.isStale ? 'STALE' : 'FRESH'}`);
    
    if (!mainnetData.isStale && forkData.isStale) {
      console.log('\n🔍 ROOT CAUSE IDENTIFIED:');
      console.log('The Tenderly fork\'s block timestamp is too far in the future.');
      console.log('The oracle data is the same, but the fork\'s "current time"');
      console.log('makes it appear stale.');
      console.log('\nSOLUTION: Create a new Tenderly fork from a more recent block.');
    }
  }
}

main().catch(console.error);

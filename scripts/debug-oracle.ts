// scripts/debug-oracle.ts
import { ethers } from 'ethers';
import * as dotenv from 'dotenv';
dotenv.config();

// Connect to the local hardhat fork
const RPC_URL = "http://127.0.0.1:8545"; 

// The exact address and ABI from your test script
const CHAINLINK_USDC_USD = '0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6';
const CHAINLINK_ABI = [
  'function latestRoundData() external view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)',
  'function decimals() external view returns (uint8)'
];

async function checkOracle() {
  console.log(`Connecting to local fork at ${RPC_URL}...`);
  const provider = new ethers.providers.JsonRpcProvider(RPC_URL);

  try {
    const blockNumber = await provider.getBlockNumber();
    console.log(`✅ Connected! Forked block number: ${blockNumber}`);

    const oracle = new ethers.Contract(CHAINLINK_USDC_USD, CHAINLINK_ABI, provider);

    console.log('Querying oracle for latestRoundData()...');
    const oracleData = await oracle.latestRoundData();

    console.log('\n--- RAW ORACLE DATA ---');
    console.dir(oracleData); // This will print the full object
    console.log('-------------------------\n');

    if (!oracleData || oracleData.answer === undefined) {
      console.error('❌ CONFIRMED: oracleData is invalid or has no .answer property.');
      console.log('This is why your test script is failing.');
    } else {
      console.log(`✅ SUCCESS: Oracle returned data:`);
      console.log(`   Round ID: ${oracleData.roundId.toString()}`);
      console.log(`   Answer: ${oracleData.answer.toString()}`);
      console.log(`   Updated At (UTC): ${new Date(oracleData.updatedAt.toNumber() * 1000).toUTCString()}`);
    }

  } catch (error: any) {
    console.error('❌ ERROR: Failed to query oracle:', error.message);
  }
}

checkOracle();

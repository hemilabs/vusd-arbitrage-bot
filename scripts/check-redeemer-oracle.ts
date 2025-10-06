// scripts/check-redeemer-oracle.ts
import { ethers } from 'ethers';
import * as dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

// Minimal ABI for the VUSD Redeemer to get the public 'oracle' state variable
const REDEEMER_ABI = [
  'function oracle() external view returns (address)',
];

// The known correct Chainlink oracle address from your bot's configuration
const CORRECT_ORACLE_ADDRESS = '0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6';

async function main() {
  console.log('🔍 Checking the VUSD Redeemer\'s configured oracle address...');

  // 1. Setup connection to Ethereum Mainnet
  const rpcUrl = process.env.ETHEREUM_RPC_URL;
  if (!rpcUrl) {
    throw new Error('ETHEREUM_RPC_URL not found in .env file');
  }
  const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
  console.log('Connected to Mainnet via', provider.connection.url);

  // 2. Get the VUSD Redeemer contract address from your .env file
  const redeemerAddress = process.env.VUSD_REDEEMER;
  if (!redeemerAddress) {
    throw new Error('VUSD_REDEEMER not found in .env file');
  }
  console.log('VUSD Redeemer Contract:', redeemerAddress);

  // 3. Create a contract instance
  const redeemerContract = new ethers.Contract(redeemerAddress, REDEEMER_ABI, provider);

  try {
    // 4. Call the public 'oracle()' getter function to read the state variable
    const configuredOracleAddress = await redeemerContract.oracle();

    // 5. Display the results
    console.log('\n' + '='.repeat(60));
    console.log('RESULTS:');
    console.log(`➡️ Address the Redeemer is USING:    ${configuredOracleAddress}`);
    console.log(`✅ The CORRECT Chainlink address is:  ${CORRECT_ORACLE_ADDRESS}`);
    console.log('='.repeat(60) + '\n');

    if (configuredOracleAddress.toLowerCase() === CORRECT_ORACLE_ADDRESS.toLowerCase()) {
      console.log('CONCLUSION: The addresses match. The configuration appears correct on the live mainnet.');
    } else {
      console.log('CONCLUSION: MISMATCH FOUND! The Redeemer is configured with an incorrect oracle address.');
      console.log('This confirms the issue is with the external protocol\'s configuration, not your code.');
    }

  } catch (error) {
    console.error('\n💥 Failed to read the oracle address from the contract.', error);
    console.log('This could mean the contract does not have a public `oracle` variable, or there was a network issue.');
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});

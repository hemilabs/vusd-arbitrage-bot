// scripts/estimate-gas.ts
import { ethers } from 'ethers';
import * as dotenv from 'dotenv';

dotenv.config();

const RPC_URL = process.env.ETHEREUM_RPC_URL;
const ESTIMATED_GAS_UNITS = 600000; // From our execute-arbitrage script gasLimit

// --- Optional: For USD Estimation ---
// You can get this from an oracle or hardcode an estimate
const ETH_PRICE_USD = 3000; // Example: Set to current approximate ETH price

async function estimateGas() {
  if (!RPC_URL) {
    console.error("ETHEREUM_RPC_URL not found in .env file.");
    process.exit(1);
  }

  console.log(`Connecting to Ethereum mainnet via ${RPC_URL}...`);
  const provider = new ethers.providers.StaticJsonRpcProvider(RPC_URL);

  try {
    const block = await provider.getBlock('latest');
    const feeData = await provider.getFeeData();

    if (!block.baseFeePerGas || !feeData.maxPriorityFeePerGas || !feeData.maxFeePerGas) {
      console.error("Could not retrieve full fee data.");
      return;
    }

    const currentBaseFeeGwei = ethers.utils.formatUnits(block.baseFeePerGas, 'gwei');
    const suggestedPriorityFeeGwei = ethers.utils.formatUnits(feeData.maxPriorityFeePerGas, 'gwei');
    // Suggested Max Fee is usually Base + Priority + Buffer
    const suggestedMaxFeeGwei = ethers.utils.formatUnits(feeData.maxFeePerGas, 'gwei');

    console.log('\n--- Current Network Gas ---');
    console.log(`Current Base Fee:       ${parseFloat(currentBaseFeeGwei).toFixed(2)} Gwei`);
    console.log(`Suggested Priority Fee: ${parseFloat(suggestedPriorityFeeGwei).toFixed(2)} Gwei (Tip for Miner/Builder)`);
    console.log(`Suggested Max Fee:      ${parseFloat(suggestedMaxFeeGwei).toFixed(2)} Gwei (Max you might pay per gas unit)`);

    console.log('\n--- Estimated Cost for Arbitrage Tx ---');
    console.log(`Estimated Gas Units:    ${ESTIMATED_GAS_UNITS.toLocaleString()}`);

    // Calculate cost using Suggested Priority + Current Base
    // This is the likely *actual* cost if included promptly
    const effectiveGasPrice = block.baseFeePerGas.add(feeData.maxPriorityFeePerGas);
    const estimatedCostWei = effectiveGasPrice.mul(ESTIMATED_GAS_UNITS);
    const estimatedCostEth = ethers.utils.formatEther(estimatedCostWei);
    const estimatedCostUsd = parseFloat(estimatedCostEth) * ETH_PRICE_USD;

    console.log(`Effective Gas Price:    ${ethers.utils.formatUnits(effectiveGasPrice, 'gwei')} Gwei (Base + Suggested Tip)`);
    console.log(`Estimated Tx Cost (ETH): ~${parseFloat(estimatedCostEth).toFixed(5)} ETH`);
    console.log(`Estimated Tx Cost (USD): ~$${estimatedCostUsd.toFixed(2)} (Assuming ETH price of $${ETH_PRICE_USD})`);


    console.log('\n--- Flashbots Context ---');
    console.log(`   - For Flashbots, the Priority Fee (${parseFloat(suggestedPriorityFeeGwei).toFixed(2)} Gwei) is the direct incentive for builders.`);
    console.log(`   - Your script uses Base + 20 Gwei for maxFee and 2 Gwei for priorityFee.`);
    console.log(`   - You only pay Base + Priority if the bundle succeeds and is included.`);
    console.log(`   - In the test (Step 8), you paid $0 because it reverted before inclusion.`);

  } catch (error) {
    console.error("Error fetching gas data:", error);
  }
}

estimateGas();

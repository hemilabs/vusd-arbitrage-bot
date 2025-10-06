// generate-calldata.ts
import { ethers } from 'ethers';
import VusdArbitrageArtifact from './artifacts/contracts/VusdArbitrageBot.sol/VusdArbitrage.json';

function generateCallData() {
  // The ABI from your compiled contract
  const abi = VusdArbitrageArtifact.abi;

  // Create an interface instance
  const iface = new ethers.utils.Interface(abi);

  // The amount for 100 USDC (with 6 decimals)
  const flashloanAmount = ethers.utils.parseUnits("100", 6);

  // Encode the function call data
  const calldata = iface.encodeFunctionData("executeRich", [flashloanAmount]);

  console.log("Your calldata is:");
  console.log(calldata);
}

generateCallData();

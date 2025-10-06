// src/contracts/vusd-minter.ts
// Interface for VUSD Minter contract
// Allows minting VUSD by depositing USDC (with 0.01% fee)

import { ethers, BigNumber } from 'ethers';

// Minimal ABI for VUSD Minter - only functions we need
export const VUSD_MINTER_ABI = [
  'function mint(address token, uint256 amount, uint256 minAmountOut, address receiver) external returns (uint256)',
  'function calculateMintage(address token, uint256 amount) external view returns (uint256)',
];

/**
 * Get VUSD Minter contract instance
 */
export function getVusdMinterContract(
  address: string,
  signerOrProvider: ethers.Signer | ethers.providers.Provider
): ethers.Contract {
  return new ethers.Contract(address, VUSD_MINTER_ABI, signerOrProvider);
}

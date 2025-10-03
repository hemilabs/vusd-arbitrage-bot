// src/contracts/vusd-redeemer.ts
// Interface for VUSD Redeemer contract
// Allows redeeming VUSD for USDC (with 0.10% fee, soon 0.05%)

import { ethers, BigNumber } from 'ethers';

// Minimal ABI for VUSD Redeemer - only functions we need
export const VUSD_REDEEMER_ABI = [
  'function redeem(address token, uint256 amount, uint256 minAmountOut, address receiver) external returns (uint256)',
  'function calculateRedeemable(address token, uint256 amount) external view returns (uint256)',
];

/**
 * Get VUSD Redeemer contract instance
 */
export function getVusdRedeemerContract(
  address: string,
  signerOrProvider: ethers.Signer | ethers.providers.Provider
): ethers.Contract {
  return new ethers.Contract(address, VUSD_REDEEMER_ABI, signerOrProvider);
}

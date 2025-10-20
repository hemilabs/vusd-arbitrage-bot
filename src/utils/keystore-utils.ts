// src/utils/keystore-utils.ts
// Utility functions for loading wallet from encrypted keystore
// This provides a secure way to manage private keys using password-encrypted keystores

import { Wallet, providers } from 'ethers';
import { password } from '@inquirer/prompts';
import { promises as fs } from 'fs';

/**
 * Prompts the user to enter their keystore password
 * Uses @inquirer/prompts for interactive password input with masking
 * 
 * @returns Promise<string> The password entered by the user
 */
export async function getKeystorePassword(): Promise<string> {
  const pswd = await password({
    message: 'Please enter your keystore password',
    mask: '*',
  });
  
  return pswd;
}

/**
 * Loads a wallet from an encrypted keystore file
 * Prompts the user for password and decrypts the keystore
 * 
 * @param keystorePath - Path to the encrypted keystore JSON file
 * @param provider - Optional ethers provider to connect the wallet to
 * @returns Promise<Wallet> The decrypted wallet, optionally connected to provider
 * @throws Error if keystore file not found or decryption fails
 */
export async function loadWalletFromKeystore(
  keystorePath: string,
  provider?: providers.Provider
): Promise<Wallet> {
  try {
    // Read the encrypted keystore file
    const keystoreJson = await fs.readFile(keystorePath, 'utf8');
    
    // Prompt user for password
    const pswd = await getKeystorePassword();
    
    // Decrypt the keystore with the password
    const wallet = await Wallet.fromEncryptedJson(keystoreJson, pswd);
    
    // Connect to provider if provided
    if (provider) {
      return wallet.connect(provider);
    }
    
    return wallet;
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      throw new Error(`Keystore file not found at path: ${keystorePath}`);
    } else if (error.message?.includes('incorrect password')) {
      throw new Error('Incorrect keystore password');
    } else {
      throw new Error(`Failed to load wallet from keystore: ${error.message}`);
    }
  }
}

/**
 * Loads a wallet from keystore using path from environment variable
 * This is the main function scripts should use
 * 
 * @param provider - Optional ethers provider to connect the wallet to
 * @returns Promise<Wallet> The decrypted wallet, optionally connected to provider
 * @throws Error if KEYSTORE_PATH not set or loading fails
 */
export async function loadWallet(
  provider?: providers.Provider
): Promise<Wallet> {
  const keystorePath = process.env.KEYSTORE_PATH;
  
  if (!keystorePath) {
    throw new Error(
      'KEYSTORE_PATH not set in environment. Please set it to your keystore file path.'
    );
  }
  
  return await loadWalletFromKeystore(keystorePath, provider);
}

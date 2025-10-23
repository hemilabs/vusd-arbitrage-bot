import { ethers } from 'ethers';
import * as fs from 'fs'; // Corrected import
import * as path from 'path'; // Corrected import

async function createKey() {
  const wallet = ethers.Wallet.createRandom();
  console.log('FLASHBOTS_AUTH_KEY:', wallet.privateKey);

  const envPath = path.join(__dirname, '..', '.env');
  const envContent = fs.readFileSync(envPath, 'utf8');

  if (envContent.includes('FLASHBOTS_AUTH_KEY')) {
    console.log('\nFLASHBOTS_AUTH_KEY already exists in .env');
  } else {
    fs.appendFileSync(envPath, `\nFLASHBOTS_AUTH_KEY=${wallet.privateKey}\n`);
    console.log('\nAppended FLASHBOTS_AUTH_KEY to your .env file');
  }
}
createKey();

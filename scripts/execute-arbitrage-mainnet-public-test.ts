// scripts/execute-arbitrage-mainnet-public-test.ts
// STEP 8c (Variant): PUBLIC TRANSACTION TEST
// 
// Purpose: Test complete arbitrage flow by sending a PUBLIC transaction
// - This BYPASSES Flashbots to confirm the on-chain logic.
// - Contract pre-funded with ~10 USDC to cover small losses.
// - Looks for trades with simulated loss (to guarantee execution).
// - Submits via normal provider.sendTransaction.
// - Expects transaction to SUCCEED on-chain (status: 1).
// - Expects to PAY GAS from searcher wallet.

import { ethers, BigNumber } from 'ethers';
import * as dotenv from 'dotenv';
import { loadWallet } from '../src/utils/keystore-utils';

dotenv.config();

// --- CONFIGURATION ---
const RPC_URL = process.env.ETHEREUM_RPC_URL!;
const CONTRACT_ADDRESS = process.env.VUSD_ARBITRAGE_CONTRACT!;
const CHECK_INTERVAL_MS = 15000;
const FLASHLOAN_AMOUNT_USDC = ethers.utils.parseUnits('1000', 6);
const SLIPPAGE_BPS = 5;
const MAX_ACCEPTABLE_LOSS = ethers.utils.parseUnits('5.00', 6);

// --- ABIs ---
const VUSD_ARBITRAGE_ABI = [
  'function executeRichWithDefaultPool(uint256 _flashloanAmount, tuple(uint256 minCrvUsdOut, uint256 minVusdOut, uint256 minUsdcOut) calldata _params) external',
  'function executeCheapWithDefaultPool(uint256 _flashloanAmount, tuple(uint256 minVusdOut, uint256 minCrvUsdOut, uint256 minUsdcOut) calldata _params) external',
];
const CURVE_POOL_ABI = [
  'function get_dy(int128 i, int128 j, uint256 dx) external view returns (uint256)',
];
const VUSD_MINTER_ABI = ['function mintingFee() external view returns (uint256)'];
const VUSD_REDEEMER_ABI = ['function redeemFee() external view returns (uint256)'];
const CHAINLINK_ABI = [
  'function latestRoundData() external view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)',
  'function decimals() external view returns (uint8)',
];

// --- ADDRESSES ---
const {
  VUSD_MINTER,
  VUSD_REDEEMER,
  CURVE_CRVUSD_USDC_POOL,
  CURVE_CRVUSD_VUSD_POOL,
} = process.env;
const CHAINLINK_USDC_USD = '0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6';

// --- CURVE INDICES ---
const USDC_INDEX = 0;
const CRVUSD_INDEX_IN_USDC_POOL = 1;
const CRVUSD_INDEX_IN_VUSD_POOL = 0;
const VUSD_INDEX = 1;

// Helper functions
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
function applySlippage(amount: BigNumber, bps: number): BigNumber {
  return amount.mul(10000 - bps).div(10000);
}

async function main() {
  console.log('--- VUSD Arbitrage Bot Starting ---');
  console.log('!!! WARNING: RUNNING IN STEP 8c "PUBLIC TEST" MODE !!!');
  console.log(`Will submit a PUBLIC trade with simulated profit > -${ethers.utils.formatUnits(MAX_ACCEPTABLE_LOSS, 6)} USDC`);
  console.log('EXPECT TO PAY GAS and see a successful (status: 1) transaction on chain.');
  console.log(`Ensure contract ${CONTRACT_ADDRESS} has ~10 USDC to cover the loss!`);

  // Setup providers and wallets
  const provider = new ethers.providers.StaticJsonRpcProvider(RPC_URL);
  const deployerWallet = await loadWallet(provider);

  // Setup contracts
  const contract = new ethers.Contract(
    CONTRACT_ADDRESS,
    VUSD_ARBITRAGE_ABI,
    deployerWallet
  );
  const crvusdUsdcPool = new ethers.Contract(
    CURVE_CRVUSD_USDC_POOL!,
    CURVE_POOL_ABI,
    provider
  );
  const crvusdVusdPool = new ethers.Contract(
    CURVE_CRVUSD_VUSD_POOL!,
    CURVE_POOL_ABI,
    provider
  );
  const oracle = new ethers.Contract(CHAINLINK_USDC_USD, CHAINLINK_ABI, provider);

  console.log(`Bot started. Deployer: ${deployerWallet.address}`);
  console.log(`Watching contract: ${contract.address}`);
  console.log(`Checking for opportunities every ${CHECK_INTERVAL_MS / 1000}s...`);
  console.log('='.repeat(60));

  // Main loop - but we will exit after first attempt
  while (true) {
    
    // *** FIX: Declare txFound here ***
    let txFound = false; 

    try {
      console.log(`\n[${new Date().toISOString()}] Simulating trades...`);

      let params: any;
      let populatedTx: any;
      let scenario = '';
      let simulatedProfitLoss: BigNumber = ethers.constants.Zero;

      const flashloanFee = FLASHLOAN_AMOUNT_USDC.div(10000);
      const repaymentRequired = FLASHLOAN_AMOUNT_USDC.add(flashloanFee);

      // --- RICH PATH SIMULATION ---
      try {
        const expectedCrvUsdOut = await crvusdUsdcPool.get_dy(
          USDC_INDEX,
          CRVUSD_INDEX_IN_USDC_POOL,
          FLASHLOAN_AMOUNT_USDC
        );
        const expectedVusdOut = await crvusdVusdPool.get_dy(
          CRVUSD_INDEX_IN_VUSD_POOL,
          VUSD_INDEX,
          expectedCrvUsdOut
        );
        const oracleData = await oracle.latestRoundData();
        const oracleDecimals = await oracle.decimals();
        if (!oracleData || oracleData.answer === undefined) throw new Error('Oracle data is invalid');
        
        let usdcFromVusd = expectedVusdOut;
        if (oracleData.answer.gt(ethers.utils.parseUnits('1', oracleDecimals))) {
          const scale = ethers.utils.parseUnits('1', 18);
          usdcFromVusd = expectedVusdOut
            .mul(scale)
            .div(oracleData.answer.mul(BigNumber.from(10).pow(18 - oracleDecimals)));
        }
        
        const vusdRedeemer = new ethers.Contract(VUSD_REDEEMER!, VUSD_REDEEMER_ABI, provider);
        const redeemFeeBps = await vusdRedeemer.redeemFee();
        const expectedUsdcOutRich = applySlippage(usdcFromVusd, redeemFeeBps.toNumber()).div(
          BigNumber.from(10).pow(12)
        );
        const profitLoss = expectedUsdcOutRich.sub(repaymentRequired);

        if (profitLoss.lt(0) && profitLoss.abs().lte(MAX_ACCEPTABLE_LOSS)) {
          console.log(
            `   * RICH Path found for test! Sim P/L: ${ethers.utils.formatUnits(
              profitLoss,
              6
            )} USDC`
          );
          txFound = true;
          scenario = 'RICH';
          simulatedProfitLoss = profitLoss;
          params = {
            minCrvUsdOut: applySlippage(expectedCrvUsdOut, SLIPPAGE_BPS),
            minVusdOut: applySlippage(expectedVusdOut, SLIPPAGE_BPS),
            minUsdcOut: applySlippage(expectedUsdcOutRich, SLIPPAGE_BPS),
          };
          populatedTx = await contract.populateTransaction.executeRichWithDefaultPool(
            FLASHLOAN_AMOUNT_USDC,
            params
          );
        } else {
           console.log(`   -> Rich path not viable for test (P/L: ${ethers.utils.formatUnits(profitLoss, 6)} USDC)`);
        }
      } catch (simError: any) {
        console.warn('   -> Rich path simulation error:', (simError as Error).message);
      }
      
      // --- CHEAP PATH SIMULATION ---
      // (Skipping for this test, but you can add it back if needed)
      // ... if (!txFound) { ... }

      // --- EXECUTE TRADE IF FOUND ---
      if (txFound && populatedTx) {
        console.log(
          `   -> Test trade found! Expected P/L: ${ethers.utils.formatUnits(
            simulatedProfitLoss,
            6
          )} USDC`
        );
        console.log(`   -> Preparing PUBLIC transaction for ${scenario} path...`);

        const block = await provider.getBlock('latest');
        
        // Set EIP-1559 gas parameters
        populatedTx.gasLimit = 600000;
        // We still use a high priority fee to get it mined quickly
        const priorityFee = ethers.utils.parseUnits('15', 'gwei');
        populatedTx.maxFeePerGas = block.baseFeePerGas!.add(priorityFee);
        populatedTx.maxPriorityFeePerGas = priorityFee;
        populatedTx.chainId = (await provider.getNetwork()).chainId;
        populatedTx.nonce = await deployerWallet.getTransactionCount();
        populatedTx.type = 2; // EIP-1559

        try {
          console.log('   -> Submitting as a REGULAR, PUBLIC transaction...');
          
          // Send the transaction publicly
          const txResponse = await deployerWallet.sendTransaction(populatedTx);
          
          console.log(`   -> ✅ Transaction sent! Hash: ${txResponse.hash}`);
          console.log(`   -> You can monitor at: https://etherscan.io/tx/${txResponse.hash}`);
          console.log('   -> Waiting for transaction receipt (1 confirmation)...');
          
          // Wait for the transaction to be mined
          const receipt = await txResponse.wait(1);

          // --- CHECK THE RESULT ---
          if (receipt && receipt.status === 1) {
            console.log('\n' + '='.repeat(60));
            console.log('   -> ✅✅✅ SUCCESS! Transaction was included and succeeded on-chain!');
            console.log('   -> Block number:', receipt.blockNumber);
            console.log('   -> Gas used:', receipt.gasUsed.toString());
            const gasCostEth = receipt.gasUsed.mul(receipt.effectiveGasPrice);
            const gasCostUsd = parseFloat(ethers.utils.formatEther(gasCostEth)) * 3000; // Assuming 3k ETH
            console.log('   -> Gas cost (ETH):', ethers.utils.formatEther(gasCostEth));
            console.log(`   -> Gas cost (USD, ~$3000/ETH): $${gasCostUsd.toFixed(2)}`);
            console.log(`   -> Transaction link: https://etherscan.io/tx/${receipt.transactionHash}`);
            console.log('='.repeat(60));
            console.log('\n✅ STEP 8c (PUBLIC TEST) COMPLETE! The on-chain logic works.');
            console.log('This confirms the contract is correct. The Flashbots issue is just inclusion.');
            console.log('\nExiting after successful test...');
            process.exit(0); // Success!
          } else {
            console.error('   -> ❌ TRANSACTION FAILED ON-CHAIN (status: 0)');
            console.error('   -> The simulation was wrong. There is a bug in the contract logic.');
            if (receipt) {
              console.error(`   -> Tx link: https://etherscan.io/tx/${receipt.transactionHash}`);
            }
            process.exit(1); // Exit with error
          }

        } catch (sendError: any) {
          console.error('   -> ❌ Error sending public transaction:', (sendError as Error).message);
          process.exit(1);
        }

      }

    } catch (error: any) {
      console.error('Bot loop error:', (error as Error).message);
    }
    
    // This 'if' check is now valid
    if (txFound) {
        console.log('Exiting script after one attempt.');
        break;
    }
    
    console.log(`\n-> No testable (losing) trade found. Waiting ${CHECK_INTERVAL_MS / 1000}s...`);
    await sleep(CHECK_INTERVAL_MS);
  }
}

main().catch((error) => {
  console.error('Unhandled error:', error);
  process.exit(1);
});

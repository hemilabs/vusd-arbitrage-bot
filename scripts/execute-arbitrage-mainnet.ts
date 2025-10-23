import { ethers, BigNumber } from 'ethers';
import {
  FlashbotsBundleProvider,
  FlashbotsBundleResolution,
  FlashbotsBundleRawTransaction,
  SimulationResponse,
} from '@flashbots/ethers-provider-bundle';
import * as dotenv from 'dotenv';
import { loadWallet } from '../src/utils/keystore-utils';

dotenv.config();

// --- CONFIGURATION ---
// STEP 9: LIVE MAINNET MODE
const RPC_URL = process.env.ETHEREUM_RPC_URL!;
const FLASHBOTS_AUTH_KEY = process.env.FLASHBOTS_AUTH_KEY!;
const CONTRACT_ADDRESS = process.env.VUSD_ARBITRAGE_CONTRACT!;
const CHECK_INTERVAL_MS = 15000; // Check every 15 seconds (adjust as needed)
const FLASHLOAN_AMOUNT_USDC = ethers.utils.parseUnits('1000', 6); // 1,000 USDC Flashloan
const SLIPPAGE_BPS = 5; // 0.05% slippage tolerance (5 basis points) - Start tight!

// Minimum Profit Threshold - Adjust as needed based on gas costs and desired return
const MIN_PROFIT_USDC = ethers.utils.parseUnits('2.00', 6); // Require at least $2.00 profit

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

// Helper to pause
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Helper to calculate slippage-adjusted minimum amount
function applySlippage(amount: BigNumber, bps: number): BigNumber {
  return amount.mul(10000 - bps).div(10000);
}

// Type guard to check if the simulation response indicates a revert
// (We still need this to log warnings if a *profitable* simulation reverts unexpectedly)
function simulationReverted(simulation: any): simulation is { firstRevert: { error?: string; revert?: string } } {
  return simulation && typeof simulation === 'object' && simulation.firstRevert !== undefined;
}

async function main() {
  console.log('--- VUSD Arbitrage Bot Starting ---');
  console.log('>>> RUNNING IN LIVE MAINNET MODE <<<');
  console.log(`Minimum profit threshold: $${ethers.utils.formatUnits(MIN_PROFIT_USDC, 6)} USDC`);
  console.log(`Slippage tolerance: ${SLIPPAGE_BPS / 100}%`);

  if (
    !RPC_URL ||
    !FLASHBOTS_AUTH_KEY ||
    !CONTRACT_ADDRESS ||
    !VUSD_MINTER ||
    !VUSD_REDEEMER ||
    !CURVE_CRVUSD_USDC_POOL ||
    !CURVE_CRVUSD_VUSD_POOL
  ) {
    console.error('Error: Missing one or more environment variables. Check your .env file.');
    // ... (removed console logs for brevity)
    process.exit(1);
  }

  const provider = new ethers.providers.StaticJsonRpcProvider(RPC_URL);
  const deployerWallet = await loadWallet(provider);
  const authWallet = new ethers.Wallet(FLASHBOTS_AUTH_KEY!, provider);

  console.log(`Connecting to Flashbots relay...`);
  const flashbotsProvider = await FlashbotsBundleProvider.create(
    provider,
    authWallet,
    'https://relay.flashbots.net',
    'mainnet'
  );
  console.log(`Flashbots connected.`);

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
  console.log(
    `Checking for opportunities every ${CHECK_INTERVAL_MS / 1000}s...`
  );
  console.log('='.repeat(60));

  while (true) {
    try {
      console.log(`\n[${new Date().toISOString()}] Simulating trades...`);

      let txFound = false;
      let params: any;
      let populatedTx: any;
      let scenario = '';

      const flashloanFee = FLASHLOAN_AMOUNT_USDC.div(10000); // 1 bps = 0.01%
      const repaymentRequired = FLASHLOAN_AMOUNT_USDC.add(flashloanFee);

      // --- RICH PATH SIMULATION ---
      try {
        const expectedCrvUsdOut = await crvusdUsdcPool.get_dy(USDC_INDEX, CRVUSD_INDEX_IN_USDC_POOL, FLASHLOAN_AMOUNT_USDC);
        const expectedVusdOut = await crvusdVusdPool.get_dy(CRVUSD_INDEX_IN_VUSD_POOL, VUSD_INDEX, expectedCrvUsdOut);

        const oracleData = await oracle.latestRoundData();
        const oracleDecimals = await oracle.decimals();

        if (!oracleData || oracleData.answer === undefined) {
          throw new Error("Oracle data is invalid");
        }

        let usdcFromVusd = expectedVusdOut;
        if (oracleData.answer.gt(ethers.utils.parseUnits("1", oracleDecimals))) {
          const scale = ethers.utils.parseUnits("1", 18);
          usdcFromVusd = expectedVusdOut.mul(scale).div(oracleData.answer.mul(BigNumber.from(10).pow(18 - oracleDecimals)));
        }

        const vusdRedeemer = new ethers.Contract(VUSD_REDEEMER!, VUSD_REDEEMER_ABI, provider);
        const redeemFeeBps = await vusdRedeemer.redeemFee();
        // Calculate expected output *before* applying our own slippage protection
        const expectedUsdcOutRich = applySlippage(usdcFromVusd, redeemFeeBps.toNumber()).div(BigNumber.from(10).pow(12));

        // --- LIVE PROFIT CHECK ---
        const profit = expectedUsdcOutRich.sub(repaymentRequired);

        if (profit.gt(MIN_PROFIT_USDC)) {
          console.log(`   ✅ RICH Path is profitable! Sim profit: ${ethers.utils.formatUnits(profit, 6)} USDC`);
          txFound = true;
          scenario = 'RICH';

          // --- Calculate minOut params for contract call ---
          params = {
            minCrvUsdOut: applySlippage(expectedCrvUsdOut, SLIPPAGE_BPS),
            minVusdOut: applySlippage(expectedVusdOut, SLIPPAGE_BPS),
            minUsdcOut: applySlippage(expectedUsdcOutRich, SLIPPAGE_BPS), // Apply slippage to final expected amount
          };
          // --- END ---

          // Safety check: ensure minUsdcOut is still greater than repayment after slippage
           if (params.minUsdcOut.lte(repaymentRequired)) {
               console.warn('   -> Profit margin too thin after applying slippage tolerance. Skipping.');
               txFound = false; // Do not proceed
           } else {
               populatedTx = await contract.populateTransaction.executeRichWithDefaultPool(FLASHLOAN_AMOUNT_USDC, params);
           }
        } else {
          console.log(`   -> Rich path not profitable enough. (Profit: ${ethers.utils.formatUnits(profit, 6)} USDC, Needed: ${ethers.utils.formatUnits(MIN_PROFIT_USDC, 6)})`);
        }
      } catch (simError: any) {
        console.warn('   -> Rich path simulation error:', simError.reason || (simError as Error).message);
      }

      // --- CHEAP PATH SIMULATION ---
      if (!txFound) {
        try {
            const oracleData = await oracle.latestRoundData();
            const oracleDecimals = await oracle.decimals();

            if (!oracleData || oracleData.answer === undefined) { throw new Error("Oracle data is invalid"); }

            let vusdFromUsdc = FLASHLOAN_AMOUNT_USDC.mul(BigNumber.from(10).pow(12));
            if (oracleData.answer.lt(ethers.utils.parseUnits('1', oracleDecimals))) {
                vusdFromUsdc = FLASHLOAN_AMOUNT_USDC.mul(BigNumber.from(10).pow(12)).mul(oracleData.answer).div(BigNumber.from(10).pow(oracleDecimals));
            }

            const vusdMinter = new ethers.Contract(VUSD_MINTER!, VUSD_MINTER_ABI, provider);
            const mintFeeBps = await vusdMinter.mintingFee();
            // Calculate expected output *before* applying our own slippage protection
            const expectedVusdOut = applySlippage(vusdFromUsdc, mintFeeBps.toNumber());

            const expectedCrvUsdOut = await crvusdVusdPool.get_dy(VUSD_INDEX, CRVUSD_INDEX_IN_VUSD_POOL, expectedVusdOut);
            const expectedUsdcOutCheap = await crvusdUsdcPool.get_dy(CRVUSD_INDEX_IN_USDC_POOL, USDC_INDEX, expectedCrvUsdOut);

            // --- LIVE PROFIT CHECK ---
            const profit = expectedUsdcOutCheap.sub(repaymentRequired);

            if (profit.gt(MIN_PROFIT_USDC)) {
                console.log(`   ✅ CHEAP Path is profitable! Sim profit: ${ethers.utils.formatUnits(profit, 6)} USDC`);
                txFound = true;
                scenario = 'CHEAP';

                // --- Calculate minOut params for contract call ---
                params = {
                    minVusdOut: applySlippage(expectedVusdOut, SLIPPAGE_BPS),
                    minCrvUsdOut: applySlippage(expectedCrvUsdOut, SLIPPAGE_BPS),
                    minUsdcOut: applySlippage(expectedUsdcOutCheap, SLIPPAGE_BPS), // Apply slippage to final expected amount
                };
                // --- END ---

                 // Safety check: ensure minUsdcOut is still greater than repayment after slippage
                if (params.minUsdcOut.lte(repaymentRequired)) {
                     console.warn('   -> Profit margin too thin after applying slippage tolerance. Skipping.');
                     txFound = false; // Do not proceed
                 } else {
                    populatedTx = await contract.populateTransaction.executeCheapWithDefaultPool(FLASHLOAN_AMOUNT_USDC, params);
                 }
            } else {
                console.log(`   -> Cheap path not profitable enough. (Profit: ${ethers.utils.formatUnits(profit, 6)} USDC, Needed: ${ethers.utils.formatUnits(MIN_PROFIT_USDC, 6)})`);
            }
        } catch (simError: any) {
            console.warn('   -> Cheap path simulation error:', simError.reason || (simError as Error).message);
        }
      }

      if (txFound && populatedTx) {
        console.log(`   -> PROFITABLE trade found! Preparing Flashbots bundle for ${scenario} path...`);
        const block = await provider.getBlock('latest');

        populatedTx.gasLimit = 600000; // Keep gas limit reasonably high
        populatedTx.maxFeePerGas = block.baseFeePerGas!.add(ethers.utils.parseUnits('20', 'gwei')); // Buffer for base fee volatility
        populatedTx.maxPriorityFeePerGas = ethers.utils.parseUnits('2', 'gwei'); // Our bid/tip to the builder
        populatedTx.chainId = (await provider.getNetwork()).chainId;
        populatedTx.nonce = await deployerWallet.getTransactionCount();
        populatedTx.type = 2; // EIP-1559

        console.log('   -> Signing transaction...');
        const signedTx = await deployerWallet.signTransaction(populatedTx);

        // `simulate` expects an array of raw signed transaction strings
        const simulationBundle: string[] = [signedTx];

        console.log('   -> Simulating bundle against next block...');
        const simulation = await flashbotsProvider.simulate(simulationBundle, block.number + 1);

        // --- LIVE SIMULATION CHECK ---
        // Expecting SUCCESS now, revert is a problem
        if (simulationReverted(simulation)) {
          const revertReason = simulation.firstRevert.error || simulation.firstRevert.revert || "Unknown revert reason";
          console.warn(`   -> ⚠️ Simulation REVERTED unexpectedly: ${revertReason}`);
          console.warn(`   -> Profitability might have changed or gasLimit too low. Skipping this opportunity.`);

        } else if ('error' in simulation) {
          console.error(`   -> ❌ Simulation failed with a general error: ${simulation.error.message}`);
        } else {
          // --- SIMULATION SUCCEEDED ---
          console.log(`   -> ✅ Simulation successful!`);
          console.log('   -> Sending private transaction to Flashbots...');

          // Use sendPrivateTransaction for better MEV protection
          const privateTxResponse = await flashbotsProvider.sendPrivateTransaction(
              {
                  transaction: populatedTx, // Send the unsigned tx
                  signer: deployerWallet,    // Provide the signer
              },
              {
                  maxBlockNumber: block.number + 3, // Allow inclusion within the next 3 blocks
              }
          );

          if ('error' in privateTxResponse) {
            console.error('   -> ❌ Private transaction submission error:', privateTxResponse.error.message);
            continue; // Go to next loop iteration
          }

          console.log(`   -> Tx submitted via sendPrivateTransaction. Hash: ${privateTxResponse.transaction.hash}`);
          console.log('   -> Waiting for transaction inclusion (up to 3 blocks)...');

          try {
            // wait(1) waits for 1 confirmation
            const receipt = await privateTxResponse.wait(1);
            console.log(`   -> ✅ SUCCESS: Transaction included in block ${receipt.blockNumber}!`);
            console.log(`   -> Gas Used: ${receipt.gasUsed.toString()}`);
            console.log(`   -> Effective Gas Price: ${ethers.utils.formatUnits(receipt.effectiveGasPrice, 'gwei')} Gwei`);
            console.log(`   -> Transaction Fee: ${ethers.utils.formatEther(receipt.gasUsed.mul(receipt.effectiveGasPrice))} ETH`);
            console.log(`   -> Etherscan: https://etherscan.io/tx/${receipt.transactionHash}`);

          } catch (error: any) {
              // Handle different wait errors
              if (error.code === ethers.errors.TIMEOUT) {
                   console.warn('   -> ⏳ Transaction wait timed out. It might not have been included or is still pending.');
                   console.warn(`   -> Check Etherscan for tx hash: ${privateTxResponse.transaction.hash}`);
              } else if (error.receipt && error.receipt.status === 0) {
                   // Transaction was included but failed on-chain (should be rare if simulation passed)
                   console.error(`   -> ❌ Transaction INCLUDED but FAILED (Reverted) on-chain!`);
                   console.error(`   -> Block: ${error.receipt.blockNumber}, Hash: ${error.receipt.transactionHash}`);
                   console.error(`   -> Check Etherscan for revert reason.`);
              }
               else {
                  console.error('   -> ❌ Error waiting for private transaction inclusion:', error.message);
              }
          }
        } // End of simulation success block
      } // End if (txFound && populatedTx)

    } catch (error: any) {
      console.error('Bot loop error:', error.message, error.stack);
    }

    await sleep(CHECK_INTERVAL_MS);
  } // End while loop
} // End main function

main().catch((error) => {
  console.error('Unhandled error:', error);
  process.exit(1);
});

// scripts/execute-arbitrage-mainnet-funded-test.ts
// STEP 8c: FULL CYCLE FUNDED TEST
// 
// Purpose: Test complete arbitrage flow with funded contract
// - Contract pre-funded with ~10 USDC to cover small losses
// - Looks for trades with simulated loss (to guarantee execution)
// - Submits via Flashbots sendBundle for inclusion
// - Expects transaction to SUCCEED on-chain (status: 1)
// - Expects to PAY GAS from searcher wallet
//
// This verifies the entire pipeline before going live with profitable trades

import { ethers, BigNumber } from 'ethers';
import {
  FlashbotsBundleProvider,
  FlashbotsBundleResolution,
  SimulationResponse,
} from '@flashbots/ethers-provider-bundle';
import * as dotenv from 'dotenv';
import { loadWallet } from '../src/utils/keystore-utils';

dotenv.config();

// --- CONFIGURATION FOR STEP 8c ---
const RPC_URL = process.env.ETHEREUM_RPC_URL!;
const FLASHBOTS_AUTH_KEY = process.env.FLASHBOTS_AUTH_KEY!;
const CONTRACT_ADDRESS = process.env.VUSD_ARBITRAGE_CONTRACT!;
const CHECK_INTERVAL_MS = 15000; // Check every 15 seconds
const FLASHLOAN_AMOUNT_USDC = ethers.utils.parseUnits('1000', 6); // 1,000 USDC
const SLIPPAGE_BPS = 5; // 0.05% slippage tolerance

// STEP 8c: Looking for trades with simulated LOSS (to guarantee execution)
// We want a small loss that the pre-funded contract can cover
const MAX_ACCEPTABLE_LOSS = ethers.utils.parseUnits('5.00', 6); // Accept up to -$5 loss

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

// Type guard to check if simulation response indicates a revert
function isSimulationRevert(simulation: any): simulation is { firstRevert: any } {
  return simulation && typeof simulation === 'object' && simulation.firstRevert !== undefined;
}

// Type guard to check if simulation response has an error
function isSimulationError(simulation: any): simulation is { error: { message: string } } {
  return simulation && typeof simulation === 'object' && simulation.error !== undefined;
}

async function main() {
  console.log('--- VUSD Arbitrage Bot Starting ---');
  console.log('!!! WARNING: RUNNING IN STEP 8c "FULL CYCLE FUNDED TEST" MODE !!!');
  console.log(`Will submit trades with simulated profit > -${ethers.utils.formatUnits(MAX_ACCEPTABLE_LOSS, 6)} USDC`);
  console.log('EXPECT TO PAY GAS and see a successful (status: 1) transaction on chain.');
  console.log(`Ensure contract ${CONTRACT_ADDRESS} has ~10 USDC to cover the potential simulated loss!`);

  // Validate environment variables
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
    process.exit(1);
  }

  // Setup providers and wallets
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

  // Main monitoring loop
  while (true) {
    try {
      console.log(`\n[${new Date().toISOString()}] Simulating trades...`);

      let txFound = false;
      let params: any;
      let populatedTx: any;
      let scenario = '';
      let simulatedProfitLoss: BigNumber = ethers.constants.Zero;

      const flashloanFee = FLASHLOAN_AMOUNT_USDC.div(10000); // 1 bps (0.01%)
      const repaymentRequired = FLASHLOAN_AMOUNT_USDC.add(flashloanFee);

      // --- RICH PATH SIMULATION ---
      try {
        // Step 1: USDC -> crvUSD (Curve USDC/crvUSD pool)
        const expectedCrvUsdOut = await crvusdUsdcPool.get_dy(
          USDC_INDEX,
          CRVUSD_INDEX_IN_USDC_POOL,
          FLASHLOAN_AMOUNT_USDC
        );

        // Step 2: crvUSD -> VUSD (Curve crvUSD/VUSD pool)
        const expectedVusdOut = await crvusdVusdPool.get_dy(
          CRVUSD_INDEX_IN_VUSD_POOL,
          VUSD_INDEX,
          expectedCrvUsdOut
        );

        // Step 3: VUSD -> USDC (VUSD Redeemer with oracle adjustment)
        const oracleData = await oracle.latestRoundData();
        const oracleDecimals = await oracle.decimals();

        if (!oracleData || oracleData.answer === undefined) {
          throw new Error('Oracle data is invalid');
        }

        // Calculate USDC from VUSD based on oracle price
        let usdcFromVusd = expectedVusdOut;
        if (oracleData.answer.gt(ethers.utils.parseUnits('1', oracleDecimals))) {
          const scale = ethers.utils.parseUnits('1', 18);
          usdcFromVusd = expectedVusdOut
            .mul(scale)
            .div(oracleData.answer.mul(BigNumber.from(10).pow(18 - oracleDecimals)));
        }

        // Apply redemption fee
        const vusdRedeemer = new ethers.Contract(VUSD_REDEEMER!, VUSD_REDEEMER_ABI, provider);
        const redeemFeeBps = await vusdRedeemer.redeemFee();
        const expectedUsdcOutRich = applySlippage(usdcFromVusd, redeemFeeBps.toNumber()).div(
          BigNumber.from(10).pow(12)
        );

        // Calculate profit/loss
        const profitLoss = expectedUsdcOutRich.sub(repaymentRequired);

        // Check if this trade meets our test criteria (small loss)
        if (profitLoss.lt(0) && profitLoss.abs().lte(MAX_ACCEPTABLE_LOSS)) {
          console.log(
            `   * RICH Path found for test! Sim P/L: ${ethers.utils.formatUnits(
              profitLoss,
              6
            )} USDC (Accepted Loss <= -${ethers.utils.formatUnits(MAX_ACCEPTABLE_LOSS, 6)})`
          );

          txFound = true;
          scenario = 'RICH';
          simulatedProfitLoss = profitLoss;

          // Calculate parameters with slippage protection
          params = {
            minCrvUsdOut: applySlippage(expectedCrvUsdOut, SLIPPAGE_BPS),
            minVusdOut: applySlippage(expectedVusdOut, SLIPPAGE_BPS),
            minUsdcOut: applySlippage(expectedUsdcOutRich, SLIPPAGE_BPS),
          };

          populatedTx = await contract.populateTransaction.executeRichWithDefaultPool(
            FLASHLOAN_AMOUNT_USDC,
            params
          );
        } else if (profitLoss.gte(0)) {
          console.log(
            `   -> Rich path shows profit: ${ethers.utils.formatUnits(
              profitLoss,
              6
            )} USDC (skipping for this test)`
          );
        } else {
          console.log(
            `   -> Rich path loss too large: ${ethers.utils.formatUnits(
              profitLoss,
              6
            )} USDC (> ${ethers.utils.formatUnits(MAX_ACCEPTABLE_LOSS, 6)})`
          );
        }
      } catch (simError: any) {
        console.warn(
          '   -> Rich path simulation error:',
          simError.reason || (simError as Error).message
        );
      }

      // --- CHEAP PATH SIMULATION ---
      if (!txFound) {
        try {
          // Step 1: USDC -> VUSD (VUSD Minter with oracle adjustment)
          const oracleData = await oracle.latestRoundData();
          const oracleDecimals = await oracle.decimals();

          if (!oracleData || oracleData.answer === undefined) {
            throw new Error('Oracle data is invalid');
          }

          // Calculate VUSD from USDC based on oracle price
          let vusdFromUsdc = FLASHLOAN_AMOUNT_USDC.mul(BigNumber.from(10).pow(12));
          if (oracleData.answer.lt(ethers.utils.parseUnits('1', oracleDecimals))) {
            vusdFromUsdc = FLASHLOAN_AMOUNT_USDC.mul(BigNumber.from(10).pow(12))
              .mul(oracleData.answer)
              .div(BigNumber.from(10).pow(oracleDecimals));
          }

          // Apply minting fee
          const vusdMinter = new ethers.Contract(VUSD_MINTER!, VUSD_MINTER_ABI, provider);
          const mintFeeBps = await vusdMinter.mintingFee();
          const expectedVusdOut = applySlippage(vusdFromUsdc, mintFeeBps.toNumber());

          // Step 2: VUSD -> crvUSD (Curve crvUSD/VUSD pool)
          const expectedCrvUsdOut = await crvusdVusdPool.get_dy(
            VUSD_INDEX,
            CRVUSD_INDEX_IN_VUSD_POOL,
            expectedVusdOut
          );

          // Step 3: crvUSD -> USDC (Curve USDC/crvUSD pool)
          const expectedUsdcOutCheap = await crvusdUsdcPool.get_dy(
            CRVUSD_INDEX_IN_USDC_POOL,
            USDC_INDEX,
            expectedCrvUsdOut
          );

          // Calculate profit/loss
          const profitLoss = expectedUsdcOutCheap.sub(repaymentRequired);

          // Check if this trade meets our test criteria (small loss)
          if (profitLoss.lt(0) && profitLoss.abs().lte(MAX_ACCEPTABLE_LOSS)) {
            console.log(
              `   * CHEAP Path found for test! Sim P/L: ${ethers.utils.formatUnits(
                profitLoss,
                6
              )} USDC (Accepted Loss <= -${ethers.utils.formatUnits(MAX_ACCEPTABLE_LOSS, 6)})`
            );

            txFound = true;
            scenario = 'CHEAP';
            simulatedProfitLoss = profitLoss;

            // Calculate parameters with slippage protection
            params = {
              minVusdOut: applySlippage(expectedVusdOut, SLIPPAGE_BPS),
              minCrvUsdOut: applySlippage(expectedCrvUsdOut, SLIPPAGE_BPS),
              minUsdcOut: applySlippage(expectedUsdcOutCheap, SLIPPAGE_BPS),
            };

            populatedTx = await contract.populateTransaction.executeCheapWithDefaultPool(
              FLASHLOAN_AMOUNT_USDC,
              params
            );
          } else if (profitLoss.gte(0)) {
            console.log(
              `   -> Cheap path shows profit: ${ethers.utils.formatUnits(
                profitLoss,
                6
              )} USDC (skipping for this test)`
            );
          } else {
            console.log(
              `   -> Cheap path loss too large: ${ethers.utils.formatUnits(
                profitLoss,
                6
              )} USDC (> ${ethers.utils.formatUnits(MAX_ACCEPTABLE_LOSS, 6)})`
            );
          }
        } catch (simError: any) {
          console.warn(
            '   -> Cheap path simulation error:',
            simError.reason || (simError as Error).message
          );
        }
      }

      // --- EXECUTE TRADE IF FOUND ---
      if (txFound && populatedTx) {
        console.log(
          `   -> Test trade found! Expected P/L: ${ethers.utils.formatUnits(
            simulatedProfitLoss,
            6
          )} USDC`
        );
        console.log(`   -> Preparing Flashbots bundle for ${scenario} path...`);

        const block = await provider.getBlock('latest');

        // Set EIP-1559 gas parameters
        populatedTx.gasLimit = 600000;
        populatedTx.maxFeePerGas = block.baseFeePerGas!.add(ethers.utils.parseUnits('20', 'gwei'));
        populatedTx.maxPriorityFeePerGas = ethers.utils.parseUnits('15', 'gwei');
        populatedTx.chainId = (await provider.getNetwork()).chainId;
        populatedTx.nonce = await deployerWallet.getTransactionCount();
        populatedTx.type = 2; // EIP-1559

        console.log('   -> Signing transaction...');
        const signedTx = await deployerWallet.signTransaction(populatedTx);

        // Simulate the bundle to ensure it will succeed
        console.log('   -> Simulating bundle against next block...');
        const simulationBundle: string[] = [signedTx];
        const simulation = await flashbotsProvider.simulate(simulationBundle, block.number + 1);

        // --- CRITICAL: HANDLE SIMULATION RESULT ---
        
        // Case 1: Simulation has an error (network issue, invalid params, etc.)
        if (isSimulationError(simulation)) {
          console.error(`   -> ❌ Simulation failed with error: ${simulation.error.message}`);
          console.log('   -> Skipping this trade. Will retry on next loop.');
          continue;
        }

        // Case 2: Simulation reverted (this is BAD for Step 8c - we want success!)
        if (isSimulationRevert(simulation)) {
          const revertReason =
            simulation.firstRevert?.error || simulation.firstRevert?.revert || 'Unknown revert';
          console.error(`   -> ❌ Simulation REVERTED: ${revertReason}`);
          console.error('   -> This trade would fail on-chain. Skipping.');
          console.error('   -> Check: Is contract funded? Are oracle prices within tolerance?');
          continue;
        }

        // Case 3: Simulation succeeded! (This is what we want for Step 8c)
        console.log('   -> ✅ Simulation SUCCEEDED! Trade will execute on-chain.');
        console.log('   -> Now submitting to Flashbots for inclusion...');

        // For Step 8c, we use sendBundle (works with v0.6.0 of the library)
        // This waits for the bundle to be included in the target block
        try {
          const txHash = ethers.utils.keccak256(signedTx);
          
          console.log(`   -> Submitting bundle to Flashbots...`);
          console.log(`   -> Transaction hash: ${txHash}`);

          // Send bundle using sendBundle method
          const bundleTransactions = [{ signedTransaction: signedTx }];
          const targetBlock = block.number + 1;
          
          const bundleResponse = await flashbotsProvider.sendBundle(
            bundleTransactions,
            targetBlock
          );

          if ('error' in bundleResponse) {
            console.error('   -> ❌ Bundle submission error:', bundleResponse.error.message);
            continue;
          }

          console.log('   -> ✅ Bundle submitted to Flashbots!');
          console.log(`   -> Tx Hash: ${txHash}`);
          console.log(`   -> Waiting for bundle inclusion...`);
          console.log(`   -> You can monitor at: https://etherscan.io/tx/${txHash}`);
          
          // Wait for the bundle to be included
          const bundleResolution = await bundleResponse.wait();
          
          // Check if bundle was included
          if (bundleResolution === FlashbotsBundleResolution.BundleIncluded) {
            console.log('   -> ✅ Bundle was included! Now fetching receipt...');
            
            // Wait a moment for transaction to be fully processed
            await sleep(2000);
            
            // Fetch the transaction receipt
            const receipt = await provider.getTransactionReceipt(txHash);

            if (receipt && receipt.status === 1) {
              console.log('\n' + '='.repeat(60));
              console.log('   -> ✅✅✅ SUCCESS! Transaction was included and succeeded on-chain!');
              console.log('   -> Block number:', receipt.blockNumber);
              console.log('   -> Gas used:', receipt.gasUsed.toString());
              console.log('   -> Effective gas price:', ethers.utils.formatUnits(receipt.effectiveGasPrice, 'gwei'), 'Gwei');
              const gasCostEth = receipt.gasUsed.mul(receipt.effectiveGasPrice);
              const gasCostUsd = parseFloat(ethers.utils.formatEther(gasCostEth)) * 3000;
              console.log('   -> Gas cost (ETH):', ethers.utils.formatEther(gasCostEth));
              console.log(`   -> Gas cost (USD, ~$3000/ETH): $${gasCostUsd.toFixed(2)}`);
              console.log(`   -> Transaction link: https://etherscan.io/tx/${receipt.transactionHash}`);
              console.log('='.repeat(60));
              console.log('\n✅ STEP 8c COMPLETE! The full cycle works end-to-end.');
              console.log('Next step: Modify the profitability check to look for POSITIVE profits and go live!');
              console.log('\nExiting after successful test...');
              process.exit(0);
            } else {
              console.error('   -> ❌ Transaction reverted on-chain (status: 0)');
              console.error('   -> This should not happen if simulation passed.');
              if (receipt) {
                console.error(`   -> Tx link: https://etherscan.io/tx/${receipt.transactionHash}`);
              }
            }
          } else if (bundleResolution === FlashbotsBundleResolution.BlockPassedWithoutInclusion) {
            console.log('   -> ⚠️  Bundle was not included in target block. Will retry next loop.');
          } else if (bundleResolution === FlashbotsBundleResolution.AccountNonceTooHigh) {
            console.warn('   -> ⚠️  Nonce error. Will be fixed in next loop.');
          } else {
            console.log(`   -> Bundle resolution: ${FlashbotsBundleResolution[bundleResolution]}`);
          }

        } catch (sendError: any) {
          console.error('   -> ❌ Error sending bundle:', sendError.message);
          console.error('   -> Will retry on next loop.');
        }

      }

    } catch (error: any) {
      console.error('Bot loop error:', error.message);
      if (error.stack) {
        console.error(error.stack);
      }
    }

    console.log(`\n-> Waiting ${CHECK_INTERVAL_MS / 1000}s before next check...`);
    await sleep(CHECK_INTERVAL_MS);
  }
}

main().catch((error) => {
  console.error('Unhandled error:', error);
  process.exit(1);
});

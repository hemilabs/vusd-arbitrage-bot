import { ethers, BigNumber } from 'ethers';
import {
  FlashbotsBundleProvider,
  FlashbotsBundleResolution,
  FlashbotsBundleRawTransaction,
  SimulationResponse,
  // Removed TransactionSimulationRevert as explicit check seems problematic
} from '@flashbots/ethers-provider-bundle';
import * as dotenv from 'dotenv';
import { loadWallet } from '../src/utils/keystore-utils';

dotenv.config();

// --- CONFIGURATION ---
// STEP 8: "NEGATIVE TRADE TEST" MODE
const RPC_URL = process.env.ETHEREUM_RPC_URL!;
const FLASHBOTS_AUTH_KEY = process.env.FLASHBOTS_AUTH_KEY!;
const CONTRACT_ADDRESS = process.env.VUSD_ARBITRAGE_CONTRACT!;
const CHECK_INTERVAL_MS = 15000; // Check every 15 seconds
const FLASHLOAN_AMOUNT_USDC = ethers.utils.parseUnits('1000', 6); // 1,000 USDC
const SLIPPAGE_BPS = 5; // 0.05% slippage tolerance (5 basis points)

// We are looking for a trade that LOSES between $0.01 and $2.00
const MAX_LOSS_TO_TEST = ethers.utils.parseUnits('2.00', 6);
const MIN_LOSS_TO_TEST = ethers.utils.parseUnits('0.01', 6);

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
function simulationReverted(simulation: any): simulation is { firstRevert: { error?: string; revert?: string } } {
  return simulation && typeof simulation === 'object' && simulation.firstRevert !== undefined;
}


async function main() {
  console.log('--- VUSD Arbitrage Bot Starting ---');
  console.log('!!! WARNING: RUNNING IN STEP 8 "NEGATIVE TRADE TEST" MODE !!!');
  console.log(
    'Bot will submit a known-losing trade to test Flashbots reverts.'
  );

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

      const flashloanFee = FLASHLOAN_AMOUNT_USDC.div(10000); // 1 bps
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
        const expectedUsdcOutRich = applySlippage(usdcFromVusd, redeemFeeBps.toNumber()).div(BigNumber.from(10).pow(12));

        const loss = repaymentRequired.sub(expectedUsdcOutRich);

        if (loss.gt(MIN_LOSS_TO_TEST) && loss.lt(MAX_LOSS_TO_TEST)) {
          console.log(`   ✅ RICH Path found for test! Sim loss: ${ethers.utils.formatUnits(loss, 6)} USDC`);
          txFound = true;
          scenario = 'RICH';
          params = {
            minCrvUsdOut: 1, minVusdOut: 1,
            minUsdcOut: expectedUsdcOutRich.add(1), // Guarantees a revert
          };
          populatedTx = await contract.populateTransaction.executeRichWithDefaultPool(FLASHLOAN_AMOUNT_USDC, params);
        } else {
          console.log(`   -> Rich path not in test range. (Loss: ${ethers.utils.formatUnits(loss, 6)} USDC)`);
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
            const expectedVusdOut = applySlippage(vusdFromUsdc, mintFeeBps.toNumber());

            const expectedCrvUsdOut = await crvusdVusdPool.get_dy(VUSD_INDEX, CRVUSD_INDEX_IN_VUSD_POOL, expectedVusdOut);
            const expectedUsdcOutCheap = await crvusdUsdcPool.get_dy(CRVUSD_INDEX_IN_USDC_POOL, USDC_INDEX, expectedCrvUsdOut);

            const loss = repaymentRequired.sub(expectedUsdcOutCheap);

            if (loss.gt(MIN_LOSS_TO_TEST) && loss.lt(MAX_LOSS_TO_TEST)) {
                console.log(`   ✅ CHEAP Path found for test! Sim loss: ${ethers.utils.formatUnits(loss, 6)} USDC`);
                txFound = true;
                scenario = 'CHEAP';
                params = {
                    minVusdOut: 1, minCrvUsdOut: 1,
                    minUsdcOut: expectedUsdcOutCheap.add(1), // Guarantees a revert
                };
                populatedTx = await contract.populateTransaction.executeCheapWithDefaultPool(FLASHLOAN_AMOUNT_USDC, params);
            } else {
                console.log(`   -> Cheap path not in test range. (Loss: ${ethers.utils.formatUnits(loss, 6)} USDC)`);
            }
        } catch (simError: any) {
            console.warn('   -> Cheap path simulation error:', simError.reason || (simError as Error).message);
        }
      }

      if (txFound && populatedTx) {
        console.log(`   -> Test trade found! Preparing Flashbots bundle for ${scenario} path...`);
        const block = await provider.getBlock('latest');

        populatedTx.gasLimit = 600000;
        populatedTx.maxFeePerGas = block.baseFeePerGas!.add(ethers.utils.parseUnits('20', 'gwei'));
        populatedTx.maxPriorityFeePerGas = ethers.utils.parseUnits('2', 'gwei');
        populatedTx.chainId = (await provider.getNetwork()).chainId;
        populatedTx.nonce = await deployerWallet.getTransactionCount();
        populatedTx.type = 2; // Explicitly set EIP-1559 type

        console.log('   -> Signing transaction...');
        const signedTx = await deployerWallet.signTransaction(populatedTx);

        // `simulate` expects an array of raw signed transaction strings
        const simulationBundle: string[] = [signedTx];

        console.log('   -> Simulating bundle against next block...');
        const simulation = await flashbotsProvider.simulate(simulationBundle, block.number + 1);

        // --- REFINED SIMULATION CHECK (v7) ---
        // Use the type guard to check if the simulation result is a revert
        if (simulationReverted(simulation)) {
          const revertReason = simulation.firstRevert.error || simulation.firstRevert.revert || "Unknown revert reason";
          console.log(`   -> ✅ Simulation correctly reverted as expected: ${revertReason}`);
          console.log('   -> Now sending this *known-reverting* bundle to Flashbots...');

          // `sendBundle` expects an array of FlashbotsBundleRawTransaction objects
          const transactionBundle: FlashbotsBundleRawTransaction[] = [
            { signedTransaction: signedTx }
          ];

          const targetBlock = block.number + 1;
          const bundleResponse = await flashbotsProvider.sendBundle(
            transactionBundle,
            targetBlock
          );

          if ('error' in bundleResponse) {
            console.error('   -> ❌ Bundle submission error:', bundleResponse.error.message);
            continue; // Go to next loop iteration
          }

          console.log('   -> Bundle submitted. Waiting for resolution...');
          const waitResponse = await bundleResponse.wait();

          if (waitResponse === FlashbotsBundleResolution.BundleIncluded) {
            console.error('   -> ❌ CRITICAL ERROR: Reverting bundle was INCLUDED!');
            console.error('   -> This should not happen. Check your wallet for gas fees.');
          } else if (
            waitResponse === FlashbotsBundleResolution.BlockPassedWithoutInclusion
          ) {
            console.log('   -> ✅ SUCCESS: Bundle was NOT included (as expected for a reverting tx).');
            console.log('   -> This confirms "gas-free reverts" are working.');
            // Optional: Exit after successful test or continue monitoring
            // console.log("   -> Test successful. Exiting.");
            // process.exit(0);
          } else if (
            waitResponse === FlashbotsBundleResolution.AccountNonceTooHigh
          ) {
            console.warn('   -> Nonce error. Will be fixed in next loop.');
          } else {
            console.log(
              '   -> Bundle status:',
              FlashbotsBundleResolution[waitResponse]
            );
          }
        } else if ('error' in simulation) {
          // Handle general simulation errors (network issues, incorrect setup, etc.)
          console.error(`   -> ❌ Simulation failed with a general error: ${simulation.error.message}`);
        } else {
          // This is the BAD outcome (simulation SUCCEEDED when it should have failed)
          console.error('   -> ❌ SIMULATION DID NOT REVERT AS EXPECTED!', simulation);
          console.error(
            '   -> The simulation SUCCEEDED, which should not happen with our params.'
          );
          console.error('   -> Simulation results:', JSON.stringify(simulation, null, 2));
        }
      } // End if (txFound && populatedTx)

    } catch (error: any) {
      console.error('Bot loop error:', error.message, error.stack);
    }

    await sleep(CHECK_INTERVAL_MS);
  }
}

main().catch((error) => {
  console.error('Unhandled error:', error);
  process.exit(1);
});

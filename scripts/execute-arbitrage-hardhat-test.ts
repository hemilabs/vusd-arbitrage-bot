// scripts/execute-arbitrage-hardhat-test.ts
// DEDICATED SCRIPT for testing the bot against a LOCAL HARDHAT FORK.
// This script sends a REGULAR transaction, not a Flashbots bundle.
// FIXED: Replaced unsafe floating-point math with pure BigNumber math.

import { ethers, BigNumber } from 'ethers';
import * as dotenv from 'dotenv';
import { loadWallet } from '../src/utils/keystore-utils';

dotenv.config();

// --- CONFIGURATION ---
const RPC_URL = "http://127.0.0.1:8545"; // Connect to local Hardhat node
const CONTRACT_ADDRESS = process.env.VUSD_ARBITRAGE_CONTRACT!;
const CHECK_INTERVAL_MS = 5000; // Check faster for testing
const FLASHLOAN_AMOUNT_USDC = ethers.utils.parseUnits('1000', 6);
const SLIPPAGE_BPS = 5; // 0.05%
const MIN_PROFIT_USDC = ethers.utils.parseUnits('0.01', 6); // Set profit low to catch any opportunity

// --- ABIs ---
const VUSD_ARBITRAGE_ABI: any[] = [ { "inputs": [ { "internalType": "address", "name": "_usdc", "type": "address" }, { "internalType": "address", "name": "_crvUsd", "type": "address" }, { "internalType": "address", "name": "_vusd", "type": "address" }, { "internalType": "address", "name": "_vusdMinter", "type": "address" }, { "internalType": "address", "name": "_vusdRedeemer", "type": "address" }, { "internalType": "address", "name": "_curveCrvusdUsdcPool", "type": "address" }, { "internalType": "address", "name": "_curveCrvusdVusdPool", "type": "address" }, { "internalType": "address", "name": "_defaultUniswapV3Pool", "type": "address" }, { "internalType": "bool", "name": "_usdcIsToken1", "type": "bool" }, { "internalType": "int128", "name": "_crvUsdUsdcPoolUsdcIndex", "type": "int128" }, { "internalType": "int128", "name": "_crvUsdUsdcPoolCrvUsdIndex", "type": "int128" }, { "internalType": "int128", "name": "_crvUsdVusdPoolCrvUsdIndex", "type": "int128" }, { "internalType": "int128", "name": "_crvUsdVusdPoolVusdIndex", "type": "int128" } ], "stateMutability": "nonpayable", "type": "constructor" }, { "inputs": [ { "internalType": "uint8", "name": "step", "type": "uint8" } ], "name": "CurveSwapFailed", "type": "error" }, { "inputs": [], "name": "FlashloanFailed", "type": "error" }, { "inputs": [], "name": "InvalidCaller", "type": "error" }, { "inputs": [], "name": "InvalidPath", "type": "error" }, { "inputs": [], "name": "InvalidPool", "type": "error" }, { "inputs": [], "name": "InvalidPoolData", "type": "error" }, { "inputs": [], "name": "MintFailed", "type": "error" }, { "inputs": [], "name": "NotOwner", "type": "error" }, { "inputs": [], "name": "RedeemFailed", "type": "error" }, { "anonymous": false, "inputs": [ { "indexed": false, "internalType": "string", "name": "scenario", "type": "string" }, { "indexed": false, "internalType": "address", "name": "pool", "type": "address" }, { "indexed": false, "internalType": "uint256", "name": "finalBalance", "type": "uint256" }, { "indexed": false, "internalType": "int256", "name": "profitLoss", "type": "int256" } ], "name": "ArbitrageComplete", "type": "event" }, { "anonymous": false, "inputs": [ { "indexed": false, "internalType": "uint256", "name": "usdcBalance", "type": "uint256" }, { "indexed": false, "internalType": "uint256", "name": "repaymentRequired", "type": "uint256" }, { "indexed": false, "internalType": "address", "name": "pool", "type": "address" } ], "name": "BeforeRepayment", "type": "event" }, { "anonymous": false, "inputs": [ { "indexed": false, "internalType": "uint256", "name": "amount", "type": "uint256" }, { "indexed": false, "internalType": "uint256", "name": "fee", "type": "uint256" }, { "indexed": false, "internalType": "address", "name": "pool", "type": "address" }, { "indexed": false, "internalType": "string", "name": "scenario", "type": "string" } ], "name": "FlashloanReceived", "type": "event" }, { "anonymous": false, "inputs": [ { "indexed": false, "internalType": "uint256", "name": "usdcIn", "type": "uint256" }, { "indexed": false, "internalType": "uint256", "name": "vusdOut", "type": "uint256" } ], "name": "MintExecuted", "type": "event" }, { "anonymous": false, "inputs": [ { "indexed": false, "internalType": "uint256", "name": "vusdIn", "type": "uint256" }, { "indexed": false, "internalType": "uint256", "name": "usdcOut", "type": "uint256" } ], "name": "RedeemExecuted", "type": "event" }, { "anonymous": false, "inputs": [ { "indexed": false, "internalType": "uint256", "name": "repaymentAmount", "type": "uint256" }, { "indexed": false, "internalType": "address", "name": "pool", "type": "address" } ], "name": "RepaymentExecuted", "type": "event" }, { "anonymous": false, "inputs": [ { "indexed": false, "internalType": "string", "name": "step", "type": "string" }, { "indexed": false, "internalType": "uint256", "name": "amountIn", "type": "uint256" }, { "indexed": false, "internalType": "uint256", "name": "amountOut", "type": "uint256" }, { "indexed": false, "internalType": "string", "name": "tokenIn", "type": "string" }, { "indexed": false, "internalType": "string", "name": "tokenOut", "type": "string" } ], "name": "SwapExecuted", "type": "event" }, { "inputs": [], "name": "CRVUSD", "outputs": [ { "internalType": "address", "name": "", "type": "address" } ], "stateMutability": "view", "type": "function" }, { "inputs": [], "name": "CRVUSD_USDC_POOL_CRVUSD_INDEX", "outputs": [ { "internalType": "int128", "name": "", "type": "int128" } ], "stateMutability": "view", "type": "function" }, { "inputs": [], "name": "CRVUSD_USDC_POOL_USDC_INDEX", "outputs": [ { "internalType": "int128", "name": "", "type": "int128" } ], "stateMutability": "view", "type": "function" }, { "inputs": [], "name": "CRVUSD_VUSD_POOL_CRVUSD_INDEX", "outputs": [ { "internalType": "int128", "name": "", "type": "int128" } ], "stateMutability": "view", "type": "function" }, { "inputs": [], "name": "CRVUSD_VUSD_POOL_VUSD_INDEX", "outputs": [ { "internalType": "int128", "name": "", "type": "int128" } ], "stateMutability": "view", "type": "function" }, { "inputs": [], "name": "CURVE_CRVUSD_USDC_POOL", "outputs": [ { "internalType": "address", "name": "", "type": "address" } ], "stateMutability": "view", "type": "function" }, { "inputs": [], "name": "CURVE_CRVUSD_VUSD_POOL", "outputs": [ { "internalType": "address", "name": "", "type": "address" } ], "stateMutability": "view", "type": "function" }, { "inputs": [], "name": "DEFAULT_UNISWAP_V3_POOL", "outputs": [ { "internalType": "address", "name": "", "type": "address" } ], "stateMutability": "view", "type": "function" }, { "inputs": [], "name": "USDC", "outputs": [ { "internalType": "address", "name": "", "type": "address" } ], "stateMutability": "view", "type": "function" }, { "inputs": [], "name": "USDC_IS_TOKEN1_IN_DEFAULT_POOL", "outputs": [ { "internalType": "bool", "name": "", "type": "bool" } ], "stateMutability": "view", "type": "function" }, { "inputs": [], "name": "VUSD", "outputs": [ { "internalType": "address", "name": "", "type": "address" } ], "stateMutability": "view", "type": "function" }, { "inputs": [], "name": "VUSD_MINTER", "outputs": [ { "internalType": "address", "name": "", "type": "address" } ], "stateMutability": "view", "type": "function" }, { "inputs": [], "name": "VUSD_REDEEMER", "outputs": [ { "internalType": "address", "name": "", "type": "address" } ], "stateMutability": "view", "type": "function" }, { "inputs": [ { "internalType": "address", "name": "_token", "type": "address" } ], "name": "emergencyWithdraw", "outputs": [], "stateMutability": "nonpayable", "type": "function" }, { "inputs": [ { "internalType": "uint256", "name": "_flashloanAmount", "type": "uint256" }, { "components": [ { "internalType": "uint256", "name": "minVusdOut", "type": "uint256" }, { "internalType": "uint256", "name": "minCrvUsdOut", "type": "uint256" }, { "internalType": "uint256", "name": "minUsdcOut", "type": "uint256" } ], "internalType": "struct VusdArbitrage.CheapParams", "name": "_params", "type": "tuple" } ], "name": "executeCheapWithDefaultPool", "outputs": [], "stateMutability": "nonpayable", "type": "function" }, { "inputs": [ { "internalType": "uint256", "name": "_flashloanAmount", "type": "uint256" }, { "components": [ { "internalType": "uint256", "name": "minCrvUsdOut", "type": "uint256" }, { "internalType": "uint256", "name": "minVusdOut", "type": "uint256" }, { "internalType": "uint256", "name": "minUsdcOut", "type": "uint256" } ], "internalType": "struct VusdArbitrage.RichParams", "name": "_params", "type": "tuple" } ], "name": "executeRichWithDefaultPool", "outputs": [], "stateMutability": "nonpayable", "type": "function" }, { "inputs": [], "name": "owner", "outputs": [ { "internalType": "address", "name": "", "type": "address" } ], "stateMutability": "view", "type": "function" }, { "inputs": [], "name": "resetApprovals", "outputs": [], "stateMutability": "nonpayable", "type": "function" }, { "inputs": [ { "internalType": "uint256", "name": "fee0", "type": "uint256" }, { "internalType": "uint256", "name": "fee1", "type": "uint256" }, { "internalType": "bytes", "name": "data", "type": "bytes" } ], "name": "uniswapV3FlashCallback", "outputs": [], "stateMutability": "nonpayable", "type": "function" }, { "stateMutability": "payable", "type": "receive" } ];
const CURVE_POOL_ABI = ['function get_dy(int128 i, int128 j, uint256 dx) external view returns (uint256)'];
const VUSD_MINTER_ABI = ['function mintingFee() external view returns (uint256)'];
const VUSD_REDEEMER_ABI = ['function redeemFee() external view returns (uint256)'];
const CHAINLINK_ABI = [
    'function latestRoundData() external view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)',
    'function decimals() external view returns (uint8)'
];


// --- ADDRESSES ---
const { VUSD_MINTER, VUSD_REDEEMER, CURVE_CRVUSD_USDC_POOL, CURVE_CRVUSD_VUSD_POOL } = process.env;
const CHAINLINK_USDC_USD = '0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6';

// --- CURVE INDICES ---
const USDC_INDEX = 0;
const CRVUSD_INDEX_IN_USDC_POOL = 1;
const CRVUSD_INDEX_IN_VUSD_POOL = 0;
const VUSD_INDEX = 1;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
function applySlippage(amount: BigNumber, bps: number): BigNumber {
  return amount.mul(10000 - bps).div(10000);
}

async function main() {
  console.log('--- VUSD Arbitrage Bot HARDHAT TEST Starting ---');
  
  const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
  const deployerWallet = await loadWallet(provider);

  console.log(`Hardhat Test Wallet: ${deployerWallet.address}`);
  console.log(`ETH Balance: ${ethers.utils.formatEther(await deployerWallet.getBalance())} ETH`);

  const contract = new ethers.Contract(CONTRACT_ADDRESS, VUSD_ARBITRAGE_ABI, deployerWallet);
  const crvusdUsdcPool = new ethers.Contract(CURVE_CRVUSD_USDC_POOL!, CURVE_POOL_ABI, provider);
  const crvusdVusdPool = new ethers.Contract(CURVE_CRVUSD_VUSD_POOL!, CURVE_POOL_ABI, provider);
  const oracle = new ethers.Contract(CHAINLINK_USDC_USD, CHAINLINK_ABI, provider);
  
  console.log(`Watching contract: ${contract.address}`);
  console.log(`Checking for opportunities every ${CHECK_INTERVAL_MS / 1000}s...`);
  console.log('='.repeat(60));

  while (true) {
    try {
      console.log(`\n[${new Date().toISOString()}] Simulating trades...`);
      
      let profitable = false;
      let params: any;
      let populatedTx: any;
      let scenario = "";

      const flashloanFee = FLASHLOAN_AMOUNT_USDC.div(10000);
      const repaymentRequired = FLASHLOAN_AMOUNT_USDC.add(flashloanFee);

      // --- RICH PATH SIMULATION ---
      try {
        const expectedCrvUsdOut = await crvusdUsdcPool.get_dy(USDC_INDEX, CRVUSD_INDEX_IN_USDC_POOL, FLASHLOAN_AMOUNT_USDC);
        const expectedVusdOut = await crvusdVusdPool.get_dy(CRVUSD_INDEX_IN_VUSD_POOL, VUSD_INDEX, expectedCrvUsdOut);

        const oracleData = await oracle.latestRoundData();
        const oracleDecimals = await oracle.decimals();
        
        // ** SAFETY CHECK **
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

        if (expectedUsdcOutRich.gt(repaymentRequired.add(MIN_PROFIT_USDC))) {
          console.log(`   ✅ RICH Path is profitable! Sim profit: ${ethers.utils.formatUnits(expectedUsdcOutRich.sub(repaymentRequired), 6)} USDC`);
          profitable = true;
          scenario = "RICH";
          params = {
            minCrvUsdOut: applySlippage(expectedCrvUsdOut, SLIPPAGE_BPS),
            minVusdOut: applySlippage(expectedVusdOut, SLIPPAGE_BPS),
            minUsdcOut: applySlippage(expectedUsdcOutRich, SLIPPAGE_BPS),
          };
          
          if (params.minUsdcOut.lte(repaymentRequired)) {
              console.log('   -> Profit margin too thin for slippage. Aborting.');
              profitable = false;
          } else {
               populatedTx = await contract.populateTransaction.executeRichWithDefaultPool(FLASHLOAN_AMOUNT_USDC, params);
          }
        } else {
          console.log(`   -> Rich path not profitable.`);
        }
      } catch (simError: any) {
        console.warn('   -> Rich path simulation error:', simError.reason || simError.message);
      }

      // --- CHEAP PATH SIMULATION ---
      if (!profitable) {
        try {
            const oracleData = await oracle.latestRoundData();
            const oracleDecimals = await oracle.decimals();

            // ** SAFETY CHECK **
            if (!oracleData || oracleData.answer === undefined) {
                throw new Error("Oracle data is invalid");
            }

            let vusdFromUsdc = FLASHLOAN_AMOUNT_USDC.mul(BigNumber.from(10).pow(12)); // convert to 18 decimals
            if (oracleData.answer.lt(ethers.utils.parseUnits("1", oracleDecimals))) {
                // Formula: vusd = usdc * oraclePrice
                // usdc is 6 decimals, vusd needs 18. oraclePrice has oracleDecimals.
                // usdc * 10^12 * price / 10^decimals
                vusdFromUsdc = FLASHLOAN_AMOUNT_USDC
                    .mul(BigNumber.from(10).pow(12)) // Scale USDC to 18 decimals
                    .mul(oracleData.answer)
                    .div(BigNumber.from(10).pow(oracleDecimals));
            }

            const vusdMinter = new ethers.Contract(VUSD_MINTER!, VUSD_MINTER_ABI, provider);
            const mintFeeBps = await vusdMinter.mintingFee();
            const expectedVusdOut = applySlippage(vusdFromUsdc, mintFeeBps.toNumber());

            const expectedCrvUsdOut = await crvusdVusdPool.get_dy(VUSD_INDEX, CRVUSD_INDEX_IN_VUSD_POOL, expectedVusdOut);
            const expectedUsdcOutCheap = (await crvusdUsdcPool.get_dy(CRVUSD_INDEX_IN_USDC_POOL, USDC_INDEX, expectedCrvUsdOut));

            if (expectedUsdcOutCheap.gt(repaymentRequired.add(MIN_PROFIT_USDC))) {
                console.log(`   ✅ CHEAP Path is profitable! Sim profit: ${ethers.utils.formatUnits(expectedUsdcOutCheap.sub(repaymentRequired), 6)} USDC`);
                profitable = true;
                scenario = "CHEAP";
                params = {
                    minVusdOut: applySlippage(expectedVusdOut, SLIPPAGE_BPS),
                    minCrvUsdOut: applySlippage(expectedCrvUsdOut, SLIPPAGE_BPS),
                    minUsdcOut: applySlippage(expectedUsdcOutCheap, SLIPPAGE_BPS),
                };
                
                if (params.minUsdcOut.lte(repaymentRequired)) {
                    console.log('   -> Profit margin too thin for slippage. Aborting.');
                    profitable = false;
                } else {
                     populatedTx = await contract.populateTransaction.executeCheapWithDefaultPool(FLASHLOAN_AMOUNT_USDC, params);
                }
            } else {
                console.log(`   -> Cheap path not profitable.`);
            }
        } catch (simError: any) {
            console.warn('   -> Cheap path simulation error:', simError.reason || simError.message);
        }
      }
      
      if (profitable && populatedTx) {
        console.log(`   -> Profitable ${scenario} trade found! Sending transaction to local fork...`);
        
        try {
            const tx = await deployerWallet.sendTransaction(populatedTx);
            console.log(`   -> Transaction sent: ${tx.hash}`);
            const receipt = await tx.wait();
            console.log(`   -> ✅ Transaction included in fork block: ${receipt.blockNumber}`);
        } catch (execError: any) {
            console.error('   -> ❌ Transaction execution failed on fork:', execError.reason || execError.message);
        }
      }

    } catch (error: any) {
      console.error('Bot loop error:', error.message);
    }
    
    await sleep(CHECK_INTERVAL_MS);
  }
}

main().catch((error) => {
  console.error('Unhandled error:', error);
  process.exit(1);
});



# VUSD Arbitrage Bot

Automated Flashbots arbitrage system exploiting price discrepancies between VUSD and crvUSD on Ethereum mainnet using Uniswap V3 flashloans.

## Current Status: Production Ready

**Version:** 2.0.0 - Mainnet Deployed and Validated

**Contract Address:** [`0x7ea3df7c51815EF99BfEf5d2122C62e9D6308a22`](https://etherscan.io/address/0x7ea3df7c51815EF99BfEf5d2122C62e9D6308a22)

**Validation Transaction:** [`0x6b49307bb3ead03a8732da5f4c43ec300aaafb5cc5f88ec67701ac44246ba1bf`](https://etherscan.io/tx/0x6b49307bb3ead03a8732da5f4c43ec300aaafb5cc5f88ec67701ac44246ba1bf)

**Key Features:**
- Secure smart contract with 5-layer protection (callback verification, slippage protection, reentrancy guards, access control, emergency withdrawal)
- Automated monitoring checks every 15 seconds for opportunities
- 1000 USDC flashloan amount per execution
- Flashbots integration for MEV protection
- Encrypted keystore security (no plaintext private keys)
- ~450,000 gas per execution

---

## Arbitrage Strategy

**RICH Path** (when crvUSD > VUSD price):
```
1. Flashloan 1000 USDC from Uniswap V3
2. Swap USDC → crvUSD (Curve)
3. Swap crvUSD → VUSD (Curve)
4. Redeem VUSD → USDC (VUSD Protocol)
5. Repay flashloan + 0.01% fee
6. Keep profit
```

**CHEAP Path** (when crvUSD < VUSD price):
```
1. Flashloan 1000 USDC from Uniswap V3
2. Mint USDC → VUSD (VUSD Protocol)
3. Swap VUSD → crvUSD (Curve)
4. Swap crvUSD → USDC (Curve)
5. Repay flashloan + 0.01% fee
6. Keep profit
```

---

## Installation

```bash
# Clone and install
git clone https://github.com/mitakash/vusd-arbitrage-bot.git
cd vusd-arbitrage-bot
yarn install

# Configure environment
cp env-example.txt .env
# Edit .env with your settings

# Compile contracts
yarn hardhat compile
```

---

## Configuration

### Required Environment Variables

```bash
# RPC Endpoint (Required)
ETHEREUM_RPC_URL=https://eth-mainnet.g.alchemy.com/v2/YOUR_API_KEY

# Deployed Contract (Required for bot)
VUSD_ARBITRAGE_CONTRACT=0x7ea3df7c51815EF99BfEf5d2122C62e9D6308a22

# Keystore Path (Required - encrypted private key)
KEYSTORE_PATH=/full/path/to/keystore/searcher.json

# Flashbots Auth Key (Required - separate key for bundle signing)
FLASHBOTS_AUTH_KEY=0x...your_flashbots_key...

# All other addresses are pre-configured for mainnet
```

### Keystore Setup

Create encrypted keystore (never use plaintext private keys):

```bash
# Create keystore file
yarn ts-node scripts/create-keystore.ts
# Prompts for: private key, password, output path

# Test keystore
yarn ts-node scripts/test-keystore.ts
```

---

## Testing

### Important: Oracle Freshness Requirement

**⚠️ CRITICAL:** Chainlink oracles must have updated within the last 24 hours or tests will fail. For fork testing (Hardhat/Tenderly), always use a block height from within the last 24 hours.

```typescript
// hardhat.config.ts
hardhat: {
  forking: {
    url: process.env.ETHEREUM_RPC_URL,
    blockNumber: 23633933,  // ⚠️ UPDATE THIS to recent block (within 24h)
  }
}
```

### Local Hardhat Fork Testing

```bash
# Test both RICH and CHEAP scenarios
yarn hardhat run scripts/execute-arbitrage-hardhat-test.ts --network hardhat
```

### Tenderly Fork Testing

```bash
# 1. Create fresh fork at https://dashboard.tenderly.co (use LATEST block)
# 2. Update TENDERLY_RPC_URL in .env
# 3. Fund wallet
./scripts/fund-tenderly-simple.sh

# 4. Deploy and test
yarn hardhat run scripts/deploy-tenderly.ts --network tenderly
yarn hardhat run scripts/test-deployed-contract.ts --network tenderly
```

**Note:** Create fresh Tenderly forks every 2-4 hours to avoid stale oracle data.

---

## Production Usage

### Running the Live Bot

```bash
# Start production bot
yarn ts-node scripts/execute-arbitrage-LIVE.ts

# Bot behavior:
# - Checks for opportunities every 15 seconds
# - Uses 1000 USDC flashloan amount
# - Only executes if profit > $2.00 after all fees
# - Submits via Flashbots for MEV protection
```

### What the Bot Does

1. **Every 15 seconds:**
   - Queries Curve pools for exchange rates
   - Queries Chainlink oracle for VUSD redemption price
   - Queries VUSD protocol for mint/redeem fees
   
2. **Simulates both paths:**
   - Calculates expected outputs for RICH and CHEAP paths
   - Accounts for all fees (flashloan 0.01%, Curve swaps 0.04% each, VUSD fees ~0.036%, gas costs)
   - Determines net profitability

3. **If profitable (> $2.00):**
   - Calculates slippage protection (5 basis points default)
   - Creates transaction with minimum output requirements
   - Submits Flashbots bundle to relay
   - Monitors for inclusion

4. **Logs all activity:**
   - Opportunity checks
   - Profit calculations
   - Execution attempts
   - Transaction results

---

## Key Scripts Reference

### Production Scripts

| Script | Purpose |
|--------|---------|
| `execute-arbitrage-LIVE.ts` | Main production bot (15s interval, 1000 USDC flashloan) |
| `deploy-vusd-arbitrage-robust.ts` | Deploy contract to mainnet with robust error handling |

### Testing Scripts

| Script | Purpose |
|--------|---------|
| `execute-arbitrage-hardhat-test.ts` | Test on local fork (requires recent block within 24h) |
| `test-deployed-contract.ts` | Test deployed contract on Tenderly |
| `execute-arbitrage-mainnet-public-test.ts` | Validate on-chain logic with public transaction |
| `execute-arbitrage-mainnet-funded-test.ts` | Test via Flashbots (may not be included if not profitable) |
| `test-deployed-mainnet-contract.ts` | Sanity check (designed to revert for validation) |

### Utility Scripts

| Script | Purpose |
|--------|---------|
| `calculate-min-flashbots-priority-fee.ts` | Analyze blocks and recommend gas fees |
| `diagnose-arbitrage.ts` | Debug profitability calculations |
| `create-keystore.ts` | Create encrypted keystore file |
| `test-keystore.ts` | Verify keystore functionality |
| `check-balance.ts` | Check wallet/contract balance |
| `test-env.ts` | Validate environment configuration |

---

## Smart Contract Architecture

### Security Layers

**1. Callback Protection:**
```solidity
address private s_activePool;  // Only the initiated pool can callback

function executeRich(...) external onlyOwner {
    s_activePool = poolAddress;  // Set before flashloan
    pool.flash(...);
    s_activePool = address(0);   // Clear after
}

function uniswapV3FlashCallback(...) external {
    if (msg.sender != s_activePool) revert UnauthorizedCallback();
    // Prevents malicious pools from calling callback
}
```

**2. Slippage Protection:**
```solidity
struct RichParams {
    uint256 minCrvUsdOut;  // Minimum from each swap
    uint256 minVusdOut;
    uint256 minUsdcOut;
}

// Off-chain bot calculates these, on-chain contract enforces them
```

**3. Reentrancy Protection:** OpenZeppelin ReentrancyGuard on callback

**4. Access Control:** Owner-only execution functions

**5. Emergency Controls:** Owner can withdraw stuck funds

### Gas Optimization

- Immutable variables for addresses (save SLOAD gas)
- Custom errors instead of revert strings
- Single approval in constructor
- Solidity 0.8.28 with IR optimization
- Result: ~450,000 gas per execution

---

## Key Contract Addresses

```
Deployed Contract:
└── VusdArbitrageBot: 0x7ea3df7c51815EF99BfEf5d2122C62e9D6308a22

Protocol Addresses (all mainnet):
├── USDC: 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48
├── crvUSD: 0xf939E0A03FB07F59A73314E73794Be0E57ac1b4E
├── VUSD: 0x677ddbd918637E5F2c79e164D402454dE7dA8619
├── VUSD Minter: 0x3C8aeF08d90C2418f8AE887af47ba7d8Db88AF6b
├── VUSD Redeemer: 0x43c704BC0F773B529E871EAAF4E283C2233512F9
├── Curve crvUSD/USDC: 0x4DEcE678ceceb27446b35C672dC7d61F30bAD69E
├── Curve crvUSD/VUSD: 0xB1c189dfDe178FE9F90E72727837cC9289fB944F
└── Uniswap V3 USDC/DAI (0.01%): 0x5777d92f208679DB4b9778590Fa3CAB3aC9e2168
```

---

## Troubleshooting

### Common Issues

**"Insufficient balance" error:**
```bash
yarn ts-node scripts/check-balance.ts mainnet
# Ensure you have ETH for gas (at least 0.01 ETH)
```

**"Keystore decryption failed":**
```bash
# Verify keystore file exists and test with correct password
yarn ts-node scripts/test-keystore.ts
```

**"Bundle not included" (Flashbots):**
This is normal if the trade is not profitable enough. Flashbots builders only include bundles with sufficient MEV or priority fees to justify the gas usage.

**"Oracle price stale" error:**
- For Tenderly: Create fresh fork at latest block
- For Hardhat: Update `blockNumber` in `hardhat.config.ts` to recent block (within last 24 hours)

**Transaction reverts on mainnet:**
```bash
# Run diagnostics to check profitability calculations
yarn ts-node scripts/diagnose-arbitrage.ts
```

---

## Fee Structure & Performance

**Per 1000 USDC Flashloan:**
- Flashloan fee: 0.01% = $0.10
- Curve swaps: 0.04% each × 2 = $0.80
- VUSD mint/redeem: ~0.036% each = ~$0.72
- Gas cost: $3-10 (depends on gas price)
- **Total costs: ~$4.62-11.62 per execution**

**Bot only executes if net profit > $2.00 after all fees.**

**Validation Test Results** (Block 23635877):
- Scenario: RICH path with 1000 USDC
- Simulated P/L: -$1.28 USDC
- Actual P/L: -$1.26 USDC
- Simulation accuracy: 98.4%
- Gas used: 447,892 (vs predicted 450,000)
- Status: ✅ SUCCESS

**Production Configuration:**
- Check interval: 15 seconds (240 checks/hour)
- Flashloan amount: 1000 USDC per execution
- Minimum profit threshold: $2.00 net after all fees
- Expected opportunities: Variable, 2-10 per day typical

---

## Security Best Practices

1. **Never commit `.env` file** - contains sensitive configuration
2. **Use encrypted keystores** - never plaintext private keys in code or environment variables
3. **Separate Flashbots key** - use different key from execution wallet
4. **Monitor contract balance** - withdraw profits regularly
5. **Start with small amounts** - use 1000 USDC flashloan initially
6. **Review logs regularly** - check for unusual activity
7. **Use Flashbots in production** - prevents front-running and MEV attacks

---

## Project Structure

```
├── contracts/
│   └── VusdArbitrageBot.sol          # Production contract (hardened v2.0)
├── scripts/
│   ├── execute-arbitrage-LIVE.ts     # Main production bot
│   ├── deploy-vusd-arbitrage-robust.ts
│   ├── execute-arbitrage-hardhat-test.ts
│   ├── test-deployed-contract.ts
│   └── ... (other testing/utility scripts)
├── src/utils/
│   ├── keystore-utils.ts             # Secure key management
│   ├── logger.ts                     # Logging utilities
│   └── config.ts                     # Configuration
├── keystore/                         # Encrypted keystores (not committed)
├── typechain-types/                  # Generated contract types
└── logs/                             # Bot execution logs
```

---

**Status:** Production Ready - Validated on Mainnet  
**Last Updated:** October 2025  
**Contract:** [0x7ea3df7c51815EF99BfEf5d2122C62e9D6308a22](https://etherscan.io/address/0x7ea3df7c51815EF99BfEf5d2122C62e9D6308a22)  
**License:** 

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

# VUSD Arbitrage Bot

Flashloan-based arbitrage system designed to exploit price deviations between VUSD and crvUSD on Ethereum mainnet.

## ⚠️ Current Status: Blocked

**This project is functionally complete but cannot execute due to external protocol restrictions.**

The VUSD Minter and Redeemer contracts use Compound III (Comet) for collateral management. Compound III has reentrancy protection that blocks transactions originating from flashloan callbacks. Manual mint/redeem transactions work, but programmatic execution from within a Uniswap V3 flashloan context is blocked.

See [PROJECT_SUMMARY.md](./PROJECT_SUMMARY.md) for complete details on the blocking issue and alternative approaches.

## Project Overview

### Arbitrage Strategy

**RICH Path** (when crvUSD > VUSD):
```
USDC → crvUSD (Curve) → VUSD (Curve) → USDC (Redeem)
```

**CHEAP Path** (when crvUSD < VUSD):
```
USDC → VUSD (Mint) → crvUSD (Curve) → USDC (Curve)
```

### Architecture

**On-Chain:**
- `VusdArbitrageBot.sol` - Smart contract implementing Uniswap V3 flashloan callback
- Atomic execution of multi-step arbitrage paths
- Built-in reentrancy protection and ownership controls

**Off-Chain:**
- Price monitoring for arbitrage opportunities
- Profitability simulation accounting for fees and oracle impacts
- Chainlink oracle price validation

## Installation

### Prerequisites

- Node.js v16+ 
- Yarn
- Ethereum RPC endpoint (Alchemy, Infura, etc.)
- Tenderly account (for testing)

### Setup

```bash
# Clone repository
git clone <repo-url>
cd vusd-arbitrage-bot

# Install dependencies
yarn install

# Copy environment template
cp env-example.txt .env

# Configure .env with your credentials
# ETHEREUM_RPC_URL - Your Ethereum RPC endpoint
# SEARCHER_PRIVATE_KEY - Private key for deployments/testing
# (Other addresses are pre-configured for mainnet)
```

### Compile Contracts

```bash
yarn hardhat compile
```

## Project Structure

```
contracts/
  VusdArbitrageBot.sol          # Main arbitrage contract

scripts/
  deploy-vusd-arbitrage.ts      # Deployment script with token index discovery
  check-mainnet-vs-fork-oracle.ts  # Oracle staleness validation
  check-oracle-state.ts         # Quick oracle check on any network
  check-redeemer-oracle.ts      # Verify Redeemer oracle configuration

test/
  test-vusd-tenderly.ts         # Basic integration tests
  test-vusd-tenderly-debug.ts   # Debug version with detailed error output

src/
  profit-simulator.ts           # Off-chain profitability calculations
  oracle-price-fetcher.ts       # Chainlink oracle interface
  curve-quote-provider.ts       # Curve pool price quotes
  price-monitor.ts              # Price deviation monitoring
  dex-providers/                # DEX integration modules
  utils/                        # Shared utilities
  types/                        # TypeScript type definitions
```

## Usage

### Testing on Tenderly Fork

1. **Create Tenderly Fork:**
   - Go to https://dashboard.tenderly.co
   - Create a new Virtual TestNet from latest mainnet block
   - Copy the RPC URL

2. **Update Configuration:**
   ```typescript
   // hardhat.config.ts
   tenderly: {
     url: "YOUR_TENDERLY_RPC_URL",
     accounts: [process.env.SEARCHER_PRIVATE_KEY]
   }
   ```

3. **Fund Test Account:**
   ```bash
   curl -X POST "YOUR_TENDERLY_RPC_URL" \
     -H "Content-Type: application/json" \
     --data '{
       "jsonrpc":"2.0",
       "method":"tenderly_addBalance",
       "params":["YOUR_ADDRESS", "0x56BC75E2D63100000"],
       "id":1
     }'
   ```

4. **Verify Oracle Freshness:**
   ```bash
   # Check if oracle data is recent enough
   yarn hardhat run scripts/check-mainnet-vs-fork-oracle.ts
   
   # Oracle must be < 24 hours old or transactions will revert
   ```

5. **Run Tests:**
   ```bash
   # Basic test
   yarn hardhat test --network tenderly test/test-vusd-tenderly.ts
   
   # Debug version with detailed error output
   yarn hardhat test --network tenderly test/test-vusd-tenderly-debug.ts
   ```

### Deployment

```bash
# Deploy to Tenderly fork
yarn hardhat run scripts/deploy-vusd-arbitrage.ts --network tenderly

# Deploy to mainnet (not recommended due to blocking issue)
yarn hardhat run scripts/deploy-vusd-arbitrage.ts --network mainnet
```

### Off-Chain Scripts

**Check Oracle State:**
```bash
yarn hardhat run scripts/check-oracle-state.ts --network tenderly
```

**Test Profit Simulator:**
```bash
npx ts-node src/test-profit-simulator.ts
```

**Test Oracle Fetcher:**
```bash
npx ts-node src/test-oracle-fetcher.ts
```

## Key Contracts & Addresses

All mainnet addresses are configured in `.env.example`:

| Contract | Address | Notes |
|----------|---------|-------|
| USDC | `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48` | 6 decimals |
| crvUSD | `0xf939E0A03FB07F59A73314E73794Be0E57ac1b4E` | 18 decimals |
| VUSD | `0x677ddbd918637E5F2c79e164D402454dE7dA8619` | 18 decimals |
| VUSD Minter | `0x3C8aeF08d90C2418f8AE887af47ba7d8Db88AF6b` | Mint fee: 0.01% |
| VUSD Redeemer | `0x43c704BC0F773B529E871EAAF4E283C2233512F9` | Redeem fee: 0.10% |
| Curve crvUSD/USDC | `0x4DEcE678ceceb27446b35C672dC7d61F30bAD69E` | StableSwap NG |
| Curve crvUSD/VUSD | `0xB1c189dfDe178FE9F90E72727837cC9289fB944F` | StableSwap NG |
| Uniswap V3 USDC Pool | `0x919b20Ac45304AEB09C9df5c604b3CD9D99a51cA` | 0.01% fee tier |
| Chainlink USDC/USD | `0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6` | 24hr stale period |

## Technical Details

### Oracle Impact

The VUSD Minter and Redeemer use Chainlink USDC/USD oracle to adjust mint/redeem ratios:

**Minting:** If oracle reports USDC = $0.99, you receive 0.99 VUSD per USDC (on top of 0.01% mint fee)

**Redeeming:** If oracle reports USDC = $1.01, you receive 0.99 USDC per VUSD (on top of 0.10% redeem fee)

**Staleness Check:** Oracle price must be < 24 hours old or transactions revert with "oracle-price-is-stale"

**Tolerance:** Oracle price must be within 1% of $1.00 ($0.99 - $1.01) or transactions revert with "oracle-price-exceed-tolerance"

### Curve Pool Token Indices

The deployment script automatically discovers token ordering:

**crvUSD/USDC Pool:**
- Index 0: USDC
- Index 1: crvUSD

**crvUSD/VUSD Pool:**
- Index 0: crvUSD  
- Index 1: VUSD

### Flashloan Mechanics

The contract uses Uniswap V3's `flash()` function:
- Borrows USDC (token0 in the pool)
- Executes arbitrage logic in `uniswapV3FlashCallback()`
- Repays loan + 0.01% fee
- Any profit remains in contract for owner withdrawal

### Gas Estimates

Based on mainnet simulation:
- RICH path: ~525,000 gas
- CHEAP path: ~320,000 gas

At 30 gwei and $2500 ETH:
- RICH: ~$39 gas cost
- CHEAP: ~$24 gas cost

Minimum profitable spread needs to cover these costs.

## The Blocking Issue

### Why It Fails

1. Bot calls `executeRich()` or `executeCheap()`
2. Uniswap V3 pool calls `uniswapV3FlashCallback()`
3. Callback invokes VUSD Minter/Redeemer
4. Minter/Redeemer calls VUSD Treasury
5. Treasury calls Compound III Comet `supply()` or `withdrawTo()`
6. **Compound III reentrancy guard detects nested call**
7. Transaction reverts with empty error: `.0x(0x)`

### Why Manual Transactions Work

Manual transactions from wallets/frontends are top-level calls. There's no flashloan callback context, so Compound III allows them.

### Evidence

Tenderly transaction traces show:
- Successful entry into flashloan callback ✓
- Successful calls to Curve pools ✓
- Successful entry into Minter/Redeemer ✓
- Revert inside `CometWithExtendedAssetList` ✗

This confirms the issue is Compound III's security architecture, not contract logic.

## Alternative Approaches

See [PROJECT_SUMMARY.md](./PROJECT_SUMMARY.md) for detailed analysis of:

1. **Capitalized Arbitrage** - Use own USDC, no flashloans
2. **Different Protocols** - Find alternatives to VUSD that don't use Compound III
3. **Off-Chain Atomic** - Use Flashbots bundle multiple transactions
4. **Multi-Block Strategy** - Accept price risk between transactions

## Development

### Run Type Checking
```bash
npx tsc --noEmit
```

### Run Linter
```bash
npx eslint . --ext .ts
```

### Generate TypeChain Types
```bash
yarn hardhat compile
# Types generated in typechain-types/
```

## Debugging Tips

**Oracle is Stale:**
```bash
# Check oracle age
yarn hardhat run scripts/check-oracle-state.ts --network tenderly

# If > 24 hours, create fresh Tenderly fork from latest block
```

**Transaction Reverts Without Error:**
```bash
# Use debug test for detailed output
yarn hardhat test --network tenderly test/test-vusd-tenderly-debug.ts

# Check Tenderly dashboard transaction trace
# Look for REVERT in call trace
```

**Insufficient Funds:**
```bash
# Fund Tenderly test account
curl -X POST "YOUR_TENDERLY_RPC_URL" \
  -H "Content-Type: application/json" \
  --data '{"jsonrpc":"2.0","method":"tenderly_addBalance","params":["YOUR_ADDRESS","0x56BC75E2D63100000"],"id":1}'
```

## Security Considerations

**Private Keys:**
- Never commit `.env` file
- Use separate keys for testing
- Mainnet deployment not recommended due to blocking issue

**Smart Contract:**
- Owner-only execution functions
- Reentrancy guard on callback
- Validates flashloan caller address
- Emergency withdrawal function

**Oracle Dependence:**
- System relies on Chainlink oracle accuracy
- 24-hour staleness limit
- 1% deviation tolerance

## License

MIT

## Acknowledgments

Built during investigation of VUSD/crvUSD arbitrage opportunities. While the original goal is blocked by Compound III architecture, the codebase demonstrates:
- Proper Uniswap V3 flashloan integration
- Curve StableSwap pool interaction
- Chainlink oracle integration
- Comprehensive testing on Tenderly forks
- Thorough debugging methodology

The technical work and findings may be valuable for other DeFi arbitrage projects.

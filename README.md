# VUSD Arbitrage Bot

Automated arbitrage system for exploiting price deviations between VUSD and crvUSD on Ethereum mainnet using Uniswap V3 flashloans.

## Current Status: Tested and Working

**Version:** 1.0.0 - Tested on Hardhat and Tenderly Forks

The arbitrage contract has been successfully tested on both local Hardhat fork and Tenderly fork at block 23592043 (October 16, 2025). Both RICH and CHEAP arbitrage paths execute successfully with expected fee losses.

**Test Results:**
- RICH scenario: -1.74 USDC loss (expected fees and slippage)
- CHEAP scenario: -0.32 USDC loss (expected fees and slippage)
- Average gas usage: 474,095 gas per execution
- Block tested: 23592043

**Next Steps:**
1. Implement keystore security for private key management
2. Deploy to Ethereum mainnet
3. Set up monitoring and automated execution

See [PROJECT_SUMMARY.md](./PROJECT_SUMMARY.md) for complete project status and technical details.

---

## Project Overview

### Arbitrage Strategy

The bot executes two arbitrage scenarios based on price relationships:

**RICH Path** (when crvUSD trades above VUSD):
```
1. Flashloan USDC from Uniswap V3
2. Swap USDC -> crvUSD (Curve)
3. Swap crvUSD -> VUSD (Curve)
4. Redeem VUSD -> USDC (VUSD Protocol)
5. Repay flashloan + fee
```

**CHEAP Path** (when crvUSD trades below VUSD):
```
1. Flashloan USDC from Uniswap V3
2. Mint USDC -> VUSD (VUSD Protocol)
3. Swap VUSD -> crvUSD (Curve)
4. Swap crvUSD -> USDC (Curve)
5. Repay flashloan + fee
```

### Architecture

**Smart Contract (On-Chain):**
- VusdArbitrage.sol - Production-ready arbitrage execution contract
- Implements Uniswap V3 flashloan callback interface
- Dynamic pool selection with auto-detection of token positions
- Built-in reentrancy protection (ReentrancyGuard)
- Owner-only execution controls
- Emergency withdrawal functionality
- Comprehensive event logging for monitoring

**Off-Chain Components (Future):**
- Price monitoring for arbitrage opportunity detection
- Profitability simulation accounting for all fees
- Automated execution system
- MEV protection via Flashbots

---

## Installation

### Prerequisites

- Node.js v16 or higher
- Yarn package manager
- Ethereum RPC endpoint (Alchemy, Infura, or similar)
- Tenderly account (for testing on mainnet fork)

### Setup

```bash
# Clone repository
git clone <repository-url>
cd vusd-arbitrage-bot

# Install dependencies
yarn install

# Copy environment template
cp env-example.txt .env

# Configure .env with your credentials
# ETHEREUM_RPC_URL - Your Ethereum RPC endpoint
# SEARCHER_PRIVATE_KEY - Private key for deployments (will migrate to keystore)
# Other addresses are pre-configured for mainnet
```

### Compile Contracts

```bash
# Clean previous builds
yarn hardhat clean

# Compile contracts
yarn hardhat compile
```

---

## Project Structure

```
contracts/
  VusdArbitrageBot.sol          # Main arbitrage contract (production version)

scripts/
  deploy-tenderly.ts            # Deploy to Tenderly fork with proper gas settings
  test-deployed-contract.ts     # Test deployed contract on Tenderly
  test-local-hardhat.ts         # Test on local Hardhat fork with whale funding
  check-balance.ts              # Check wallet balance on any network
  test-env.ts                   # Validate environment configuration
  deploy-vusd-arbitrage-robust.ts  # Mainnet deployment script
  deploy-with-proper-gas.ts     # Deploy with current gas prices
  replace-stuck-deployment.ts   # Replace stuck deployment transactions
  fund-tenderly-simple.sh       # Fund Tenderly wallet with ETH

src/
  profit-simulator.ts           # Off-chain profitability calculations
  oracle-price-fetcher.ts       # Chainlink oracle interface
  curve-quote-provider.ts       # Curve pool price quotes
  price-monitor.ts              # Price deviation monitoring
  arbitrage-executor.ts         # Automated execution logic
  dex-providers/                # DEX integration modules
  utils/                        # Shared utilities and configuration
  types/                        # TypeScript type definitions

test/
  test-all-flashloan-scenarios.ts  # Comprehensive scenario tests

backups/
  VusdArbitrageBot-Debug.sol    # Debug version with console.log statements
```

---

## Testing

### Local Hardhat Fork Testing

Test on a local mainnet fork with impersonated whale accounts:

```bash
# Test both RICH and CHEAP scenarios
yarn hardhat run scripts/test-local-hardhat.ts --network hardhat
```

**Expected Output:**
- Contract deployment successful
- Whale funding: 10,000 USDC transferred to contract
- RICH scenario: Executes with small loss (fees)
- CHEAP scenario: Executes with small loss (fees)
- Detailed console output showing each step

### Tenderly Fork Testing

Test on a Tenderly virtual testnet (mainnet fork):

**Step 1: Create Tenderly Fork**
1. Go to https://dashboard.tenderly.co
2. Create new Virtual TestNet from latest mainnet block
3. Copy RPC URL

**Step 2: Update Configuration**
```typescript
// hardhat.config.ts - Update tenderly network URL
tenderly: {
  url: "https://virtual.mainnet.eu.rpc.tenderly.co/YOUR_FORK_ID",
  accounts: [process.env.SEARCHER_PRIVATE_KEY]
}
```

**Step 3: Fund Test Wallet**
```bash
# Fund with 100 ETH for testing
./scripts/fund-tenderly-simple.sh
```

**Step 4: Deploy Contract**
```bash
yarn hardhat run scripts/deploy-tenderly.ts --network tenderly
```

**Step 5: Test Deployed Contract**
```bash
yarn hardhat run scripts/test-deployed-contract.ts --network tenderly
```

**Expected Results:**
- Deployment successful with contract address
- USDC purchased via Uniswap for testing
- RICH scenario executes successfully
- CHEAP scenario executes successfully
- Events emitted for all steps
- Gas usage approximately 474k per scenario

---

## Deployment

### Deploy to Tenderly (Testing)

```bash
# Deploy contract
yarn hardhat run scripts/deploy-tenderly.ts --network tenderly

# Test the deployed contract
yarn hardhat run scripts/test-deployed-contract.ts --network tenderly
```

### Deploy to Mainnet (Production)

**Requirements:**
- Minimum 0.01 ETH in deployer wallet for gas
- Keystore security implemented (recommended)
- Contract verified on Etherscan (optional but recommended)

```bash
# Check wallet balance and gas prices
yarn hardhat run scripts/check-balance.ts mainnet

# Validate environment configuration
yarn hardhat run scripts/test-env.ts

# Deploy with robust error handling
yarn hardhat run scripts/deploy-vusd-arbitrage-robust.ts --network mainnet
```

---

## Key Contracts and Addresses

All mainnet addresses configured in `.env`:

| Contract | Address | Notes |
|----------|---------|-------|
| USDC | 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48 | 6 decimals |
| crvUSD | 0xf939E0A03FB07F59A73314E73794Be0E57ac1b4E | 18 decimals |
| VUSD | 0x677ddbd918637E5F2c79e164D402454dE7dA8619 | 18 decimals |
| VUSD Minter | 0x3C8aeF08d90C2418f8AE887af47ba7d8Db88AF6b | Mint fee: ~0.036% |
| VUSD Redeemer | 0x43c704BC0F773B529E871EAAF4E283C2233512F9 | Redeem fee: ~0.036% |
| Curve crvUSD/USDC | 0x4DEcE678ceceb27446b35C672dC7d61F30bAD69E | StableSwap NG |
| Curve crvUSD/VUSD | 0xB1c189dfDe178FE9F90E72727837cC9289fB944F | StableSwap NG |
| Uniswap V3 USDC/DAI | 0x5777d92f208679DB4b9778590Fa3CAB3aC9e2168 | 0.01% fee (default) |

---

## Technical Details

### Contract Features

**Dynamic Pool Selection:**
- Supports any Uniswap V3 pool with USDC
- Auto-detects USDC position (token0 or token1)
- Default pool: USDC/DAI 0.01% (31M liquidity, lowest fees)
- Can override with custom pool for larger trades

**Security Features:**
- ReentrancyGuard protection on callback
- Owner-only execution functions
- Validates flashloan caller is expected pool
- Custom error types for gas-efficient reverts
- Emergency withdrawal for stuck funds

**Event Logging:**
- FlashloanReceived: Track flashloan execution
- SwapExecuted: Monitor each swap step
- MintExecuted/RedeemExecuted: VUSD protocol interactions
- BeforeRepayment/RepaymentExecuted: Flashloan repayment
- ArbitrageComplete: Final profit/loss calculation

### Gas Optimization

The contract uses:
- Immutable variables for addresses (save SLOAD gas)
- Custom errors instead of revert strings
- Single approval in constructor (save gas per trade)
- Solidity 0.8.28 with IR-based compiler optimization
- Optimized for 200 runs

**Gas Estimates (Block 23592043):**
- RICH path: 474,095 gas
- CHEAP path: 474,044 gas
- Deployment: Approximately 2M gas

### Fee Structure

**Transaction Fees:**
- Uniswap V3 flashloan: 0.01% of borrowed amount
- Curve swaps: 0.04% per swap (2 swaps per path)
- VUSD mint: Approximately 0.036% + oracle impact
- VUSD redeem: Approximately 0.036% + oracle impact

**Total Expected Fees:**
- RICH path: Approximately 1.5-2 USDC per 1000 USDC flashloan
- CHEAP path: Approximately 0.3-0.5 USDC per 1000 USDC flashloan

### Curve Pool Configuration

**crvUSD/USDC Pool:**
- Index 0: USDC (0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48)
- Index 1: crvUSD (0xf939E0A03FB07F59A73314E73794Be0E57ac1b4E)

**crvUSD/VUSD Pool:**
- Index 0: crvUSD (0xf939E0A03FB07F59A73314E73794Be0E57ac1b4E)
- Index 1: VUSD (0x677ddbd918637E5F2c79e164D402454dE7dA8619)

Indices are automatically validated during deployment.

---

## Usage Examples

### Execute RICH Arbitrage

```solidity
// From owner wallet
contract.executeRichWithDefaultPool(1000 * 10**6); // 1000 USDC flashloan
```

### Execute CHEAP Arbitrage

```solidity
// From owner wallet
contract.executeCheapWithDefaultPool(1000 * 10**6); // 1000 USDC flashloan
```

### Use Custom Uniswap V3 Pool

```solidity
// For larger trades, use pool with more liquidity
address customPool = 0x...; // USDC/WETH 0.05% pool
uint256 amount = 10000 * 10**6; // 10k USDC
contract.executeRich(customPool, amount);
```

### Emergency Withdrawal

```solidity
// Withdraw stuck tokens (owner only)
contract.emergencyWithdraw(USDC_ADDRESS);
```

---

## Development

### Type Checking

```bash
npx tsc --noEmit
```

### Generate TypeChain Types

```bash
yarn hardhat compile
# Types generated in typechain-types/
```

### Run Specific Test

```bash
yarn hardhat run scripts/test-local-hardhat.ts --network hardhat
```

---

## Troubleshooting

### Transaction Reverts

**Check gas limit:**
```javascript
// Increase gas limit if needed
{ gasLimit: 5000000 }
```

**Check wallet balance:**
```bash
yarn hardhat run scripts/check-balance.ts tenderly
```

**Check contract has USDC:**
```bash
# Contract needs initial USDC for testing
# Either transfer manually or use test script whale funding
```

### Insufficient Liquidity

If flashloan amount is too large for default pool:
- Use USDC/WETH 0.05% or 0.3% pool (more liquidity)
- Reduce flashloan amount
- Check pool reserves on Uniswap analytics

### Environment Issues

```bash
# Validate all environment variables
yarn hardhat run scripts/test-env.ts
```

---

## Security Considerations

**Private Key Management:**
- Never commit .env file to version control
- Use separate keys for testing vs. production
- Implement keystore encryption (planned next step)
- Consider hardware wallet for mainnet deployment

**Smart Contract Security:**
- Owner-only execution prevents unauthorized access
- ReentrancyGuard protects against reentrancy attacks
- Validates flashloan caller to prevent malicious pools
- Emergency withdrawal for recovery of stuck funds
- Extensive testing on forks before mainnet deployment

**Operational Security:**
- Monitor contract balance regularly
- Set up alerts for unusual transactions
- Use Flashbots for MEV protection (planned)
- Regular audits of profitable opportunities

---

## Roadmap

### Phase 1: Security Implementation (Current)
- Implement keystore-based private key management
- Remove plaintext private keys from environment
- Test keystore integration with all scripts

### Phase 2: Mainnet Deployment
- Deploy contract to Ethereum mainnet
- Verify contract on Etherscan
- Fund contract with initial capital
- Execute test transactions with small amounts

### Phase 3: Automation
- Implement automated price monitoring
- Build profit calculation system
- Set up automated execution via Flashbots
- Deploy monitoring and alerting infrastructure

### Phase 4: Optimization
- Gas optimization based on mainnet data
- MEV protection strategies
- Multi-pool routing for better execution
- Dynamic flashloan sizing based on liquidity

---

## License

MIT License - See LICENSE file for details

---

## Acknowledgments

This project demonstrates:
- Production-ready Uniswap V3 flashloan integration
- Multi-protocol arbitrage execution (Curve, VUSD, Uniswap)
- Comprehensive testing methodology on Hardhat and Tenderly forks
- Professional smart contract development practices
- Gas-optimized Solidity patterns

Built with focus on security, testing, and production readiness.

---

## Support

For issues, questions, or contributions:
- Create an issue in the repository
- Review PROJECT_SUMMARY.md for technical details
- Check troubleshooting section for common problems

---

**Status:** Ready for keystore security implementation and mainnet deployment
**Last Updated:** October 2025
**Tested Block:** 23592043

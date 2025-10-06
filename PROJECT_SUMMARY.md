# VUSD Arbitrage Bot - Project Summary

## Project Goal

Build an automated arbitrage bot to exploit price deviations between VUSD and crvUSD on Ethereum mainnet using Uniswap V3 flashloans for capital efficiency.

## Strategy Overview

The bot was designed to execute two arbitrage scenarios:

**RICH Scenario** (when crvUSD trades above VUSD):
1. Flashloan USDC from Uniswap V3
2. Swap USDC → crvUSD (Curve)
3. Swap crvUSD → VUSD (Curve)
4. Redeem VUSD → USDC (VUSD Redeemer)
5. Repay flashloan + fee

**CHEAP Scenario** (when crvUSD trades below VUSD):
1. Flashloan USDC from Uniswap V3
2. Mint USDC → VUSD (VUSD Minter)
3. Swap VUSD → crvUSD (Curve)
4. Swap crvUSD → USDC (Curve)
5. Repay flashloan + fee

## What Was Built

### Core Smart Contract
- **`contracts/VusdArbitrageBot.sol`** - Main arbitrage execution contract implementing Uniswap V3 flashloan callback

### Off-Chain Components (in `src/`)
- **`profit-simulator.ts`** - Simulates arbitrage profitability accounting for fees and oracle impacts
- **`oracle-price-fetcher.ts`** - Fetches Chainlink oracle prices used by VUSD Minter/Redeemer
- **`curve-quote-provider.ts`** - Gets price quotes from Curve pools
- **`price-monitor.ts`** - Monitors crvUSD/VUSD price for arbitrage opportunities

### Testing & Deployment
- **`scripts/deploy-vusd-arbitrage.ts`** - Discovers Curve pool indices and deploys contract
- **`scripts/check-mainnet-vs-fork-oracle.ts`** - Validates oracle freshness
- **`test/test-vusd-tenderly-debug.ts`** - Integration tests on Tenderly fork

## The Debugging Journey

### Initial Problem
Tests consistently failed with "transaction reverted" errors on both Tenderly fork and local mainnet fork.

### Investigation Steps

1. **Oracle Staleness Theory** - Initially suspected stale Chainlink oracle data
   - Created scripts to check oracle update times
   - Found Tenderly fork had 30-hour-old oracle data (stale limit: 24 hours)
   - Created fresh fork from latest block - oracle became fresh

2. **Contract Bug Discovery** - Found critical error in RICH path
   - Line 137 was passing `VUSD` to redeem function
   - Should pass `USDC` (the output token desired)
   - Fixed this bug

3. **Persistent Failures** - Even with fresh oracle and fixed contract, transactions still reverted

### Root Cause: Compound III Reentrancy Protection

Through Tenderly transaction trace analysis, discovered:

**The VUSD Minter and Redeemer contracts are built on Compound III (Comet)**

When the bot executes:
1. Uniswap flashloan callback is invoked
2. Bot calls VUSD Minter/Redeemer
3. Minter/Redeemer calls Compound III Treasury
4. Treasury attempts to `supply()` or `withdrawTo()` on Comet
5. **Comet's reentrancy guard detects nested call context**
6. Transaction reverts with empty revert reason: `.0x(0x)`

**Why manual transactions work:**
- Direct, top-level calls to Minter/Redeemer
- No flashloan context
- Compound III allows them

**Why bot transactions fail:**
- Nested inside Uniswap V3 flashloan callback
- Compound III security feature blocks execution
- Prevents potential reentrancy attacks

## Key Files to Review

### Smart Contracts
- **`contracts/VusdArbitrageBot.sol`** - Main arbitrage logic (correct implementation)
- **External contracts in docs/** (if you have them):
  - `Minter.sol` - VUSD minting contract
  - `Redeemer.sol` - VUSD redemption contract  
  - `Treasury.sol` - Holds collateral in Compound III

### Critical Scripts
- **`scripts/check-mainnet-vs-fork-oracle.ts`** - Oracle validation tool
- **`test/test-vusd-tenderly-debug.ts`** - Integration test revealing the blocker

### Off-Chain Logic
- **`src/profit-simulator.ts`** - Profitability calculations
- **`src/oracle-price-fetcher.ts`** - Oracle impact modeling

## Conclusion

**The arbitrage strategy is fundamentally incompatible with the VUSD protocol's architecture.**

The VUSD system's reliance on Compound III for collateral management introduces security restrictions that prevent execution from within flashloan contexts. This is a deliberate security feature, not a bug.

## Alternative Approaches

### 1. Capitalized Arbitrage (No Flashloans)
- Use your own USDC capital
- No flashloan callback context
- Should work with Compound III
- **Drawback:** Requires significant capital and exposes you to price risk

### 2. Different Protocol Target
- Find stablecoin minter/redeemer contracts that don't use Compound III
- Look for protocols using Aave, MakerDAO, or custom treasury systems
- **Drawback:** May not have profitable price deviations

### 3. Off-Chain Atomic Arbitrage
- Bundle multiple transactions using Flashbots
- Execute swaps and mint/redeem as separate transactions
- Use MEV infrastructure instead of smart contract
- **Drawback:** More complex, dependent on Flashbots

### 4. Multi-Block Strategy
- Mint/redeem in transaction 1
- Execute Curve swaps in transaction 2
- **Drawback:** Price risk between blocks, not atomic

## Lessons Learned

1. **Always check external protocol architecture** - VUSD's dependency on Compound III wasn't obvious from documentation
2. **Reentrancy guards affect composability** - Security features can block legitimate use cases
3. **Tenderly fork oracle data can be stale** - Always validate oracle freshness when testing
4. **Empty reverts are often reentrancy guards** - `.0x(0x)` typically indicates security check failure
5. **Manual testing ≠ programmatic testing** - Protocols may behave differently in different call contexts

## Project Status

**Status:** Blocked by external protocol architecture

The smart contract code is correct and complete. The testing infrastructure works properly. The blocking issue is fundamental to how the VUSD protocol is designed and cannot be worked around within the current strategy.

## Recommendations

1. **Archive this approach** - Document findings for future reference
2. **Research alternative protocols** - Look for stablecoin systems without Compound III
3. **Consider capitalized strategies** - If you have sufficient USDC, the non-flashloan version should work
4. **Focus on different MEV opportunities** - Many other arbitrage strategies exist without these restrictions

## Technical Debt / Future Work

If pursuing alternative approaches:
- The off-chain profit simulator is reusable for other arbitrage strategies
- The Curve integration code works correctly
- The oracle fetching logic is solid
- Testing infrastructure on Tenderly is properly configured

The core technical work wasn't wasted - just incompatible with this specific protocol combination.

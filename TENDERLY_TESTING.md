# Tenderly Testing Workflow

## Why Fresh Tenderly Forks?

**CRITICAL:** Chainlink oracle prices become stale within hours. Always use fresh Tenderly forks for testing to ensure accurate oracle prices for VUSD redemption.

## Complete Tenderly Testing Process

### Step 1: Create Fresh Tenderly Fork

1. Go to [Tenderly Dashboard](https://dashboard.tenderly.co/)
2. Create new fork from Ethereum mainnet
3. **Use the LATEST block number** (not an old block)
4. Copy the fork RPC URL

**Example URL format:**
```
https://virtual.mainnet.eu.rpc.tenderly.co/YOUR-FORK-ID
```

### Step 2: Update Environment

Update `.env` file with the new Tenderly RPC URL:

```bash
# Tenderly Fork RPC URL
# IMPORTANT: Create fresh forks regularly (every few hours) to avoid stale Chainlink oracle prices
# Current fork created at block XXXXX (date)
TENDERLY_RPC_URL=https://virtual.mainnet.eu.rpc.tenderly.co/YOUR-NEW-FORK-ID
```

### Step 3: Fund Your Wallet on Tenderly

Add ETH to your wallet for testing:

```bash
./scripts/fund-tenderly-simple.sh
```

**Expected output:**
```
✅ Success! 100 ETH added to your wallet
```

**Verify balance:**
```bash
yarn ts-node scripts/check-balance.ts tenderly
```

### Step 4: Deploy Contract to Tenderly

```bash
yarn hardhat run scripts/deploy-tenderly.ts --network tenderly
```

**Expected output:**
```
✅ SUCCESS
CONTRACT DEPLOYED
Address: 0x...
```

**Save the contract address** - you'll need it for testing.

### Step 5: Test the Deployed Contract

```bash
yarn hardhat run scripts/test-deployed-contract.ts --network tenderly
```

**This will:**
1. Buy USDC with ETH via Uniswap
2. Transfer USDC to contract
3. Execute RICH scenario (USDC → crvUSD → VUSD → USDC)
4. Execute CHEAP scenario (USDC → VUSD → crvUSD → USDC)

**Expected results:**
- Both scenarios execute successfully
- Small losses (~1-2 USDC) due to fees and slippage are normal
- Gas usage: ~474k per transaction

## When to Create Fresh Forks

Create a new Tenderly fork when:
- ⏰ More than 2-4 hours have passed since last fork creation
- ❌ Tests fail with oracle-related errors
- ❌ VUSD redemption prices seem incorrect
- 🔄 Before any important testing session
- 🚀 Before mainnet deployment validation

## Hardhat Fork Testing (Alternative)

For testing without Tenderly (uses local Hardhat fork):

### Update Block Number

Edit `hardhat.config.ts` and update the block number:

```typescript
hardhat: {
  forking: {
    url: process.env.ETHEREUM_RPC_URL || "",
    blockNumber: 23615357, // Update to latest block
  },
}
```

### Run Local Hardhat Tests

```bash
# Test with console.log debugging
yarn hardhat run scripts/test-local-hardhat.ts --network hardhat
```

**Advantages of Hardhat fork:**
- Faster execution
- Can impersonate whale accounts
- Free (no Tenderly account needed)
- Full console.log debugging

**Disadvantages:**
- Must update block number manually
- No persistent state between runs
- Can't share test environment

## Comparison: Tenderly vs Hardhat Fork

| Feature | Tenderly Fork | Hardhat Fork |
|---------|--------------|--------------|
| **Speed** | Moderate | Fast |
| **Debugging** | Limited | Full console.log |
| **Persistence** | Yes | No |
| **Shareable** | Yes | No |
| **Setup** | Dashboard + RPC | Config file only |
| **Cost** | Free tier available | Free |
| **Oracle Updates** | Manual (new fork) | Manual (new block) |

## Troubleshooting

### "Stale oracle prices" error
- **Solution:** Create a fresh Tenderly fork with latest block

### "Insufficient balance" error on Tenderly
- **Solution:** Run `./scripts/fund-tenderly-simple.sh` again

### "Cannot connect to Tenderly" error
- **Solution:** Verify `TENDERLY_RPC_URL` in .env is correct

### Tests work on Tenderly but fail on mainnet
- **Solution:** Oracle prices may have changed, test again with fresh fork

## Best Practices

1. **Always test on fresh fork before mainnet deployment**
2. **Document the block number used for testing**
3. **Save Tenderly fork URL in .env for team sharing**
4. **Run full test suite (both scenarios) before mainnet**
5. **Monitor gas usage - should be ~474k per transaction**

## Next Steps After Successful Testing

Once both scenarios pass on Tenderly:

1. ✅ Review test results
2. ✅ Verify gas costs are acceptable
3. ✅ Check profit/loss is within expected range
4. ✅ Commit all changes
5. 🚀 Ready for mainnet deployment

**Mainnet Deployment:**
```bash
yarn ts-node scripts/deploy-vusd-arbitrage-robust.ts
```

⚠️ **WARNING:** Mainnet deployment uses real ETH. Ensure thorough testing on Tenderly first!

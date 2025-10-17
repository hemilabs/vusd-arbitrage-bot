#!/bin/bash
# scripts/fund-tenderly-simple.sh
# Simple version - just adds 100 ETH to your Tenderly wallet

# CONFIGURATION
WALLET="0x55b9c541E27c70F92E6a0679e247541D1F2665A2"
TENDERLY_RPC="https://virtual.mainnet.eu.rpc.tenderly.co/9def9c05-33cb-4003-9278-d5dd47513dc6"
AMOUNT_HEX="0x56BC75E2D63100000"  # 100 ETH in hex (NO leading zeros!)

echo "💰 Funding Tenderly Wallet"
echo "📍 Address: $WALLET"
echo "💸 Amount: 100 ETH"
echo ""

# Add balance
echo "🔄 Adding balance..."
RESPONSE=$(curl -s -X POST "$TENDERLY_RPC" \
  -H "Content-Type: application/json" \
  --data "{\"jsonrpc\":\"2.0\",\"method\":\"tenderly_addBalance\",\"params\":[\"$WALLET\",\"$AMOUNT_HEX\"],\"id\":1}")

echo "$RESPONSE"

# Check if successful
if echo "$RESPONSE" | grep -q '"result"'; then
    echo ""
    echo "✅ Success! 100 ETH added to your wallet"
    echo ""
    echo "📝 Next steps:"
    echo "   Deploy: yarn hardhat run scripts/deploy-tenderly.ts --network tenderly"
    echo "   Test: yarn hardhat run scripts/test-deployed-contract.ts --network tenderly"
else
    echo ""
    echo "❌ Failed to add balance"
    echo "Check the response above for errors"
    exit 1
fi

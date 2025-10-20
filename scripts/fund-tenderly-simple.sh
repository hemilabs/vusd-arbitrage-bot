#!/bin/bash
# scripts/fund-tenderly-simple.sh
# Adds ETH balance to wallet on Tenderly fork
# Uses TENDERLY_RPC_URL from .env file

# Load environment variables
if [ -f .env ]; then
    export $(grep -v '^#' .env | xargs)
fi

# Check if TENDERLY_RPC_URL is set
if [ -z "$TENDERLY_RPC_URL" ]; then
    echo "ERROR: TENDERLY_RPC_URL not set in .env file"
    echo "Please add: TENDERLY_RPC_URL=https://virtual.mainnet.eu.rpc.tenderly.co/YOUR-FORK-ID"
    exit 1
fi

# Wallet address (can also read from env if needed)
WALLET="${WALLET_ADDRESS:-0x55b9c541E27c70F92E6a0679e247541D1F2665A2}"
AMOUNT_HEX="0x56BC75E2D63100000"  # 100 ETH in hex

echo "💰 Funding Tenderly Wallet"
echo "📍 Address: $WALLET"
echo "💸 Amount: 100 ETH"
echo "🌐 RPC: ${TENDERLY_RPC_URL:0:60}..."
echo ""

# Add balance
echo "🔄 Adding balance..."
RESPONSE=$(curl -s -X POST "$TENDERLY_RPC_URL" \
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

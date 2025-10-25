#!/bin/bash
# scripts/fund_hardhat.sh
# Adds ETH balance to wallet on the local Hardhat node
# Uses hardcoded http://127.0.0.1:8545

# Load environment variables (for WALLET_ADDRESS)
if [ -f .env ]; then
    export $(grep -v '^#' .env | xargs)
fi

# --- CONFIGURATION ---
HARDHAT_RPC_URL="http://127.0.0.1:8545"
# Uses WALLET_ADDRESS from .env or this default
WALLET="${WALLET_ADDRESS:-0x55b9c541E27c70F92E6a0679e247541D1F2665A2}"
AMOUNT_HEX="0x56BC75E2D63100000"  # 100 ETH in hex

echo "💰 Funding Local Hardhat Wallet"
echo "📍 Address: $WALLET"
echo "💸 Amount: 100 ETH"
echo "🌐 RPC: $HARDHAT_RPC_URL"
echo ""

# Add balance using Hardhat's 'hardhat_setBalance' method
echo "🔄 Adding balance..."
RESPONSE=$(curl -s -X POST "$HARDHAT_RPC_URL" \
  -H "Content-Type: application/json" \
  --data "{\"jsonrpc\":\"2.0\",\"method\":\"hardhat_setBalance\",\"params\":[\"$WALLET\",\"$AMOUNT_HEX\"],\"id\":1}")

echo "$RESPONSE"

# Check if successful
if echo "$RESPONSE" | grep -q '"result"'; then
    echo ""
    echo "✅ Success! 100 ETH added to your wallet on the local fork"
    echo ""
    echo "📝 Next steps:"
    echo "   Deploy: yarn hardhat run scripts/deploy-tenderly.ts --network localhost"
    echo "   Test: yarn hardhat run scripts/test-deployed-contract.ts --network localhost"
else
    echo ""
    echo "❌ Failed to add balance"
    echo "   (Is your 'yarn hardhat node' server running in another terminal?)"
    echo "Check the response above for errors"
    exit 1
fi

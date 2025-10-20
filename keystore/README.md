# Keystore Directory

This directory stores encrypted keystore files for wallet management.

## Security Notes

- Keystore files (*.json) are encrypted with a password
- Actual keystore files are gitignored for security
- Only the directory structure is tracked in git
- Never commit actual keystore files

## Creating a Keystore

Run the keystore creation script:
```bash
yarn ts-node scripts/create-keystore.ts
```

This will prompt you for:
1. File path (default: ./keystore/searcher.json)
2. Private key or mnemonic
3. Password for encryption

## Using Keystore

Set in your .env file:
```
KEYSTORE_PATH=./keystore/searcher.json
```

The password will be prompted when running scripts.

# Wallet Bootstrap

Ask first:

1. Is an EVM wallet already prepared for this runtime?
2. If yes, should it be provided as a private key or a wallet JSON file?
3. If no, may a new wallet be created locally under `./.agon-agent/`?

Commands:

```bash
agon wallet create --state-dir ./.agon-agent
agon wallet import --private-key 0x...
agon wallet import --wallet-json ./wallet.json --password secret
```

Outputs:

- `primary-wallet.json` or `sparring-wallet.json`
- wallet address in JSON output

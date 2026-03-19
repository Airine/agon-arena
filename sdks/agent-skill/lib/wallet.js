const fs = require('node:fs');
const { Wallet } = require('ethers');
const { loadWallet, saveWallet, walletPath } = require('./state');

function normalizePrivateKey(privateKey) {
  if (!privateKey) {
    throw new Error('A private key is required.');
  }
  return privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`;
}

function walletRecordFromWallet(wallet, role, source) {
  return {
    address: wallet.address.toLowerCase(),
    private_key: wallet.privateKey,
    created_at: Date.now(),
    role,
    source,
  };
}

function createWallet(stateDir, role, force = false) {
  const existing = loadWallet(stateDir, role);
  if (existing.address && !force) {
    return { record: existing, created: false, reused: true };
  }

  const wallet = Wallet.createRandom();
  const record = walletRecordFromWallet(wallet, role, 'created');
  saveWallet(stateDir, role, record);
  return { record, created: true, reused: false };
}

async function importWallet({
  stateDir,
  role,
  privateKey,
  walletJsonPath,
  password,
  force = false,
}) {
  const existing = loadWallet(stateDir, role);
  if (existing.address && !force) {
    return { record: existing, imported: false, reused: true };
  }

  let wallet;
  if (privateKey) {
    wallet = new Wallet(normalizePrivateKey(privateKey));
  } else if (walletJsonPath) {
    const raw = fs.readFileSync(walletJsonPath, 'utf8');
    const parsed = JSON.parse(raw);

    if (parsed.private_key || parsed.privateKey) {
      wallet = new Wallet(normalizePrivateKey(parsed.private_key || parsed.privateKey));
    } else {
      if (!password) {
        throw new Error('Encrypted wallet JSON requires --password.');
      }
      wallet = await Wallet.fromEncryptedJson(raw, password);
    }
  } else {
    throw new Error('Provide --private-key or --wallet-json.');
  }

  const record = walletRecordFromWallet(wallet, role, 'imported');
  saveWallet(stateDir, role, record);
  return { record, imported: true, reused: false };
}

function getWalletForRole(stateDir, role) {
  const record = loadWallet(stateDir, role);
  if (!record.private_key) {
    throw new Error(`Wallet not found for role "${role}".`);
  }
  return {
    record,
    wallet: new Wallet(normalizePrivateKey(record.private_key)),
    walletPath: walletPath(stateDir, role),
  };
}

module.exports = {
  createWallet,
  getWalletForRole,
  importWallet,
  normalizePrivateKey,
};

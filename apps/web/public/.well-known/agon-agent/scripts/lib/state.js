#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

function ensureStateLayout(stateDir) {
  const root = path.resolve(stateDir);
  const downloaded = path.join(root, 'downloaded');
  const logs = path.join(root, 'logs');
  fs.mkdirSync(root, { recursive: true });
  fs.mkdirSync(downloaded, { recursive: true });
  fs.mkdirSync(logs, { recursive: true });
  return { root, downloaded, logs };
}

function walletPath(stateDir, role) {
  return path.join(ensureStateLayout(stateDir).root, `${role}-wallet.json`);
}

function sessionPath(stateDir, role) {
  return path.join(ensureStateLayout(stateDir).root, `${role}-session.json`);
}

function runStatePath(stateDir) {
  return path.join(ensureStateLayout(stateDir).root, 'run-state.json');
}

function loadJson(filePath, fallback = {}) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function saveJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function loadWallet(stateDir, role) {
  return loadJson(walletPath(stateDir, role), {});
}

function saveWallet(stateDir, role, payload) {
  saveJson(walletPath(stateDir, role), payload);
}

function loadSession(stateDir, role) {
  return loadJson(sessionPath(stateDir, role), {});
}

function saveSession(stateDir, role, payload) {
  saveJson(sessionPath(stateDir, role), payload);
}

function loadRunState(stateDir) {
  return loadJson(runStatePath(stateDir), {});
}

function updateRunState(stateDir, patch) {
  const next = {
    ...loadRunState(stateDir),
    ...patch,
    updated_at: Date.now(),
  };
  saveJson(runStatePath(stateDir), next);
  return next;
}

function jsonResult({ ok = true, state, artifacts = {}, data = {} }) {
  return { ok, state, artifacts, data };
}

module.exports = {
  ensureStateLayout,
  jsonResult,
  loadRunState,
  loadSession,
  loadWallet,
  runStatePath,
  saveSession,
  saveWallet,
  sessionPath,
  updateRunState,
  walletPath,
};

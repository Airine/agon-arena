const crypto = require('node:crypto');

function canonicalJson(payload) {
  return JSON.stringify(payload || {});
}

function hashBody(body) {
  return crypto.createHash('sha256').update(canonicalJson(body), 'utf8').digest('hex');
}

function requestPath(baseUrl, routePath) {
  const base = new URL(baseUrl);
  const basePath = base.pathname.endsWith('/') ? base.pathname.slice(0, -1) : base.pathname;
  const normalized = routePath.startsWith('/') ? routePath : `/${routePath}`;
  return `${basePath}${normalized}` || '/';
}

async function buildAgentAccessHeaders({
  baseUrl,
  wallet,
  body,
  routePath = '/auth/agent/access',
  method = 'POST',
}) {
  const address = wallet.address.toLowerCase();
  const timestamp = Date.now();
  const nonce = crypto.randomBytes(16).toString('hex');
  const payload = JSON.stringify({
    address,
    timestamp,
    nonce,
    method: method.toUpperCase(),
    path: requestPath(baseUrl, routePath),
    body_hash: hashBody(body),
  });
  const signature = await wallet.signMessage(payload);

  return {
    'X-Agent-Address': address,
    'X-Timestamp': String(timestamp),
    'X-Nonce': nonce,
    'X-Signature': signature,
  };
}

module.exports = {
  buildAgentAccessHeaders,
  canonicalJson,
  hashBody,
  requestPath,
};

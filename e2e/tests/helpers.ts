import { type APIRequestContext } from '@playwright/test';
import crypto from 'crypto';

let userCounter = 0;

export function uniqueUser() {
  userCounter++;
  const id = `${Date.now()}_${userCounter}`;
  return {
    username: `testuser_${id}`,
    email: `test_${id}@agon.test`,
    password: 'TestPass123!',
  };
}

/** Generate a valid Ed25519 keypair and return hex-encoded public key */
export function generateEd25519KeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const pubHex = publicKey
    .export({ type: 'spki', format: 'der' })
    .subarray(-32)
    .toString('hex');
  return { publicKeyHex: pubHex, privateKey };
}

/** Register a user and return the auth token */
export async function registerUser(
  request: APIRequestContext,
  user?: { username: string; email: string; password: string },
) {
  const u = user ?? uniqueUser();
  const res = await request.post('/auth/register', { data: u });
  const body = await res.json();
  return { token: body.token as string, user: body.user, credentials: u };
}

/** Create an agent and return agent + apiKey */
export async function createAgent(
  request: APIRequestContext,
  token: string,
  overrides: Record<string, unknown> = {},
) {
  const { publicKeyHex } = generateEd25519KeyPair();
  const data = {
    name: `TestAgent_${Date.now()}`,
    description: 'E2E test agent',
    apiUrl: 'https://example.com/webhook',
    webhookPublicKey: publicKeyHex,
    version: '1.0',
    ...overrides,
  };

  const res = await request.post('/agents', {
    data,
    headers: { Authorization: `Bearer ${token}` },
  });

  const body = await res.json();
  return { agent: body.agent, apiKey: body.apiKey as string, statusCode: res.status() };
}

import { describe, expect, it } from 'vitest';
import { createWalletClient, http } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { baseSepolia } from 'viem/chains';
import {
  agentAccessHeaderSchema,
  buildAgentAccessPayload,
  hashAgentAccessBody,
  type AgentAccessPayloadInput,
  verifyAgentAccessRequest,
} from '../../services/agent-access.js';

function signAccessPayload(
  privateKey: `0x${string}`,
  payload: AgentAccessPayloadInput,
): Promise<`0x${string}`> {
  const account = privateKeyToAccount(privateKey);
  const client = createWalletClient({ account, chain: baseSepolia, transport: http() });
  return client.signMessage({ message: buildAgentAccessPayload(payload) });
}

class NonceStore {
  private claimed = new Set<string>();

  claim(nonce: string): boolean {
    if (this.claimed.has(nonce)) return false;
    this.claimed.add(nonce);
    return true;
  }
}

interface AccessRequestInput {
  address: string;
  timestamp: string;
  nonce: string;
  signature: `0x${string}`;
  path: string;
  body: unknown;
}

interface AgentCard {
  name: string;
  description?: string;
}

interface UserRecord {
  id: string;
  username: string;
  walletAddress: string;
}

interface AgentRecord {
  id: string;
  ownerId: string;
  creatorUserId: string;
  agentAddress: string | null;
  name: string;
}

class IdentityStore {
  private users = new Map<string, UserRecord>();
  private agents = new Map<string, AgentRecord>();
  private seq = 0;

  findUser(walletAddress: string): UserRecord | undefined {
    return this.users.get(walletAddress.toLowerCase());
  }

  findAgentByAddress(agentAddress: string): AgentRecord | undefined {
    for (const agent of this.agents.values()) {
      if (agent.agentAddress === agentAddress.toLowerCase()) return agent;
    }
    return undefined;
  }

  createUser(walletAddress: string): UserRecord {
    this.seq += 1;
    const shortAddr = walletAddress.toLowerCase().slice(2, 6);
    const user: UserRecord = {
      id: `user-${this.seq}`,
      username: `agent_${shortAddr}`,
      walletAddress: walletAddress.toLowerCase(),
    };
    this.users.set(user.walletAddress, user);
    return user;
  }

  createAgent(ownerId: string, agentAddress: string | null, card: AgentCard): AgentRecord {
    this.seq += 1;
    const agent: AgentRecord = {
      id: `agent-${this.seq}`,
      ownerId,
      creatorUserId: ownerId,
      agentAddress: agentAddress?.toLowerCase() ?? null,
      name: card.name,
    };
    this.agents.set(agent.id, agent);
    return agent;
  }

  createDraftAgent(ownerId: string, card: AgentCard): AgentRecord {
    return this.createAgent(ownerId, null, card);
  }
}

async function simulateAgentAccess(
  request: AccessRequestInput,
  store: IdentityStore,
  nonces: NonceStore,
  nowMs = Number(request.timestamp),
) {
  const headers = agentAccessHeaderSchema.parse({
    address: request.address,
    timestamp: request.timestamp,
    nonce: request.nonce,
    signature: request.signature,
  });

  const verification = await verifyAgentAccessRequest({
    headers,
    method: 'POST',
    path: request.path,
    body: request.body,
    nowMs,
  });
  if (!verification.ok) {
    return { status: verification.status, error: verification.error };
  }

  if (!nonces.claim(request.nonce)) {
    return { status: 401, error: 'Nonce already used or expired' };
  }

  let user = store.findUser(verification.walletAddress);
  let created = false;
  if (!user) {
    if (!request.body || typeof request.body !== 'object' || !('agentCard' in request.body)) {
      return { status: 400, error: 'agentCard is required when registering a new agent' };
    }
    user = store.createUser(verification.walletAddress);
    created = true;
  }

  let agent = store.findAgentByAddress(verification.walletAddress);
  if (!agent) {
    const body = request.body as { agentCard?: AgentCard };
    if (!body.agentCard) {
      return { status: 400, error: 'agentCard is required when registering a new agent' };
    }
    agent = store.createAgent(user.id, verification.walletAddress, body.agentCard);
    created = true;
  }

  return {
    status: created ? 201 : 200,
    created,
    user,
    agent,
  };
}

describe('agent access payload helpers', () => {
  it('hashes request bodies deterministically', () => {
    const first = hashAgentAccessBody({ agentCard: { name: 'Bot' } });
    const second = hashAgentAccessBody({ agentCard: { name: 'Bot' } });
    expect(first).toBe(second);
  });

  it('normalizes payload shape for signing', () => {
    const payload = buildAgentAccessPayload({
      address: '0xAbCd00000000000000000000000000000000Ef12',
      timestamp: '1710000000000',
      nonce: 'nonce-123',
      method: 'post',
      path: '/auth/agent/access',
      bodyHash: 'abc123',
    });

    expect(payload).toContain('"address":"0xabcd00000000000000000000000000000000ef12"');
    expect(payload).toContain('"method":"POST"');
    expect(payload).toContain('"body_hash":"abc123"');
  });
});

describe('verifyAgentAccessRequest', () => {
  it('accepts a valid signed access request', async () => {
    const privateKey = generatePrivateKey();
    const account = privateKeyToAccount(privateKey);
    const timestamp = '1710000000000';
    const body = { agentCard: { name: 'SkillBot' } };
    const signature = await signAccessPayload(privateKey, {
      address: account.address,
      timestamp,
      nonce: 'nonce-valid-1',
      method: 'POST',
      path: '/auth/agent/access',
      bodyHash: hashAgentAccessBody(body),
    });

    const result = await verifyAgentAccessRequest({
      headers: {
        address: account.address,
        timestamp,
        nonce: 'nonce-valid-1',
        signature,
      },
      method: 'POST',
      path: '/auth/agent/access',
      body,
      nowMs: Number(timestamp),
    });

    expect(result).toEqual({ ok: true, walletAddress: account.address.toLowerCase() });
  });

  it('rejects a tampered body', async () => {
    const privateKey = generatePrivateKey();
    const account = privateKeyToAccount(privateKey);
    const timestamp = '1710000000000';
    const signedBody = { agentCard: { name: 'SkillBot' } };
    const signature = await signAccessPayload(privateKey, {
      address: account.address,
      timestamp,
      nonce: 'nonce-valid-2',
      method: 'POST',
      path: '/auth/agent/access',
      bodyHash: hashAgentAccessBody(signedBody),
    });

    const result = await verifyAgentAccessRequest({
      headers: {
        address: account.address,
        timestamp,
        nonce: 'nonce-valid-2',
        signature,
      },
      method: 'POST',
      path: '/auth/agent/access',
      body: { agentCard: { name: 'OtherBot' } },
      nowMs: Number(timestamp),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(401);
    }
  });

  it('rejects timestamps outside the allowed window', async () => {
    const privateKey = generatePrivateKey();
    const account = privateKeyToAccount(privateKey);
    const timestamp = '1710000000000';
    const signature = await signAccessPayload(privateKey, {
      address: account.address,
      timestamp,
      nonce: 'nonce-valid-3',
      method: 'POST',
      path: '/auth/agent/access',
      bodyHash: hashAgentAccessBody({}),
    });

    const result = await verifyAgentAccessRequest({
      headers: {
        address: account.address,
        timestamp,
        nonce: 'nonce-valid-3',
        signature,
      },
      method: 'POST',
      path: '/auth/agent/access',
      body: {},
      nowMs: Number(timestamp) + 61_000,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(401);
      expect(result.error).toContain('Timestamp');
    }
  });
});

describe('agent access bootstrap flow', () => {
  it('creates user and agent on first signed access, then reuses them on the second', async () => {
    const privateKey = generatePrivateKey();
    const account = privateKeyToAccount(privateKey);
    const store = new IdentityStore();
    const nonces = new NonceStore();
    const firstBody = {
      agentCard: {
        name: 'FirstArenaBot',
      },
    };

    const firstSignature = await signAccessPayload(privateKey, {
      address: account.address,
      timestamp: '1710000000000',
      nonce: 'nonce-bootstrap-1',
      method: 'POST',
      path: '/auth/agent/access',
      bodyHash: hashAgentAccessBody(firstBody),
    });

    const first = await simulateAgentAccess(
      {
        address: account.address,
        timestamp: '1710000000000',
        nonce: 'nonce-bootstrap-1',
        signature: firstSignature,
        path: '/auth/agent/access',
        body: firstBody,
      },
      store,
      nonces,
    );

    expect(first.status).toBe(201);
    expect(first.created).toBe(true);
    if ('agent' in first && first.agent && 'user' in first && first.user) {
      expect(first.agent.name).toBe('FirstArenaBot');
      expect(first.agent.agentAddress).toBe(account.address.toLowerCase());
      expect(first.user.walletAddress).toBe(account.address.toLowerCase());
    }

    const secondSignature = await signAccessPayload(privateKey, {
      address: account.address,
      timestamp: '1710000001000',
      nonce: 'nonce-bootstrap-2',
      method: 'POST',
      path: '/auth/agent/access',
      bodyHash: hashAgentAccessBody({}),
    });

    const second = await simulateAgentAccess(
      {
        address: account.address,
        timestamp: '1710000001000',
        nonce: 'nonce-bootstrap-2',
        signature: secondSignature,
        path: '/auth/agent/access',
        body: {},
      },
      store,
      nonces,
    );

    expect(second.status).toBe(200);
    expect(second.created).toBe(false);
    if (
      'agent' in second &&
      second.agent &&
      'user' in second &&
      second.user &&
      'agent' in first &&
      first.agent &&
      'user' in first &&
      first.user
    ) {
      expect(second.agent.id).toBe(first.agent.id);
      expect(second.user.id).toBe(first.user.id);
    }
  });

  it('rejects nonce replay on the second identical request', async () => {
    const privateKey = generatePrivateKey();
    const account = privateKeyToAccount(privateKey);
    const store = new IdentityStore();
    const nonces = new NonceStore();
    const body = {
      agentCard: {
        name: 'ReplayBot',
      },
    };
    const signature = await signAccessPayload(privateKey, {
      address: account.address,
      timestamp: '1710000000000',
      nonce: 'nonce-replay-1',
      method: 'POST',
      path: '/auth/agent/access',
      bodyHash: hashAgentAccessBody(body),
    });

    const first = await simulateAgentAccess(
      {
        address: account.address,
        timestamp: '1710000000000',
        nonce: 'nonce-replay-1',
        signature,
        path: '/auth/agent/access',
        body,
      },
      store,
      nonces,
    );
    expect(first.status).toBe(201);

    const replay = await simulateAgentAccess(
      {
        address: account.address,
        timestamp: '1710000000000',
        nonce: 'nonce-replay-1',
        signature,
        path: '/auth/agent/access',
        body,
      },
      store,
      nonces,
    );
    expect(replay).toEqual({
      status: 401,
      error: 'Nonce already used or expired',
    });
  });

  it('does not confuse owner draft agents with the wallet-bound runtime identity', async () => {
    const privateKey = generatePrivateKey();
    const account = privateKeyToAccount(privateKey);
    const store = new IdentityStore();
    const nonces = new NonceStore();
    const existingUser = store.createUser(account.address);
    const draft = store.createDraftAgent(existingUser.id, { name: 'OwnerDraftBot' });

    const body = {
      agentCard: {
        name: 'RuntimeIdentityBot',
      },
    };
    const signature = await signAccessPayload(privateKey, {
      address: account.address,
      timestamp: '1710000003000',
      nonce: 'nonce-draft-ignore-1',
      method: 'POST',
      path: '/auth/agent/access',
      bodyHash: hashAgentAccessBody(body),
    });

    const result = await simulateAgentAccess(
      {
        address: account.address,
        timestamp: '1710000003000',
        nonce: 'nonce-draft-ignore-1',
        signature,
        path: '/auth/agent/access',
        body,
      },
      store,
      nonces,
    );

    expect(result.status).toBe(201);
    expect(result.created).toBe(true);
    if ('agent' in result && result.agent) {
      expect(result.agent.id).not.toBe(draft.id);
      expect(result.agent.agentAddress).toBe(account.address.toLowerCase());
      expect(result.agent.name).toBe('RuntimeIdentityBot');
    }
  });
});

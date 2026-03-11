import { test, expect } from '@playwright/test';
import { registerUser, createAgent, generateEd25519KeyPair } from './helpers.js';

test.describe('Agent Registration & Management', () => {
  let token: string;
  let agentId: string;

  test.beforeAll(async ({ request }) => {
    const { token: t } = await registerUser(request);
    token = t;
  });

  test('POST /agents registers agent with 7-field schema', async ({ request }) => {
    const { agent, apiKey, statusCode } = await createAgent(request, token);

    expect(statusCode).toBe(201);
    expect(agent.id).toBeTruthy();
    expect(agent.name).toContain('TestAgent');
    expect(agent.webhookPublicKey).toMatch(/^[0-9a-f]{64}$/i);
    expect(agent.eloRating).toBe(1200);
    expect(agent.isActive).toBe(true);
    expect(apiKey).toMatch(/^agon_[0-9a-f]{64}$/);

    agentId = agent.id;
  });

  test('POST /agents rejects invalid webhook public key', async ({ request }) => {
    const res = await request.post('/agents', {
      data: {
        name: 'BadAgent',
        apiUrl: 'https://example.com/hook',
        webhookPublicKey: 'not-a-valid-hex-key-at-all-needs-to-be-exactly-64',
      },
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(400);
  });

  test('POST /agents rejects private/internal apiUrl (SSRF protection)', async ({ request }) => {
    const { publicKeyHex } = generateEd25519KeyPair();
    const res = await request.post('/agents', {
      data: {
        name: 'SSRFAgent',
        apiUrl: 'http://169.254.169.254/metadata',
        webhookPublicKey: publicKeyHex,
      },
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(400);
  });

  test('POST /agents requires authentication', async ({ request }) => {
    const { publicKeyHex } = generateEd25519KeyPair();
    const res = await request.post('/agents', {
      data: {
        name: 'NoAuth',
        apiUrl: 'https://example.com/hook',
        webhookPublicKey: publicKeyHex,
      },
    });
    expect(res.status()).toBe(401);
  });

  test('GET /agents lists active agents', async ({ request }) => {
    const res = await request.get('/agents');
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body.agents).toBeInstanceOf(Array);
    expect(body.agents.length).toBeGreaterThanOrEqual(1);
  });

  test('GET /agents/:id returns agent details', async ({ request }) => {
    const res = await request.get(`/agents/${agentId}`);
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body.id).toBe(agentId);
    expect(body.eloRating).toBe(1200);
    expect(body.handsPlayed).toBe(0);
  });

  test('GET /agents/:id returns 404 for nonexistent', async ({ request }) => {
    const res = await request.get('/agents/00000000-0000-0000-0000-000000000000');
    expect(res.status()).toBe(404);
  });

  test('PUT /agents/:id updates agent (owner only)', async ({ request }) => {
    const res = await request.put(`/agents/${agentId}`, {
      data: { name: 'UpdatedAgent' },
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body.name).toBe('UpdatedAgent');
  });

  test('PUT /agents/:id rejects update from non-owner', async ({ request }) => {
    const { token: otherToken } = await registerUser(request);
    const res = await request.put(`/agents/${agentId}`, {
      data: { name: 'Hacked' },
      headers: { Authorization: `Bearer ${otherToken}` },
    });
    expect(res.status()).toBe(403);
  });

  test('DELETE /agents/:id soft-deletes agent', async ({ request }) => {
    // Create a throwaway agent to delete
    const { agent: tempAgent } = await createAgent(request, token, {
      name: 'ToBeDeleted',
    });

    const res = await request.delete(`/agents/${tempAgent.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);

    // Verify it's gone from the list
    const detail = await request.get(`/agents/${tempAgent.id}`);
    const body = await detail.json();
    expect(body.isActive).toBe(false);
  });
});

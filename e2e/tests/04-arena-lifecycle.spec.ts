import { test, expect } from '@playwright/test';
import { registerUser, createAgent } from './helpers.js';

test.describe('Arena Lifecycle: create → join → start → spectate', () => {
  let token: string;
  let agent1Id: string;
  let agent2Id: string;
  let arenaId: string;

  test.beforeAll(async ({ request }) => {
    const { token: t } = await registerUser(request);
    token = t;

    const { agent: a1 } = await createAgent(request, token, { name: 'Player1' });
    const { agent: a2 } = await createAgent(request, token, { name: 'Player2' });
    agent1Id = a1.id;
    agent2Id = a2.id;
  });

  test('POST /arenas creates a new arena', async ({ request }) => {
    const res = await request.post('/arenas', {
      data: {
        name: 'E2E Test Arena',
        maxPlayers: 6,
        smallBlind: 10,
        bigBlind: 20,
        startingStack: 1000,
      },
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(201);

    const body = await res.json();
    expect(body.id).toBeTruthy();
    expect(body.name).toBe('E2E Test Arena');
    expect(body.status).toBe('waiting');
    expect(body.maxPlayers).toBe(6);
    arenaId = body.id;
  });

  test('POST /arenas rejects invalid blind structure', async ({ request }) => {
    const res = await request.post('/arenas', {
      data: { name: 'Bad', smallBlind: 20, bigBlind: 10, startingStack: 1000 },
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(400);
  });

  test('GET /arenas lists arenas', async ({ request }) => {
    const res = await request.get('/arenas');
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body.arenas).toBeInstanceOf(Array);
    expect(body.arenas.length).toBeGreaterThanOrEqual(1);
  });

  test('GET /arenas?status=waiting filters by status', async ({ request }) => {
    const res = await request.get('/arenas?status=waiting');
    expect(res.status()).toBe(200);

    const body = await res.json();
    const arena = body.arenas.find((a: { id: string }) => a.id === arenaId);
    expect(arena).toBeTruthy();
    expect(arena.status).toBe('waiting');
  });

  test('POST /arenas/:id/join seats agent 1', async ({ request }) => {
    const res = await request.post(`/arenas/${arenaId}/join`, {
      data: { agentId: agent1Id },
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(201);

    const body = await res.json();
    expect(body.seatIndex).toBe(0);
    expect(body.currentStack).toBe(1000);
  });

  test('POST /arenas/:id/join seats agent 2', async ({ request }) => {
    const res = await request.post(`/arenas/${arenaId}/join`, {
      data: { agentId: agent2Id },
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(201);

    const body = await res.json();
    expect(body.seatIndex).toBe(1);
  });

  test('POST /arenas/:id/join rejects duplicate agent', async ({ request }) => {
    const res = await request.post(`/arenas/${arenaId}/join`, {
      data: { agentId: agent1Id },
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(409);
  });

  test('POST /arenas/:id/join rejects non-owner agent', async ({ request }) => {
    const { token: otherToken } = await registerUser(request);
    const res = await request.post(`/arenas/${arenaId}/join`, {
      data: { agentId: agent1Id },
      headers: { Authorization: `Bearer ${otherToken}` },
    });
    expect(res.status()).toBe(403);
  });

  test('GET /arenas/:id shows arena with seated agents', async ({ request }) => {
    const res = await request.get(`/arenas/${arenaId}`);
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body.id).toBe(arenaId);
    expect(body.seats).toHaveLength(2);
    expect(body.seats[0].agentName).toBeTruthy();
    expect(body.seats[1].agentName).toBeTruthy();
  });

  test('POST /arenas/:id/start requires at least 2 players', async ({ request }) => {
    // Create an empty arena and try to start it
    const arenaRes = await request.post('/arenas', {
      data: { name: 'Empty', smallBlind: 10, bigBlind: 20, startingStack: 1000 },
      headers: { Authorization: `Bearer ${token}` },
    });
    const emptyArena = await arenaRes.json();

    const startRes = await request.post(`/arenas/${emptyArena.id}/start`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(startRes.status()).toBe(400);
    const body = await startRes.json();
    expect(body.error).toContain('2 agents');
  });

  test('POST /arenas/:id/start rejects non-creator', async ({ request }) => {
    const { token: otherToken } = await registerUser(request);
    const res = await request.post(`/arenas/${arenaId}/start`, {
      headers: { Authorization: `Bearer ${otherToken}` },
    });
    expect(res.status()).toBe(403);
  });

  test('POST /arenas/:id/start begins the game', async ({ request }) => {
    const res = await request.post(`/arenas/${arenaId}/start`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body.message).toBe('Game started');
    expect(body.playerCount).toBe(2);
  });

  test('POST /arenas/:id/start rejects already running arena', async ({ request }) => {
    const res = await request.post(`/arenas/${arenaId}/start`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(400);
  });

  test('POST /arenas/:id/join rejects when arena is running', async ({ request }) => {
    const { agent: lateAgent } = await createAgent(request, token, { name: 'LateJoiner' });
    const res = await request.post(`/arenas/${arenaId}/join`, {
      data: { agentId: lateAgent.id },
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('not accepting');
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { GameState, Winner } from '@agon/types';

/**
 * AGO-28: Webhook dispatcher unit tests
 *
 * Tests:
 * - dispatchToAgent skips bot:// endpoints silently
 * - dispatchToAgent sends POST to ${apiUrl}/state with correct headers
 * - dispatchToAgent does not throw when HTTP call fails (fire-and-forget)
 * - dispatchToAll calls dispatchToAgent for each non-bot endpoint
 * - dispatchToAll skips bot:// endpoints
 * - Payload structure: hand:start, hand:action, hand:end shapes
 */

// ─── Hoisted axios mock ──────────────────────────────────────────────────────
const { mockAxiosPost } = vi.hoisted(() => {
  const mockAxiosPost = vi.fn().mockResolvedValue({ status: 200 });
  return { mockAxiosPost };
});

vi.mock('axios', () => ({
  default: {
    post: mockAxiosPost,
  },
}));

// ─── Hoisted webhook-crypto mock ─────────────────────────────────────────────
vi.mock('../webhook-crypto.js', () => ({
  signWebhookPayload: vi.fn().mockReturnValue({
    signature: 'sig-hex-value',
    timestamp: '1700000000',
    nonce: 'test-nonce-uuid',
  }),
}));

import {
  dispatchToAgent,
  dispatchToAll,
  type AgentEndpoint,
  type HandStartPayload,
  type HandActionPayload,
  type HandEndPayload,
} from '../webhook-dispatcher.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeGameState(overrides: Partial<GameState> = {}): GameState {
  return {
    arenaId: 'arena-1',
    handId: 'hand-1',
    handNumber: 1,
    stage: 'pre_flop',
    players: [
      {
        agentId: 'agent-a',
        agentName: 'Alpha',
        position: 0,
        stack: 1000,
        bet: 0,
        totalBet: 0,
        cards: [],
        isActive: true,
        isFolded: false,
        isAllIn: false,
        hasActed: false,
      },
    ],
    communityCards: [],
    pots: [{ amount: 30, eligiblePlayers: ['agent-a', 'agent-b'] }],
    currentActorIndex: 0,
    dealerIndex: 0,
    smallBlindIndex: 1,
    bigBlindIndex: 2,
    smallBlindAmount: 10,
    bigBlindAmount: 20,
    minRaise: 20,
    ...overrides,
  };
}

function makeEndpoint(overrides: Partial<AgentEndpoint> = {}): AgentEndpoint {
  return {
    agentId: 'agent-a',
    apiUrl: 'https://agent.example.com',
    webhookPublicKey: null,
    ...overrides,
  };
}

function makeWinners(): Winner[] {
  return [{ agentId: 'agent-a', amount: 100 }];
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAxiosPost.mockResolvedValue({ status: 200 });
});

// ─── dispatchToAgent — bot:// skip ───────────────────────────────────────────

describe('dispatchToAgent — bot:// skip', () => {
  it('returns immediately without calling axios for bot:// URLs', async () => {
    const endpoint = makeEndpoint({ apiUrl: 'bot://random' });
    const payload: HandStartPayload = {
      event: 'hand:start',
      arenaId: 'arena-1',
      handNumber: 1,
      vrfCommit: 'abc123',
      state: makeGameState(),
    };

    await dispatchToAgent(endpoint, payload);

    expect(mockAxiosPost).not.toHaveBeenCalled();
  });

  it('skips bot://call endpoints silently', async () => {
    const endpoint = makeEndpoint({ apiUrl: 'bot://call' });
    const payload: HandStartPayload = {
      event: 'hand:start',
      arenaId: 'arena-1',
      handNumber: 1,
      vrfCommit: 'abc123',
      state: makeGameState(),
    };

    await expect(dispatchToAgent(endpoint, payload)).resolves.toBeUndefined();
    expect(mockAxiosPost).not.toHaveBeenCalled();
  });

  it('skips bot://fold endpoints silently', async () => {
    const endpoint = makeEndpoint({ apiUrl: 'bot://fold' });
    const payload: HandActionPayload = {
      event: 'hand:action',
      arenaId: 'arena-1',
      handNumber: 1,
      actorAgentId: 'agent-b',
      action: { type: 'fold' },
      state: makeGameState(),
    };

    await expect(dispatchToAgent(endpoint, payload)).resolves.toBeUndefined();
    expect(mockAxiosPost).not.toHaveBeenCalled();
  });
});

// ─── dispatchToAgent — HTTP dispatch ────────────────────────────────────────

describe('dispatchToAgent — HTTP dispatch', () => {
  it('sends POST to ${apiUrl}/state', async () => {
    const endpoint = makeEndpoint({ apiUrl: 'https://agent.example.com' });
    const payload: HandStartPayload = {
      event: 'hand:start',
      arenaId: 'arena-1',
      handNumber: 1,
      vrfCommit: 'deadbeef',
      state: makeGameState(),
    };

    await dispatchToAgent(endpoint, payload);

    expect(mockAxiosPost).toHaveBeenCalledOnce();
    const [url] = mockAxiosPost.mock.calls[0] as [string, ...unknown[]];
    expect(url).toBe('https://agent.example.com/state');
  });

  it('sends correct X-Agon-Event header for hand:start', async () => {
    const endpoint = makeEndpoint();
    const payload: HandStartPayload = {
      event: 'hand:start',
      arenaId: 'arena-1',
      handNumber: 1,
      vrfCommit: 'deadbeef',
      state: makeGameState(),
    };

    await dispatchToAgent(endpoint, payload);

    const [, , config] = mockAxiosPost.mock.calls[0] as [string, unknown, { headers: Record<string, string> }];
    expect(config.headers['X-Agon-Event']).toBe('hand:start');
  });

  it('sends correct X-Agon-Event header for hand:action', async () => {
    const endpoint = makeEndpoint();
    const payload: HandActionPayload = {
      event: 'hand:action',
      arenaId: 'arena-1',
      handNumber: 1,
      actorAgentId: 'agent-b',
      action: { type: 'call' },
      state: makeGameState(),
    };

    await dispatchToAgent(endpoint, payload);

    const [, , config] = mockAxiosPost.mock.calls[0] as [string, unknown, { headers: Record<string, string> }];
    expect(config.headers['X-Agon-Event']).toBe('hand:action');
  });

  it('sends correct X-Agon-Event header for hand:end', async () => {
    const endpoint = makeEndpoint();
    const payload: HandEndPayload = {
      event: 'hand:end',
      arenaId: 'arena-1',
      handNumber: 1,
      winners: makeWinners(),
      vrfSeed: 'seedhex',
      state: makeGameState({ stage: 'finished' }),
    };

    await dispatchToAgent(endpoint, payload);

    const [, , config] = mockAxiosPost.mock.calls[0] as [string, unknown, { headers: Record<string, string> }];
    expect(config.headers['X-Agon-Event']).toBe('hand:end');
  });

  it('sends X-Agon-Signature header from signWebhookPayload', async () => {
    const endpoint = makeEndpoint();
    const payload: HandStartPayload = {
      event: 'hand:start',
      arenaId: 'arena-1',
      handNumber: 1,
      vrfCommit: 'abc',
      state: makeGameState(),
    };

    await dispatchToAgent(endpoint, payload);

    const [, , config] = mockAxiosPost.mock.calls[0] as [string, unknown, { headers: Record<string, string> }];
    expect(config.headers['X-Agon-Signature']).toBe('sig-hex-value');
  });

  it('sends X-Agon-Timestamp header from signWebhookPayload', async () => {
    const endpoint = makeEndpoint();
    const payload: HandStartPayload = {
      event: 'hand:start',
      arenaId: 'arena-1',
      handNumber: 1,
      vrfCommit: 'abc',
      state: makeGameState(),
    };

    await dispatchToAgent(endpoint, payload);

    const [, , config] = mockAxiosPost.mock.calls[0] as [string, unknown, { headers: Record<string, string> }];
    expect(config.headers['X-Agon-Timestamp']).toBe('1700000000');
  });

  it('sends X-Agon-Nonce header from signWebhookPayload', async () => {
    const endpoint = makeEndpoint();
    const payload: HandStartPayload = {
      event: 'hand:start',
      arenaId: 'arena-1',
      handNumber: 1,
      vrfCommit: 'abc',
      state: makeGameState(),
    };

    await dispatchToAgent(endpoint, payload);

    const [, , config] = mockAxiosPost.mock.calls[0] as [string, unknown, { headers: Record<string, string> }];
    expect(config.headers['X-Agon-Nonce']).toBe('test-nonce-uuid');
  });

  it('sends Content-Type: application/json header', async () => {
    const endpoint = makeEndpoint();
    const payload: HandStartPayload = {
      event: 'hand:start',
      arenaId: 'arena-1',
      handNumber: 1,
      vrfCommit: 'abc',
      state: makeGameState(),
    };

    await dispatchToAgent(endpoint, payload);

    const [, , config] = mockAxiosPost.mock.calls[0] as [string, unknown, { headers: Record<string, string> }];
    expect(config.headers['Content-Type']).toBe('application/json');
  });

  it('disables redirects (maxRedirects: 0)', async () => {
    const endpoint = makeEndpoint();
    const payload: HandStartPayload = {
      event: 'hand:start',
      arenaId: 'arena-1',
      handNumber: 1,
      vrfCommit: 'abc',
      state: makeGameState(),
    };

    await dispatchToAgent(endpoint, payload);

    const [, , config] = mockAxiosPost.mock.calls[0] as [string, unknown, { maxRedirects: number }];
    expect(config.maxRedirects).toBe(0);
  });

  it('sends the payload as the POST body', async () => {
    const endpoint = makeEndpoint();
    const state = makeGameState();
    const payload: HandStartPayload = {
      event: 'hand:start',
      arenaId: 'arena-42',
      handNumber: 5,
      vrfCommit: 'commitabc',
      state,
    };

    await dispatchToAgent(endpoint, payload);

    const [, body] = mockAxiosPost.mock.calls[0] as [string, HandStartPayload];
    expect(body.event).toBe('hand:start');
    expect(body.arenaId).toBe('arena-42');
    expect(body.handNumber).toBe(5);
    expect(body.vrfCommit).toBe('commitabc');
  });
});

// ─── dispatchToAgent — fire-and-forget error handling ───────────────────────

describe('dispatchToAgent — fire-and-forget', () => {
  it('does not throw when axios.post rejects (network error)', async () => {
    mockAxiosPost.mockRejectedValue(new Error('ECONNREFUSED'));
    const endpoint = makeEndpoint();
    const payload: HandStartPayload = {
      event: 'hand:start',
      arenaId: 'arena-1',
      handNumber: 1,
      vrfCommit: 'abc',
      state: makeGameState(),
    };

    await expect(dispatchToAgent(endpoint, payload)).resolves.not.toThrow();
  });

  it('does not throw when axios.post rejects with 500', async () => {
    mockAxiosPost.mockRejectedValue(new Error('Request failed with status code 500'));
    const endpoint = makeEndpoint();
    const payload: HandActionPayload = {
      event: 'hand:action',
      arenaId: 'arena-1',
      handNumber: 2,
      actorAgentId: 'agent-b',
      action: { type: 'raise', amount: 100 },
      state: makeGameState(),
    };

    await expect(dispatchToAgent(endpoint, payload)).resolves.not.toThrow();
  });

  it('does not throw when axios.post rejects with timeout', async () => {
    mockAxiosPost.mockRejectedValue(new Error('timeout of 3000ms exceeded'));
    const endpoint = makeEndpoint();
    const payload: HandEndPayload = {
      event: 'hand:end',
      arenaId: 'arena-1',
      handNumber: 3,
      winners: makeWinners(),
      vrfSeed: 'seedhex',
      state: makeGameState({ stage: 'finished' }),
    };

    await expect(dispatchToAgent(endpoint, payload)).resolves.not.toThrow();
  });
});

// ─── dispatchToAll ────────────────────────────────────────────────────────────

describe('dispatchToAll', () => {
  it('calls dispatchToAgent for each non-bot endpoint', async () => {
    const endpoints: AgentEndpoint[] = [
      makeEndpoint({ agentId: 'agent-a', apiUrl: 'https://agent-a.example.com' }),
      makeEndpoint({ agentId: 'agent-b', apiUrl: 'https://agent-b.example.com' }),
    ];

    dispatchToAll(endpoints, (agentId) => ({
      event: 'hand:start',
      arenaId: 'arena-1',
      handNumber: 1,
      vrfCommit: 'abc',
      state: makeGameState(),
    }));

    // Give promises a tick to resolve
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mockAxiosPost).toHaveBeenCalledTimes(2);
  });

  it('skips bot:// endpoints and only calls real agents', async () => {
    const endpoints: AgentEndpoint[] = [
      makeEndpoint({ agentId: 'bot-1', apiUrl: 'bot://random' }),
      makeEndpoint({ agentId: 'agent-real', apiUrl: 'https://real.example.com' }),
      makeEndpoint({ agentId: 'bot-2', apiUrl: 'bot://call' }),
    ];

    dispatchToAll(endpoints, (agentId) => ({
      event: 'hand:action',
      arenaId: 'arena-1',
      handNumber: 1,
      actorAgentId: 'agent-real',
      action: { type: 'check' },
      state: makeGameState(),
    }));

    await new Promise((resolve) => setTimeout(resolve, 0));

    // Only the real agent should receive a dispatch
    expect(mockAxiosPost).toHaveBeenCalledTimes(1);
    const [url] = mockAxiosPost.mock.calls[0] as [string, ...unknown[]];
    expect(url).toBe('https://real.example.com/state');
  });

  it('skips all endpoints when all are bots', async () => {
    const endpoints: AgentEndpoint[] = [
      makeEndpoint({ agentId: 'bot-1', apiUrl: 'bot://random' }),
      makeEndpoint({ agentId: 'bot-2', apiUrl: 'bot://fold' }),
    ];

    dispatchToAll(endpoints, (_agentId) => ({
      event: 'hand:start',
      arenaId: 'arena-1',
      handNumber: 1,
      vrfCommit: 'abc',
      state: makeGameState(),
    }));

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mockAxiosPost).not.toHaveBeenCalled();
  });

  it('passes per-agent payload from makePayload factory', async () => {
    const endpoints: AgentEndpoint[] = [
      makeEndpoint({ agentId: 'agent-x', apiUrl: 'https://x.example.com' }),
    ];

    dispatchToAll(endpoints, (agentId) => ({
      event: 'hand:start',
      arenaId: 'arena-factory-test',
      handNumber: 7,
      vrfCommit: 'factorycommit',
      state: makeGameState({ arenaId: agentId }),
    }));

    await new Promise((resolve) => setTimeout(resolve, 0));

    const [, body] = mockAxiosPost.mock.calls[0] as [string, HandStartPayload];
    expect(body.arenaId).toBe('arena-factory-test');
    expect(body.state.arenaId).toBe('agent-x'); // per-agent state from factory
  });

  it('does not throw even if some dispatches fail', async () => {
    mockAxiosPost.mockRejectedValue(new Error('network error'));
    const endpoints: AgentEndpoint[] = [
      makeEndpoint({ agentId: 'agent-a', apiUrl: 'https://a.example.com' }),
      makeEndpoint({ agentId: 'agent-b', apiUrl: 'https://b.example.com' }),
    ];

    expect(() =>
      dispatchToAll(endpoints, (_agentId) => ({
        event: 'hand:end',
        arenaId: 'arena-1',
        handNumber: 1,
        winners: makeWinners(),
        vrfSeed: 'seed',
        state: makeGameState({ stage: 'finished' }),
      })),
    ).not.toThrow();

    // Give rejections a tick to settle
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
});

// ─── Payload structure ────────────────────────────────────────────────────────

describe('payload shapes', () => {
  it('hand:start payload has required fields', async () => {
    const endpoint = makeEndpoint();
    const state = makeGameState();
    const payload: HandStartPayload = {
      event: 'hand:start',
      arenaId: 'arena-99',
      handNumber: 3,
      vrfCommit: 'commitabc123',
      state,
    };

    await dispatchToAgent(endpoint, payload);

    const [, body] = mockAxiosPost.mock.calls[0] as [string, HandStartPayload];
    expect(body.event).toBe('hand:start');
    expect(body.arenaId).toBe('arena-99');
    expect(body.handNumber).toBe(3);
    expect(body.vrfCommit).toBe('commitabc123');
    expect(body.state).toBeDefined();
  });

  it('hand:action payload has required fields including actorAgentId and action', async () => {
    const endpoint = makeEndpoint();
    const state = makeGameState();
    const payload: HandActionPayload = {
      event: 'hand:action',
      arenaId: 'arena-99',
      handNumber: 3,
      actorAgentId: 'agent-actor',
      action: { type: 'raise', amount: 200 },
      state,
    };

    await dispatchToAgent(endpoint, payload);

    const [, body] = mockAxiosPost.mock.calls[0] as [string, HandActionPayload];
    expect(body.event).toBe('hand:action');
    expect(body.actorAgentId).toBe('agent-actor');
    expect(body.action.type).toBe('raise');
    expect(body.action.amount).toBe(200);
  });

  it('hand:end payload has required fields including winners and vrfSeed', async () => {
    const endpoint = makeEndpoint();
    const state = makeGameState({ stage: 'finished' });
    const winners: Winner[] = [
      { agentId: 'agent-a', amount: 150, handRank: 'pair' },
    ];
    const payload: HandEndPayload = {
      event: 'hand:end',
      arenaId: 'arena-99',
      handNumber: 3,
      winners,
      vrfSeed: 'revealedseed',
      state,
    };

    await dispatchToAgent(endpoint, payload);

    const [, body] = mockAxiosPost.mock.calls[0] as [string, HandEndPayload];
    expect(body.event).toBe('hand:end');
    expect(body.winners).toHaveLength(1);
    expect(body.winners[0]!.agentId).toBe('agent-a');
    expect(body.winners[0]!.amount).toBe(150);
    expect(body.vrfSeed).toBe('revealedseed');
  });
});

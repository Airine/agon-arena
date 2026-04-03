import { describe, expect, it, vi } from 'vitest';

import { fetchAgentTraces, type TraceRow } from '../_components/traceAggregation';

describe('fetchAgentTraces', () => {
  it('keeps successful agent traces when another agent trace request fails', async () => {
    const alphaTrace: TraceRow = {
      id: 'trace-1',
      agentId: 'alpha',
      turnId: 'turn-1',
      errorType: 'timeout',
      details: { message: 'alpha timed out' },
      createdAt: '2026-04-03T08:00:00.000Z',
    };
    const betaTrace: TraceRow = {
      id: 'trace-2',
      agentId: 'alpha',
      turnId: 'turn-2',
      errorType: 'schema_error',
      details: { message: 'schema mismatch' },
      createdAt: '2026-04-03T08:05:00.000Z',
    };

    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.includes('/agents/alpha/traces')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ traces: [alphaTrace, betaTrace] }),
        } as Response;
      }

      if (url.includes('/agents/bravo/traces')) {
        return {
          ok: false,
          status: 500,
          json: async () => ({ error: 'boom' }),
        } as Response;
      }

      throw new Error(`Unexpected URL: ${url}`);
    });

    await expect(
      fetchAgentTraces({
        arenaId: 'arena-123',
        agentIds: ['alpha', 'bravo'],
        fetchImpl: fetchImpl as typeof fetch,
      }),
    ).resolves.toEqual({
      traces: [betaTrace, alphaTrace],
      hasFailures: true,
    });
  });

  it('flags the aggregate fetch as failed when every agent trace request fails', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('network down');
    });

    await expect(
      fetchAgentTraces({
        arenaId: 'arena-123',
        agentIds: ['alpha', 'bravo'],
        fetchImpl: fetchImpl as typeof fetch,
      }),
    ).resolves.toEqual({
      traces: [],
      hasFailures: true,
    });
  });
});

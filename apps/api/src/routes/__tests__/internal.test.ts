import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import { createServer } from 'http';

const {
  mockGetInternalSummary,
  mockListInternalAlphaContacts,
  mockGetInternalAlphaContactDetail,
  mockUpdateInternalAlphaContact,
  mockListInternalReleaseGates,
  mockUpdateInternalReleaseGate,
} = vi.hoisted(() => ({
  mockGetInternalSummary: vi.fn(),
  mockListInternalAlphaContacts: vi.fn(),
  mockGetInternalAlphaContactDetail: vi.fn(),
  mockUpdateInternalAlphaContact: vi.fn(),
  mockListInternalReleaseGates: vi.fn(),
  mockUpdateInternalReleaseGate: vi.fn(),
}));

vi.mock('../../services/internal-dashboard.js', () => ({
  getInternalSummary: mockGetInternalSummary,
  listInternalAlphaContacts: mockListInternalAlphaContacts,
  getInternalAlphaContactDetail: mockGetInternalAlphaContactDetail,
  updateInternalAlphaContact: mockUpdateInternalAlphaContact,
  listInternalReleaseGates: mockListInternalReleaseGates,
  updateInternalReleaseGate: mockUpdateInternalReleaseGate,
}));

import { internalRouter } from '../internal.js';

async function request(
  app: express.Express,
  method: string,
  path: string,
  opts: { body?: unknown; headers?: Record<string, string> } = {},
) {
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as { port: number };

  const res = await fetch(`http://localhost:${port}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(opts.headers ?? {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });

  const contentType = res.headers.get('content-type') ?? '';
  const body = contentType.includes('application/json') ? await res.json() : await res.text();
  await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
  return { status: res.status, body };
}

describe('internalRouter', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env['INTERNAL_AUTH_SHARED_SECRET'] = 'phase-1-secret';
  });

  function buildApp() {
    const app = express();
    app.use(express.json());
    app.use('/internal', internalRouter);
    return app;
  }

  function authHeaders() {
    return {
      'X-Internal-Auth-Subject': 'staff-123',
      'X-Internal-Auth-Email': 'staff@example.com',
      'X-Internal-Auth-Display-Name': 'Staff Example',
      'X-Internal-Auth-Secret': 'phase-1-secret',
    };
  }

  it('rejects unauthenticated summary requests', async () => {
    const app = buildApp();

    const { status, body } = await request(app, 'GET', '/internal/summary');

    expect(status).toBe(401);
    expect(body as { error: string }).toEqual({ error: 'Missing or invalid internal auth headers' });
    expect(mockGetInternalSummary).not.toHaveBeenCalled();
  });

  it('serves the summary payload for authenticated staff requests', async () => {
    mockGetInternalSummary.mockResolvedValueOnce({
      asOf: '2026-04-03T10:00:00.000Z',
      activationOverview: { newAgentsToday: 1 },
      funnelSummary: {
        stages: [{ stage: 'wallet_connected', count: 1, conversionRate: null }],
      },
      recentSuccessfulAgents: {
        items: [
          {
            id: 'evt-1',
            displayName: 'Agent Alpha',
            stage: 'first_action_submitted',
            occurredAt: '2026-04-03T09:30:00.000Z',
            arenaId: 'arena-1',
            arenaName: 'Alpha Arena',
          },
        ],
      },
      blockerQueue: { items: [] },
      runtimeRedZone: { issues: [] },
      releaseGate: { verdict: 'watch', unmetConditions: ['activation_funnel'] },
      partials: [],
    });
    const app = buildApp();

    const { status, body } = await request(app, 'GET', '/internal/summary', { headers: authHeaders() });

    expect(status).toBe(200);
    expect((body as { asOf: string }).asOf).toBe('2026-04-03T10:00:00.000Z');
    expect((body as { funnelSummary?: { stages?: unknown[] } }).funnelSummary?.stages).toHaveLength(1);
    expect((body as { recentSuccessfulAgents?: { items?: unknown[] } }).recentSuccessfulAgents?.items).toHaveLength(1);
    expect((body as { releaseGate?: { unmetConditions?: string[] } }).releaseGate?.unmetConditions).toEqual(['activation_funnel']);
    expect(mockGetInternalSummary).toHaveBeenCalledOnce();
  });

  it('rejects alpha contact patches that include out-of-scope fields', async () => {
    const app = buildApp();

    const { status, body } = await request(app, 'PATCH', '/internal/alpha-contacts/contact-1', {
      headers: authHeaders(),
      body: {
        ownerSubject: 'owner-2',
        displayName: 'Not allowed',
      },
    });

    expect(status).toBe(400);
    expect((body as { error: string }).error).toBe('Validation failed');
    expect(mockUpdateInternalAlphaContact).not.toHaveBeenCalled();
  });

  it('passes release gate patches through with the authenticated actor context', async () => {
    mockUpdateInternalReleaseGate.mockResolvedValueOnce({
      id: 'gate-1',
      gateKey: 'activation_funnel',
      status: 'pass',
      note: 'All clear',
      evidenceUrl: 'https://example.com/evidence',
      updatedBySubject: 'staff-123',
      updatedByEmail: 'staff@example.com',
      updatedAt: '2026-04-03T10:00:00.000Z',
    });
    const app = buildApp();

    const { status, body } = await request(app, 'PATCH', '/internal/release-gates/gate-1', {
      headers: authHeaders(),
      body: {
        status: 'pass',
        note: 'All clear',
        evidenceUrl: 'https://example.com/evidence',
      },
    });

    expect(status).toBe(200);
    expect((body as { status: string }).status).toBe('pass');
    expect(mockUpdateInternalReleaseGate).toHaveBeenCalledWith(
      'gate-1',
      {
        status: 'pass',
        note: 'All clear',
        evidenceUrl: 'https://example.com/evidence',
      },
      {
        subject: 'staff-123',
        email: 'staff@example.com',
        displayName: 'Staff Example',
      },
    );
  });
});

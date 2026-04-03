import { describe, expect, it } from 'vitest';
import {
  deriveFunnelStages,
  findLargestDropoffStage,
  formatStageLabel,
  summarizeAlphaQueue,
  summarizeReleaseGates,
} from '../view-model';
import type {
  InternalAlphaContact,
  InternalFunnelStage,
  InternalReleaseGate,
} from '../contracts';

describe('internal view-model helpers', () => {
  it('formats stage labels for human-readable tables', () => {
    expect(formatStageLabel('first_action_submitted')).toBe('First Action Submitted');
  });

  it('derives funnel conversion rates from adjacent stages when absent', () => {
    const stages: InternalFunnelStage[] = [
      { stage: 'wallet_connected', count: 100 },
      { stage: 'session_created', count: 75 },
      { stage: 'first_action_submitted', count: 30 },
    ];

    expect(deriveFunnelStages(stages)).toEqual([
      { stage: 'wallet_connected', count: 100, derivedConversionRate: null },
      { stage: 'session_created', count: 75, derivedConversionRate: 0.75 },
      { stage: 'first_action_submitted', count: 30, derivedConversionRate: 0.4 },
    ]);
  });

  it('finds the largest dropoff using adjacent funnel stage counts', () => {
    const stages: InternalFunnelStage[] = [
      { stage: 'wallet_connected', count: 120 },
      { stage: 'session_created', count: 110 },
      { stage: 'arena_joined', count: 60 },
      { stage: 'first_turn_received', count: 45 },
    ];

    expect(findLargestDropoffStage(stages)).toEqual({
      stage: 'arena_joined',
      dropCount: 50,
    });
  });

  it('summarizes alpha queue urgency buckets from contact timestamps', () => {
    const contacts: InternalAlphaContact[] = [
      {
        id: 'a1',
        displayName: 'Northwind',
        source: 'referral',
        ownerEmail: 'ops@example.com',
        status: 'blocked',
        lastActivityAt: '2026-04-01T00:00:00.000Z',
        nextFollowUpAt: '2026-04-02T00:00:00.000Z',
        notes: '',
      },
      {
        id: 'a2',
        displayName: 'Redwood',
        source: 'manual',
        status: 'installing',
        lastActivityAt: '2026-04-03T08:00:00.000Z',
        nextFollowUpAt: '2026-04-03T20:00:00.000Z',
        notes: 'Waiting on wallet setup',
      },
    ];

    expect(
      summarizeAlphaQueue(contacts, new Date('2026-04-03T12:00:00.000Z')),
    ).toEqual({
      stuckOver24h: 1,
      followUpOverdue: 1,
      missingOwnerNote: 1,
    });
  });

  it('summarizes release gate verdicts conservatively', () => {
    const gates: InternalReleaseGate[] = [
      { id: 'g1', gateKey: 'runtime_health', status: 'pass' },
      { id: 'g2', gateKey: 'alpha_conversion', status: 'watch' },
      { id: 'g3', gateKey: 'support_runbook', status: 'blocked' },
    ];

    expect(summarizeReleaseGates(gates)).toEqual({
      verdict: 'blocked',
      unmetCount: 2,
    });
  });
});

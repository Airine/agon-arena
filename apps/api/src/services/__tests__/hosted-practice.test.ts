import { describe, expect, it } from 'vitest';
import {
  shouldAutoSeatHostedSparring,
  shouldAutoStartHostedPracticeArena,
} from '../hosted-practice.js';

const baseArena = {
  id: 'arena-1',
  status: 'waiting' as const,
  mode: 'practice' as const,
  allowSparringReplacement: true,
  maxPlayers: 2,
  smallBlind: 10,
  bigBlind: 20,
  startingStack: 1000,
  maxHands: 1,
  createdByUserId: 'owner-1',
};

describe('hosted practice autopilot helpers', () => {
  it('auto-seats hosted sparring when the creator is the only active runtime', () => {
    expect(shouldAutoSeatHostedSparring(baseArena, [
      {
        id: 'seat-owner',
        agentId: 'agent-owner',
        seatIndex: 0,
        currentStack: 1000,
        agentName: 'Owner Runtime',
        apiUrl: null,
        ownerId: 'owner-1',
        agentMetadata: { hostedSkill: { role: 'primary' } },
      },
    ])).toBe(true);
  });

  it('does not auto-seat sparring when a second seat or existing sparring seat is already present', () => {
    expect(shouldAutoSeatHostedSparring(baseArena, [
      {
        id: 'seat-owner',
        agentId: 'agent-owner',
        seatIndex: 0,
        currentStack: 1000,
        agentName: 'Owner Runtime',
        apiUrl: null,
        ownerId: 'owner-1',
        agentMetadata: { hostedSkill: { role: 'primary' } },
      },
      {
        id: 'seat-sparring',
        agentId: 'agent-sparring',
        seatIndex: 1,
        currentStack: 1000,
        agentName: 'Hosted Skill Sparring',
        apiUrl: 'bot://call',
        ownerId: '00000000-0000-0000-0000-000000000001',
        agentMetadata: { hostedSkillRole: 'sparring' },
      },
    ])).toBe(false);
  });

  it('auto-starts once a creator-owned seat and an opponent seat are both present', () => {
    expect(shouldAutoStartHostedPracticeArena(baseArena, [
      {
        id: 'seat-owner',
        agentId: 'agent-owner',
        seatIndex: 0,
        currentStack: 1000,
        agentName: 'Owner Runtime',
        apiUrl: null,
        ownerId: 'owner-1',
        agentMetadata: { hostedSkill: { role: 'primary' } },
      },
      {
        id: 'seat-opponent',
        agentId: 'agent-opponent',
        seatIndex: 1,
        currentStack: 1000,
        agentName: 'Opponent',
        apiUrl: null,
        ownerId: 'owner-2',
        agentMetadata: {},
      },
    ])).toBe(true);
  });

  it('does not auto-start arenas that are not waiting practice warmup tables', () => {
    expect(shouldAutoStartHostedPracticeArena(
      { ...baseArena, status: 'running' },
      [
        {
          id: 'seat-owner',
          agentId: 'agent-owner',
          seatIndex: 0,
          currentStack: 1000,
          agentName: 'Owner Runtime',
          apiUrl: null,
          ownerId: 'owner-1',
          agentMetadata: { hostedSkill: { role: 'primary' } },
        },
        {
          id: 'seat-opponent',
          agentId: 'agent-opponent',
          seatIndex: 1,
          currentStack: 1000,
          agentName: 'Opponent',
          apiUrl: null,
          ownerId: 'owner-2',
          agentMetadata: {},
        },
      ],
    )).toBe(false);
  });
});

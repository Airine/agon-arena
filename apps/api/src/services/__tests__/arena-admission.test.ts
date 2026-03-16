import { describe, expect, it } from 'vitest';
import {
  findSparringReplacementSeat,
  isHostedSkillSparring,
} from '../arena-admission.js';

describe('arena admission helpers', () => {
  it('detects hosted skill sparring metadata across supported shapes', () => {
    expect(isHostedSkillSparring({ runtimeRole: 'sparring' })).toBe(true);
    expect(isHostedSkillSparring({ hostedSkillRole: 'sparring' })).toBe(true);
    expect(isHostedSkillSparring({ hostedSkill: { role: 'sparring' } })).toBe(true);
    expect(isHostedSkillSparring({ hostedSkill: { role: 'primary' } })).toBe(false);
  });

  it('prefers replacing sparring when the arena opted in', () => {
    const seat = findSparringReplacementSeat({
      allowSparringReplacement: true,
      joiningAgentMetadata: { hostedSkill: { role: 'primary' } },
      existingSeats: [
        {
          id: 'seat-owner',
          agentId: 'agent-owner',
          seatIndex: 0,
          currentStack: 1000,
          agentMetadata: { hostedSkill: { role: 'primary' } },
        },
        {
          id: 'seat-sparring',
          agentId: 'agent-sparring',
          seatIndex: 1,
          currentStack: 1000,
          agentMetadata: { hostedSkill: { role: 'sparring' } },
        },
      ],
    });

    expect(seat?.id).toBe('seat-sparring');
  });

  it('does not replace sparring when the joining runtime is itself sparring', () => {
    const seat = findSparringReplacementSeat({
      allowSparringReplacement: true,
      joiningAgentMetadata: { runtimeRole: 'sparring' },
      existingSeats: [
        {
          id: 'seat-owner',
          agentId: 'agent-owner',
          seatIndex: 0,
          currentStack: 1000,
          agentMetadata: { hostedSkill: { role: 'primary' } },
        },
        {
          id: 'seat-sparring',
          agentId: 'agent-sparring',
          seatIndex: 1,
          currentStack: 1000,
          agentMetadata: { hostedSkill: { role: 'sparring' } },
        },
      ],
    });

    expect(seat).toBeUndefined();
  });

  it('requires at least one non-sparring seat to protect empty warmup tables', () => {
    const seat = findSparringReplacementSeat({
      allowSparringReplacement: true,
      joiningAgentMetadata: {},
      existingSeats: [
        {
          id: 'seat-sparring',
          agentId: 'agent-sparring',
          seatIndex: 0,
          currentStack: 1000,
          agentMetadata: { hostedSkillRole: 'sparring' },
        },
      ],
    });

    expect(seat).toBeUndefined();
  });
});

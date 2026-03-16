export interface ArenaAdmissionSeat {
  id: string;
  agentId: string;
  seatIndex: number;
  currentStack: number;
  agentMetadata: unknown;
}

function getHostedSkillRole(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== 'object') return null;

  const record = metadata as Record<string, unknown>;
  if (typeof record['runtimeRole'] === 'string') {
    return record['runtimeRole'];
  }
  if (typeof record['hostedSkillRole'] === 'string') {
    return record['hostedSkillRole'];
  }

  const hostedSkill = record['hostedSkill'];
  if (hostedSkill && typeof hostedSkill === 'object') {
    const role = (hostedSkill as Record<string, unknown>)['role'];
    return typeof role === 'string' ? role : null;
  }

  return null;
}

export function isHostedSkillSparring(metadata: unknown): boolean {
  return getHostedSkillRole(metadata) === 'sparring';
}

export function findSparringReplacementSeat(input: {
  allowSparringReplacement: boolean;
  joiningAgentMetadata: unknown;
  existingSeats: ArenaAdmissionSeat[];
}): ArenaAdmissionSeat | undefined {
  if (!input.allowSparringReplacement) return undefined;
  if (isHostedSkillSparring(input.joiningAgentMetadata)) return undefined;

  const sparringSeat = input.existingSeats.find((seat) => isHostedSkillSparring(seat.agentMetadata));
  if (!sparringSeat) return undefined;

  const nonSparringSeats = input.existingSeats.filter((seat) => seat.id !== sparringSeat.id);
  if (nonSparringSeats.length === 0) return undefined;

  return sparringSeat;
}

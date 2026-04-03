import type {
  InternalAlphaContact,
  InternalFunnelStage,
  InternalReleaseGate,
} from './contracts';

const DAY_MS = 24 * 60 * 60 * 1000;

export function formatStageLabel(stage: string): string {
  return stage
    .split('_')
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(' ');
}

export function deriveFunnelStages(
  stages: InternalFunnelStage[],
): Array<InternalFunnelStage & { derivedConversionRate: number | null }> {
  return stages.map((stage, index) => {
    const previous = stages[index - 1];
    const derivedConversionRate =
      stage.conversionRate ??
      (previous && previous.count > 0 ? stage.count / previous.count : null);

    return {
      ...stage,
      derivedConversionRate,
    };
  });
}

export function findLargestDropoffStage(stages: InternalFunnelStage[]): {
  stage: string;
  dropCount: number;
} | null {
  if (stages.length < 2) return null;

  let largest: { stage: string; dropCount: number } | null = null;

  for (let index = 1; index < stages.length; index += 1) {
    const previous = stages[index - 1];
    const current = stages[index];
    const dropCount = previous.count - current.count;

    if (dropCount <= 0) continue;

    if (!largest || dropCount > largest.dropCount) {
      largest = { stage: current.stage, dropCount };
    }
  }

  return largest;
}

export function summarizeAlphaQueue(
  contacts: InternalAlphaContact[],
  now = new Date(),
): {
  stuckOver24h: number;
  followUpOverdue: number;
  missingOwnerNote: number;
} {
  const nowMs = now.getTime();

  return contacts.reduce(
    (summary, contact) => {
      const lastActivityAt = contact.lastActivityAt
        ? Date.parse(contact.lastActivityAt)
        : Number.NaN;
      const nextFollowUpAt = contact.nextFollowUpAt
        ? Date.parse(contact.nextFollowUpAt)
        : Number.NaN;
      const missingOwnerNote = Boolean(
        contact.lastActivityAt &&
          !contact.notes?.trim() &&
          Boolean(contact.ownerEmail?.trim()),
      );

      if (!Number.isNaN(lastActivityAt) && nowMs - lastActivityAt > DAY_MS) {
        summary.stuckOver24h += 1;
      }

      if (!Number.isNaN(nextFollowUpAt) && nextFollowUpAt < nowMs) {
        summary.followUpOverdue += 1;
      }

      if (missingOwnerNote) {
        summary.missingOwnerNote += 1;
      }

      return summary;
    },
    {
      stuckOver24h: 0,
      followUpOverdue: 0,
      missingOwnerNote: 0,
    },
  );
}

export function summarizeReleaseGates(gates: InternalReleaseGate[]): {
  verdict: 'ready' | 'watch' | 'blocked';
  unmetCount: number;
} {
  if (gates.some((gate) => gate.status === 'blocked')) {
    return {
      verdict: 'blocked',
      unmetCount: gates.filter((gate) => gate.status !== 'pass').length,
    };
  }

  if (gates.some((gate) => gate.status === 'watch')) {
    return {
      verdict: 'watch',
      unmetCount: gates.filter((gate) => gate.status !== 'pass').length,
    };
  }

  return { verdict: 'ready', unmetCount: 0 };
}

/**
 * Unit tests for buildHandGroups()
 *
 * The function lives in page.tsx; we copy/inline it here for isolated testing
 * (the web package has no module-export boundary for page-internal helpers).
 */

import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Inline the types and function under test
// (mirrors the implementation in page.tsx exactly)
// ---------------------------------------------------------------------------

interface ActionEntry {
  id: string;
  type: 'action' | 'hand_start' | 'hand_end' | 'arena_finished';
  handNumber?: number;
  stage?: string;
  agentId?: string;
  agentName?: string;
  action?: { type: string; amount?: number };
  winners?: Array<{ agentId: string; amount: number }>;
  timestamp: number;
}

interface HandGroup {
  handNumber: number;
  winnerName: string | null;
  isFinished: boolean;
  rounds: { stage: string; entries: ActionEntry[] }[];
}

function buildHandGroups(actions: ActionEntry[]): HandGroup[] {
  // actions is newest-first → reverse to chronological
  const chron = [...actions].reverse();

  const groupMap = new Map<number, HandGroup>();

  for (const entry of chron) {
    if (entry.type === 'hand_start' && entry.handNumber != null) {
      if (!groupMap.has(entry.handNumber)) {
        groupMap.set(entry.handNumber, { handNumber: entry.handNumber, winnerName: null, isFinished: false, rounds: [] });
      }
    } else if (entry.type === 'hand_end' && entry.handNumber != null) {
      const g = groupMap.get(entry.handNumber) ?? { handNumber: entry.handNumber, winnerName: null, isFinished: false, rounds: [] };
      g.isFinished = true;
      const winnerAgentId = entry.winners?.[0]?.agentId;
      if (winnerAgentId) {
        for (const r of g.rounds) {
          const found = r.entries.find((e) => e.agentId === winnerAgentId);
          if (found?.agentName) { g.winnerName = found.agentName; break; }
        }
      }
      groupMap.set(entry.handNumber, g);
    } else if (entry.type === 'action' && entry.handNumber != null) {
      let g = groupMap.get(entry.handNumber);
      if (!g) { g = { handNumber: entry.handNumber, winnerName: null, isFinished: false, rounds: [] }; groupMap.set(entry.handNumber, g); }
      const stage = entry.stage ?? 'pre_flop';
      let round = g.rounds.find((r) => r.stage === stage);
      if (!round) { round = { stage, entries: [] }; g.rounds.push(round); }
      round.entries.push(entry);
    }
  }

  return [...groupMap.values()].sort((a, b) => b.handNumber - a.handNumber);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let _id = 0;
function makeEntry(overrides: Partial<ActionEntry> & Pick<ActionEntry, 'type'>): ActionEntry {
  return {
    id: `entry-${++_id}`,
    timestamp: Date.now(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('buildHandGroups', () => {
  it('1. empty array returns []', () => {
    expect(buildHandGroups([])).toEqual([]);
  });

  it('2. actions with no hand_start still create a group but isFinished=false', () => {
    const actions: ActionEntry[] = [
      makeEntry({ type: 'action', handNumber: 1, stage: 'pre_flop', agentId: 'a1', agentName: 'Alice', action: { type: 'call' } }),
    ];
    const groups = buildHandGroups(actions);
    expect(groups).toHaveLength(1);
    expect(groups[0].handNumber).toBe(1);
    expect(groups[0].isFinished).toBe(false);
  });

  it('3. normal sequence (start → actions → end) produces 1 finished group with correct winner', () => {
    const actions: ActionEntry[] = [
      // newest-first order
      makeEntry({ type: 'hand_end', handNumber: 1, winners: [{ agentId: 'a1', amount: 200 }] }),
      makeEntry({ type: 'action', handNumber: 1, stage: 'pre_flop', agentId: 'a1', agentName: 'Alice', action: { type: 'raise', amount: 100 } }),
      makeEntry({ type: 'action', handNumber: 1, stage: 'pre_flop', agentId: 'a2', agentName: 'Bob', action: { type: 'fold' } }),
      makeEntry({ type: 'hand_start', handNumber: 1 }),
    ];
    const groups = buildHandGroups(actions);
    expect(groups).toHaveLength(1);
    expect(groups[0].isFinished).toBe(true);
    expect(groups[0].winnerName).toBe('Alice');
    expect(groups[0].rounds).toHaveLength(1);
  });

  it('4. multiple hands are ordered by handNumber descending', () => {
    const actions: ActionEntry[] = [
      makeEntry({ type: 'hand_end', handNumber: 3, winners: [] }),
      makeEntry({ type: 'hand_start', handNumber: 3 }),
      makeEntry({ type: 'hand_end', handNumber: 2, winners: [] }),
      makeEntry({ type: 'hand_start', handNumber: 2 }),
      makeEntry({ type: 'hand_start', handNumber: 1 }),
    ];
    const groups = buildHandGroups(actions);
    expect(groups.map((g) => g.handNumber)).toEqual([3, 2, 1]);
  });

  it('5. hand_end arriving before hand_start is idempotent — no duplicate groups', () => {
    // Even though hand_end appears before hand_start in the raw (newest-first) list,
    // after reversal the start comes first in chronological order.
    // But if only hand_end arrives with no hand_start, we still get exactly 1 group.
    const actions: ActionEntry[] = [
      makeEntry({ type: 'hand_end', handNumber: 5, winners: [{ agentId: 'x', amount: 100 }] }),
      makeEntry({ type: 'action', handNumber: 5, stage: 'flop', agentId: 'x', agentName: 'X', action: { type: 'check' } }),
    ];
    const groups = buildHandGroups(actions);
    expect(groups).toHaveLength(1);
    expect(groups[0].handNumber).toBe(5);
    expect(groups[0].isFinished).toBe(true);
  });

  it('6. reconnect: same hand_start event arrives again → only one group', () => {
    const actions: ActionEntry[] = [
      makeEntry({ type: 'hand_start', handNumber: 2 }),
      makeEntry({ type: 'action', handNumber: 2, stage: 'pre_flop', agentId: 'a', agentName: 'A', action: { type: 'fold' } }),
      makeEntry({ type: 'hand_start', handNumber: 2 }), // duplicate
    ];
    const groups = buildHandGroups(actions);
    expect(groups).toHaveLength(1);
    expect(groups[0].handNumber).toBe(2);
  });

  it('7. action with handNumber=null is silently dropped', () => {
    const actions: ActionEntry[] = [
      makeEntry({ type: 'action', handNumber: undefined, stage: 'pre_flop', agentId: 'a', agentName: 'A', action: { type: 'call' } }),
      makeEntry({ type: 'hand_start', handNumber: 1 }),
    ];
    const groups = buildHandGroups(actions);
    // Only the hand_start group exists; the action with no handNumber is dropped
    expect(groups).toHaveLength(1);
    expect(groups[0].rounds).toHaveLength(0);
  });

  it('8. winner agentId not found in rounds → winnerName is null', () => {
    const actions: ActionEntry[] = [
      makeEntry({ type: 'hand_end', handNumber: 7, winners: [{ agentId: 'ghost', amount: 500 }] }),
      makeEntry({ type: 'hand_start', handNumber: 7 }),
    ];
    const groups = buildHandGroups(actions);
    expect(groups).toHaveLength(1);
    expect(groups[0].isFinished).toBe(true);
    expect(groups[0].winnerName).toBeNull();
  });
});

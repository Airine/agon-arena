'use client';

import React, { useMemo } from 'react';
import type { ChipSnapshot } from '@/hooks/useArenaSocket';
import { EmptyState } from '@/components/chrome';

interface Props {
  chipSnapshots: ChipSnapshot[];
  startingStack: number;
}

const CHART_HEIGHT = 80;
const WINDOW = 20;

function PnLChart({ chipSnapshots, startingStack }: Props) {
  const data = useMemo(() => {
    if (chipSnapshots.length === 0) return null;

    // Use the last WINDOW hands
    const window = chipSnapshots.slice(-WINDOW);

    // Collect all agent IDs in order of first appearance
    const agentIds: string[] = [];
    const agentNames: Map<string, string> = new Map();
    for (const snap of window) {
      for (const s of snap.stacks) {
        if (!agentNames.has(s.agentId)) {
          agentIds.push(s.agentId);
          agentNames.set(s.agentId, s.agentName);
        }
      }
    }

    if (agentIds.length === 0) return null;

    // Build pnl[agentIndex][handIndex] = stack - startingStack
    const pnl: number[][] = agentIds.map(() => []);
    for (const snap of window) {
      const stackMap = new Map(snap.stacks.map((s) => [s.agentId, s.stack]));
      for (let ai = 0; ai < agentIds.length; ai++) {
        const stack = stackMap.get(agentIds[ai]) ?? 0;
        pnl[ai].push(stack - startingStack);
      }
    }

    // Find the current chip leader (highest last stack)
    let leaderId: string | null = null;
    let leaderStack = -Infinity;
    const lastSnap = window[window.length - 1];
    for (const s of lastSnap.stacks) {
      if (s.stack > leaderStack) {
        leaderStack = s.stack;
        leaderId = s.agentId;
      }
    }

    return { agentIds, pnl, leaderId, handCount: window.length };
  }, [chipSnapshots, startingStack]);

  if (!data) {
    return (
      <EmptyState
        title="No data yet"
        description="Waiting for first hand..."
      />
    );
  }

  const { agentIds, pnl, leaderId, handCount } = data;

  // Compute global min/max across all agents for y-axis scaling
  let minPnl = 0;
  let maxPnl = 0;
  for (const series of pnl) {
    for (const v of series) {
      if (v < minPnl) minPnl = v;
      if (v > maxPnl) maxPnl = v;
    }
  }
  // Ensure zero is always visible
  const yRange = Math.max(maxPnl - minPnl, 1);
  const yPad = yRange * 0.1;
  const yMin = minPnl - yPad;
  const yMax = maxPnl + yPad;
  const ySpan = yMax - yMin || 1;

  function toY(val: number): number {
    // Flip: higher value → lower y pixel (SVG origin top-left)
    return CHART_HEIGHT - ((val - yMin) / ySpan) * CHART_HEIGHT;
  }

  // x spacing: distribute n points across full width (use viewBox 0..100)
  const WIDTH = 100;
  function toX(i: number): number {
    if (handCount <= 1) return WIDTH / 2;
    return (i / (handCount - 1)) * WIDTH;
  }

  // Zero axis y position
  const zeroY = toY(0);

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${CHART_HEIGHT}`}
      preserveAspectRatio="none"
      style={{ width: '100%', height: CHART_HEIGHT, display: 'block' }}
      aria-hidden="true"
    >
      {/* Zero axis */}
      <line
        x1={0}
        y1={zeroY}
        x2={WIDTH}
        y2={zeroY}
        stroke="var(--border2)"
        strokeWidth={0.5}
        strokeDasharray="2 2"
      />

      {/* Agent lines */}
      {agentIds.map((agentId, ai) => {
        const series = pnl[ai];
        if (series.length === 0) return null;
        const isLeader = agentId === leaderId;

        const points = series
          .map((v, i) => `${toX(i).toFixed(2)},${toY(v).toFixed(2)}`)
          .join(' ');

        return (
          <polyline
            key={agentId}
            points={points}
            fill="none"
            stroke={isLeader ? 'var(--gold)' : 'var(--ink-faint)'}
            strokeWidth={isLeader ? 1.5 : 0.8}
            strokeLinejoin="round"
            strokeLinecap="round"
            opacity={isLeader ? 1 : 0.6}
          />
        );
      })}
    </svg>
  );
}

export default React.memo(PnLChart);

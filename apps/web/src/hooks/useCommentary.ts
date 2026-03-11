'use client';

import { useEffect, useRef, useState } from 'react';
import type { ActionEntry } from './useArenaSocket';
import type { GameState } from '@agon/types';

export interface CommentaryState {
  text: string | null;
  isLoading: boolean;
}

// Only generate commentary for high-impact actions
const KEY_ACTIONS = new Set(['raise', 'all_in']);

const COMMENTARY_TTL_MS = 8000;

export function useCommentary(
  actions: ActionEntry[],
  gameState: GameState | null,
): CommentaryState {
  const [commentary, setCommentary] = useState<CommentaryState>({
    text: null,
    isLoading: false,
  });

  const lastEntryIdRef = useRef<string | null>(null);
  const clearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (actions.length === 0) return;

    const latest = actions[0]; // newest is always first
    if (!latest || latest.type !== 'action') return;
    if (latest.id === lastEntryIdRef.current) return;
    if (!KEY_ACTIONS.has(latest.action?.type ?? '')) return;

    lastEntryIdRef.current = latest.id;

    // Clear any existing auto-clear timer
    if (clearTimerRef.current) clearTimeout(clearTimerRef.current);

    setCommentary({ text: null, isLoading: true });

    const payload = {
      agentName: latest.agentName ?? latest.agentId ?? 'Agent',
      action: latest.action?.type ?? 'raise',
      amount: latest.action?.amount,
      stage: gameState?.stage ?? 'pre_flop',
      pot: gameState?.pots.reduce((s, p) => s + p.amount, 0) ?? 0,
      playerCount: gameState?.players.filter((p) => p.isActive).length ?? 2,
      handNumber: latest.handNumber ?? gameState?.handNumber ?? 0,
    };

    fetch('/api/commentary', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
      .then((r) => (r.ok ? r.json() : { commentary: null }))
      .then((data: { commentary: string | null }) => {
        setCommentary({ text: data.commentary, isLoading: false });

        // Auto-clear after TTL
        clearTimerRef.current = setTimeout(() => {
          setCommentary({ text: null, isLoading: false });
        }, COMMENTARY_TTL_MS);
      })
      .catch(() => {
        setCommentary({ text: null, isLoading: false });
      });
  }, [actions, gameState]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
    };
  }, []);

  return commentary;
}

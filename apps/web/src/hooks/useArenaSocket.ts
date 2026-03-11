'use client';

import { useEffect, useRef, useState, useCallback, startTransition } from 'react';
import type {
  GameState,
  WsGameAction,
  WsHandStart,
  WsHandEnd,
} from '@agon/types';
import { socketManager } from '../lib/socketManager';

export interface ActionEntry {
  id: string;
  type: 'action' | 'hand_start' | 'hand_end' | 'arena_finished';
  handNumber?: number;
  agentId?: string;
  agentName?: string;
  action?: WsGameAction['action'];
  winners?: WsHandEnd['winners'];
  timestamp: number;
  /** Round-trip latency hint (ms) when server embeds serverTime */
  latencyMs?: number;
}

export interface UseArenaSocketResult {
  gameState: GameState | null;
  actions: ActionEntry[];
  connected: boolean;
  arenaFinished: boolean;
}

const WS_URL =
  (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_WS_URL) ||
  'http://localhost:4000';

const MAX_ACTION_LOG = 200;

// ---------------------------------------------------------------------------
// Server event payloads
// ---------------------------------------------------------------------------
interface HandStartPayload extends WsHandStart {
  serverTime?: number;
}
interface GameActionPayload extends WsGameAction {
  serverTime?: number;
}
interface HandEndPayload extends WsHandEnd {
  serverTime?: number;
}
interface ArenaFinishedPayload {
  arenaId: string;
}

export function useArenaSocket(arenaId: string): UseArenaSocketResult {
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [actions, setActions] = useState<ActionEntry[]>([]);
  const [connected, setConnected] = useState(false);
  const [arenaFinished, setArenaFinished] = useState(false);

  // Batch pending state updates to reduce re-renders under burst traffic
  const pendingRef = useRef<{
    gameState?: GameState;
    actions?: ActionEntry[];
  }>({});
  const flushScheduled = useRef(false);

  const scheduledFlush = useCallback(() => {
    flushScheduled.current = false;
    const { gameState: gs, actions: acts } = pendingRef.current;
    pendingRef.current = {};
    startTransition(() => {
      if (gs !== undefined) setGameState(gs);
      if (acts !== undefined) setActions(acts);
    });
  }, []);

  const enqueue = useCallback(
    (gs?: GameState, newAction?: ActionEntry) => {
      if (gs !== undefined) pendingRef.current.gameState = gs;
      if (newAction !== undefined) {
        const prev = pendingRef.current.actions ?? [];
        pendingRef.current.actions = [newAction, ...prev].slice(0, MAX_ACTION_LOG);
      }
      if (!flushScheduled.current) {
        flushScheduled.current = true;
        // Use microtask to coalesce rapid messages (e.g. burst on hand start)
        queueMicrotask(scheduledFlush);
      }
    },
    [scheduledFlush],
  );

  useEffect(() => {
    if (typeof window === 'undefined') return; // SSR guard

    const socket = socketManager.connect(WS_URL);

    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    if (socket.connected) setConnected(true);

    const listener = (event: string, data: unknown) => {
      const now = Date.now();

      if (event === 'hand:start') {
        const payload = data as HandStartPayload;
        if (payload.arenaId !== arenaId) return;
        const latencyMs = payload.serverTime ? now - payload.serverTime : undefined;
        enqueue(undefined, {
          id: `hand-start-${payload.handNumber}-${now}`,
          type: 'hand_start',
          handNumber: payload.handNumber,
          timestamp: now,
          latencyMs,
        });
      } else if (event === 'game:action') {
        const payload = data as GameActionPayload;
        if (payload.arenaId !== arenaId) return;
        const latencyMs = payload.serverTime ? now - payload.serverTime : undefined;
        enqueue(payload.resultingState, {
          id: `action-${payload.handId}-${payload.agentId}-${now}`,
          type: 'action',
          agentId: payload.agentId,
          agentName:
            payload.resultingState.players.find((p) => p.agentId === payload.agentId)
              ?.agentName ?? payload.agentId,
          action: payload.action,
          handNumber: payload.resultingState.handNumber,
          timestamp: now,
          latencyMs,
        });
      } else if (event === 'hand:end') {
        const payload = data as HandEndPayload;
        if (payload.arenaId !== arenaId) return;
        const latencyMs = payload.serverTime ? now - payload.serverTime : undefined;
        enqueue(payload.finalState, {
          id: `hand-end-${payload.handNumber}-${now}`,
          type: 'hand_end',
          handNumber: payload.handNumber,
          winners: payload.winners,
          timestamp: now,
          latencyMs,
        });
      } else if (event === 'arena:finished') {
        const payload = data as ArenaFinishedPayload;
        if (payload.arenaId !== arenaId) return;
        startTransition(() => setArenaFinished(true));
      }
    };

    socketManager.joinArena(arenaId, listener);

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socketManager.leaveArena(arenaId, listener);
    };
  }, [arenaId, enqueue]);

  return { gameState, actions, connected, arenaFinished };
}

'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import type {
  GameState,
  WsGameStateUpdate,
  WsGameAction,
  WsHandStart,
  WsHandEnd,
} from '@agon/types';

export interface ActionEntry {
  id: string;
  type: 'action' | 'hand_start' | 'hand_end';
  handNumber?: number;
  agentId?: string;
  agentName?: string;
  action?: WsGameAction['action'];
  winners?: WsHandEnd['winners'];
  timestamp: number;
}

interface UseArenaSocketResult {
  gameState: GameState | null;
  actions: ActionEntry[];
  connected: boolean;
}

const WS_URL =
  (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_WS_URL) ||
  'http://localhost:4000';

export function useArenaSocket(arenaId: string): UseArenaSocketResult {
  const socketRef = useRef<Socket | null>(null);
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [actions, setActions] = useState<ActionEntry[]>([]);
  const [connected, setConnected] = useState(false);

  const pushAction = useCallback((entry: ActionEntry) => {
    setActions((prev) => [entry, ...prev].slice(0, 200));
  }, []);

  useEffect(() => {
    const socket = io(WS_URL, {
      reconnectionDelayMax: 5000,
      transports: ['websocket'],
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      setConnected(true);
      socket.emit('spectate', { arenaId });
    });

    socket.on('disconnect', () => {
      setConnected(false);
    });

    socket.on('game_state', (data: WsGameStateUpdate) => {
      if (data.arenaId === arenaId) {
        setGameState(data.state);
      }
    });

    socket.on('game_state_update', (data: WsGameStateUpdate) => {
      if (data.arenaId === arenaId) {
        setGameState(data.state);
      }
    });

    socket.on('game_action', (data: WsGameAction) => {
      if (data.arenaId === arenaId) {
        setGameState(data.resultingState);
        pushAction({
          id: `${data.handId}-${data.agentId}-${Date.now()}`,
          type: 'action',
          agentId: data.agentId,
          agentName: data.resultingState.players.find(
            (p) => p.agentId === data.agentId
          )?.agentName ?? data.agentId,
          action: data.action,
          handNumber: data.resultingState.handNumber,
          timestamp: Date.now(),
        });
      }
    });

    socket.on('hand_start', (data: WsHandStart) => {
      if (data.arenaId === arenaId) {
        pushAction({
          id: `hand-start-${data.handNumber}-${Date.now()}`,
          type: 'hand_start',
          handNumber: data.handNumber,
          timestamp: Date.now(),
        });
      }
    });

    socket.on('hand_end', (data: WsHandEnd) => {
      if (data.arenaId === arenaId) {
        setGameState(data.finalState);
        pushAction({
          id: `hand-end-${data.handNumber}-${Date.now()}`,
          type: 'hand_end',
          handNumber: data.handNumber,
          winners: data.winners,
          timestamp: Date.now(),
        });
      }
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [arenaId, pushAction]);

  return { gameState, actions, connected };
}

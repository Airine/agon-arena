'use client';

import { useEffect, useState } from 'react';
import { use } from 'react';
import dynamic from 'next/dynamic';
import ActionLog from '../../../components/ActionLog';
import { useArenaSocket } from '../../../hooks/useArenaSocket';

// Dynamic import to avoid SSR issues with ECharts
const ChipEquityChart = dynamic(() => import('../../../components/ChipEquityChart'), {
  ssr: false,
  loading: () => null,
});

// Dynamic import to avoid SSR issues with Konva
const PokerTable = dynamic(() => import('../../../components/PokerTable'), {
  ssr: false,
  loading: () => (
    <div
      style={{
        width: '100%',
        height: 480,
        background: '#0a0a0a',
        borderRadius: '12px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--muted)',
      }}
    >
      Loading table...
    </div>
  ),
});

interface ArenaDetail {
  id: string;
  name: string;
  status: string;
  spectatorCount: number;
  smallBlind: number;
  bigBlind: number;
  seats: Array<{
    seatIndex: number;
    agentName: string;
    currentStack: number;
    eloRating: number;
  }>;
}

const API_URL =
  (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_API_URL) ||
  'http://localhost:4000';

export default function SpectatorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: arenaId } = use(params);
  const { gameState, actions, chipSnapshots, connected, arenaFinished } = useArenaSocket(arenaId);
  const [arena, setArena] = useState<ArenaDetail | null>(null);

  useEffect(() => {
    fetch(`${API_URL}/arenas/${arenaId}`)
      .then((r) => r.json())
      .then((data: ArenaDetail) => setArena(data))
      .catch(() => null);
  }, [arenaId]);

  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'var(--bg)',
        padding: '16px',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '16px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <a href="/arenas" style={{ color: 'var(--muted)', fontSize: '14px' }}>
            ← Lobby
          </a>
          <h1 style={{ fontSize: '20px', fontWeight: 700, color: 'var(--fg)' }}>
            {arena?.name ?? 'Loading…'}
          </h1>
          {arena && (
            <span
              style={{
                fontSize: '11px',
                padding: '2px 8px',
                borderRadius: '4px',
                background: arena.status === 'running' ? '#1a4731' : '#2d3748',
                color: arena.status === 'running' ? '#68d391' : 'var(--muted)',
                border: `1px solid ${arena.status === 'running' ? '#2d8b5a' : 'var(--border)'}`,
              }}
            >
              {arena.status.toUpperCase()}
            </span>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {arena && (
            <span style={{ fontSize: '12px', color: 'var(--muted)' }}>
              Blinds: ${arena.smallBlind}/${arena.bigBlind}
            </span>
          )}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '5px',
              fontSize: '12px',
              color: connected ? '#68d391' : '#fc8181',
            }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: connected ? '#68d391' : '#fc8181',
                display: 'inline-block',
              }}
            />
            {connected ? 'Live' : 'Disconnected'}
          </div>
          {arenaFinished && (
            <span
              style={{
                fontSize: '11px',
                padding: '2px 8px',
                borderRadius: '4px',
                background: '#2d1a1a',
                color: '#fc8181',
                border: '1px solid #8b2d2d',
              }}
            >
              FINISHED
            </span>
          )}
        </div>
      </div>

      {/* Main layout: table + action log */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 320px',
          gap: '16px',
          height: 'calc(100vh - 120px)',
        }}
      >
        {/* Poker table */}
        <div style={{ position: 'relative', minWidth: 0 }}>
          <PokerTable gameState={gameState} width={800} height={480} />

          {/* Hand info overlay */}
          {gameState && (
            <div
              style={{
                marginTop: '10px',
                display: 'flex',
                gap: '16px',
                fontSize: '12px',
                color: 'var(--muted)',
              }}
            >
              <span>Hand #{gameState.handNumber}</span>
              <span>{gameState.stage.replace('_', ' ')}</span>
              <span>{gameState.players.filter((p) => p.isActive).length} players active</span>
            </div>
          )}

          {/* Chip equity curve */}
          <div
            style={{
              marginTop: '16px',
              background: 'var(--card)',
              border: '1px solid var(--border)',
              borderRadius: '8px',
              padding: '12px',
            }}
          >
            <div
              style={{
                fontSize: '11px',
                color: 'var(--muted)',
                marginBottom: '6px',
                fontWeight: 600,
                letterSpacing: '0.05em',
                textTransform: 'uppercase',
              }}
            >
              Chip Equity
            </div>
            <ChipEquityChart snapshots={chipSnapshots} height={180} />
          </div>
        </div>

        {/* Action log */}
        <ActionLog actions={actions} />
      </div>
    </div>
  );
}

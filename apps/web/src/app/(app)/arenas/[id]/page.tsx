'use client';

import Link from 'next/link';
import { use, useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import ActionLog from '@/components/ActionLog';
import {
  ConsoleShell,
  EmptyState,
  MetricCard,
  SectionTitle,
  StatusBadge,
  SurfaceCard,
} from '@/components/chrome';
import { buildConsoleNav } from '@/components/console-nav';
import { useArenaSocket } from '@/hooks/useArenaSocket';
import { useCommentary } from '@/hooks/useCommentary';
import { buildApiUrl } from '@/lib/api';

const CommentaryBubble = dynamic(() => import('@/components/CommentaryBubble'), {
  ssr: false,
  loading: () => null,
});

const ChipEquityChart = dynamic(() => import('@/components/ChipEquityChart'), {
  ssr: false,
  loading: () => null,
});

const PokerTable = dynamic(() => import('@/components/PokerTable'), {
  ssr: false,
  loading: () => (
    <div
      style={{
        width: '100%',
        height: 480,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: '12px',
        background: '#0B0B18',
        color: '#555570',
        fontFamily: 'JetBrains Mono, monospace',
        fontSize: '13px',
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

export default function SpectatorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: arenaId } = use(params);
  const { gameState, actions, chipSnapshots, connected, arenaFinished } = useArenaSocket(arenaId);
  const commentary = useCommentary(actions, gameState);
  const [arena, setArena] = useState<ArenaDetail | null>(null);
  const [tableWidth, setTableWidth] = useState(900);

  useEffect(() => {
    fetch(buildApiUrl(`/arenas/${arenaId}`))
      .then((res) => res.json())
      .then((data: ArenaDetail) => setArena(data))
      .catch(() => null);
  }, [arenaId]);

  useEffect(() => {
    function syncTableWidth() {
      const screenWidth = window.innerWidth;
      if (screenWidth < 720) {
        setTableWidth(Math.max(320, screenWidth - 48));
        return;
      }
      if (screenWidth < 1280) {
        setTableWidth(Math.max(520, screenWidth - 96));
        return;
      }
      setTableWidth(900);
    }

    syncTableWidth();
    window.addEventListener('resize', syncTableWidth);
    return () => window.removeEventListener('resize', syncTableWidth);
  }, []);

  const arenaIsFinished = arenaFinished || arena?.status === 'finished';
  const hasRecoveredState = Boolean(gameState);
  const endedBeforeFlop = Boolean(
    gameState &&
    gameState.stage === 'finished' &&
    gameState.communityCards.length === 0,
  );
  const livePlayers = gameState?.players.filter((player) => player.isActive).length ?? arena?.seats.length ?? 0;
  const tableEmptyLabel = arenaIsFinished
    ? 'Arena ended before live state could be recovered.'
    : 'Waiting for game...';
  const actionLogEmptyMessage = arenaIsFinished
    ? endedBeforeFlop
      ? 'This recovered hand ended pre-flop, so no board cards were dealt.'
      : 'No live actions were recovered for this arena.'
    : 'Waiting for game actions…';
  const playerActivityDescription = gameState
    ? `Hand #${gameState.handNumber}`
    : arenaIsFinished
      ? hasRecoveredState
        ? 'Recovered final board state'
        : 'Arena finished before state recovery'
      : 'Waiting for the first state';

  return (
    <ConsoleShell
      section="arenas"
      title={arena?.name ?? 'Arena Detail'}
      eyebrow="Live Arena Surface"
      description="A live intelligence surface: arena state, action stream, commentary, and capital movement in one frame."
      actions={
        <Link href="/arenas" className="button-secondary">
          Back to Lobby
        </Link>
      }
      sidebarGroups={buildConsoleNav('arenas', {
        label: arena?.name ?? 'Arena Detail',
        meta: arena?.status ?? 'Loading',
      })}
      sidebarFooter={
        <SurfaceCard tone="spotlight" className="surface-card--padded">
          <div className="section-title__eyebrow">Connection</div>
          <h3 style={{ marginTop: '8px', fontSize: '1.04rem', fontWeight: 800 }}>
            {connected ? 'Socket live' : 'Disconnected'}
          </h3>
          <p className="muted-copy" style={{ marginTop: '10px', fontSize: '0.92rem' }}>
            {arenaIsFinished
              ? hasRecoveredState
                ? 'Arena finished. Reviewing the last recoverable board state.'
                : 'Arena finished before live state could be recovered.'
              : 'Watching for live state, agent actions, and commentary.'}
          </p>
        </SurfaceCard>
      }
    >
      <div className="page-stack">
        <div className="metric-grid">
          <MetricCard
            label="Status"
            value={<StatusBadge label={arenaIsFinished ? 'finished' : arena?.status ?? 'loading'} tone={arenaIsFinished ? 'danger' : arena?.status === 'running' ? 'success' : 'accent'} />}
            description="Arena lifecycle"
          />
          <MetricCard
            label="Blinds"
            value={`$${arena?.smallBlind ?? 0}/$${arena?.bigBlind ?? 0}`}
            description="Current blind structure"
          />
          <MetricCard
            label="Spectators"
            value={(arena?.spectatorCount ?? 0).toLocaleString()}
            description="Watching this arena"
          />
          <MetricCard
            label="Players Active"
            value={livePlayers.toLocaleString()}
            description={playerActivityDescription}
          />
        </div>

        <div className="split-grid">
          <div className="stack-grid">
            <SurfaceCard tone="spotlight">
              <SectionTitle eyebrow="Arena" title="Live game canvas" />
              <div
                style={{
                  borderRadius: '12px',
                  background: '#0B0B18',
                  border: '0.5px solid #1A1A30',
                  padding: '18px',
                }}
              >
                <div style={{ position: 'relative', overflowX: 'auto' }}>
                  <div style={{ minWidth: `${tableWidth}px` }}>
                    <PokerTable
                      gameState={gameState}
                      width={tableWidth}
                      height={Math.round(tableWidth * 0.62)}
                      emptyLabel={tableEmptyLabel}
                      isTerminalEmptyState={arenaIsFinished}
                    />
                    <CommentaryBubble commentary={commentary} />
                  </div>
                </div>

                {gameState ? (
                  <div
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: '12px',
                      marginTop: '12px',
                      color: '#8888AA',
                      fontSize: '0.88rem',
                    }}
                  >
                    <span>Hand #{gameState.handNumber}</span>
                    <span>{gameState.stage.replace('_', ' ')}</span>
                    <span>{gameState.players.filter((player) => player.isActive).length} players active</span>
                    {endedBeforeFlop ? <span>No board dealt before showdown</span> : null}
                  </div>
                ) : null}
              </div>
            </SurfaceCard>

            <SurfaceCard>
              <SectionTitle eyebrow="Equity" title="Chip timeline" />
              <ChipEquityChart snapshots={chipSnapshots} height={220} />
            </SurfaceCard>
          </div>

          <div className="stack-grid">
            <SurfaceCard>
              <SectionTitle eyebrow="Actions" title="Live action log" />
              <div style={{ height: '540px' }}>
                <ActionLog actions={actions} emptyMessage={actionLogEmptyMessage} />
              </div>
            </SurfaceCard>

            <SurfaceCard>
              <SectionTitle eyebrow="Seating" title={`Arena roster (${arena?.seats.length ?? 0})`} />
              {!arena || arena.seats.length === 0 ? (
                <EmptyState
                  title="No seat data yet"
                  description="Waiting for the arena detail API to describe occupied seats."
                />
              ) : (
                <div className="console-list">
                  {arena.seats.map((seat) => (
                    <div key={seat.seatIndex} className="console-row-card">
                      <div className="console-row-card__body">
                        <div className="console-row-card__title">
                          <h3>Seat {seat.seatIndex + 1}</h3>
                          <StatusBadge label={seat.agentName} tone="accent" />
                        </div>
                        <div className="console-row-card__meta">
                          <span>Stack: ${seat.currentStack.toLocaleString()}</span>
                          <span>ELO: {seat.eloRating}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </SurfaceCard>
          </div>
        </div>
      </div>
    </ConsoleShell>
  );
}

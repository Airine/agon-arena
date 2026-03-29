'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { MarketShell } from '@/components/chrome';
import { useArenaSocket } from '@/hooks/useArenaSocket';
import { buildApiUrl } from '@/lib/api';
import {
  getVisualization,
  ComingSoonVisualization,
  type AgentSummary,
} from './_components';
import { BettingPanel } from './_components/BettingPanel';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ArenaSeat {
  seatIndex: number;
  agentId: string;
  agentName: string;
  currentStack: number;
  eloRating: number;
  isActive: boolean;
}

interface ArenaData {
  id: string;
  name: string;
  gameType: string;
  mode: 'practice' | 'cash' | 'tournament';
  status: 'waiting' | 'running' | 'finished' | 'cancelled';
  smallBlind: number;
  bigBlind: number;
  startingStack: number;
  spectatorCount: number;
  seats: ArenaSeat[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatStack(n: number): string {
  return n.toLocaleString();
}

function formatAction(type: string, amount?: number): string {
  if (type === 'fold') return 'folded';
  if (type === 'check') return 'checked';
  if (type === 'call') return `called${amount ? ` ${amount}` : ''}`;
  if (type === 'raise') return `raised to ${amount ?? ''}`;
  if (type === 'all_in') return `went ALL IN${amount ? ` (${amount})` : ''}`;
  return type;
}

function timeAgo(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return `${diff}s ago`;
  return `${Math.floor(diff / 60)}m ago`;
}

function gameTypeLabel(gameType: string): string {
  const map: Record<string, string> = {
    texas_holdem: "Texas Hold'em",
    werewolf: 'Werewolf',
    debate: 'Debate',
    auction: 'Auction',
    lob: 'LOB Market',
    territory: 'Territory',
  };
  return map[gameType] ?? gameType;
}

// ---------------------------------------------------------------------------
// Leaderboard
// ---------------------------------------------------------------------------

function Leaderboard({ agents }: { agents: AgentSummary[] }) {
  const sorted = [...agents].sort((a, b) => b.currentStack - a.currentStack);
  if (sorted.length === 0) {
    return (
      <div style={{ padding: '16px 14px', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-faint)' }}>
        No agents yet
      </div>
    );
  }
  return (
    <div className="arena-leaderboard">
      {sorted.map((agent, i) => (
        <div
          key={agent.agentId}
          className={`arena-leaderboard-row${i === 0 ? ' arena-leaderboard-row--first' : ''}`}
        >
          <span className="arena-leaderboard-row__rank">{i + 1}</span>
          <span className="arena-leaderboard-row__name">{agent.agentName}</span>
          <span className="arena-leaderboard-row__stack">{formatStack(agent.currentStack)}</span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Action Feed
// ---------------------------------------------------------------------------

function ActionFeed({ actions }: { actions: ReturnType<typeof useArenaSocket>['actions'] }) {
  if (actions.length === 0) {
    return (
      <div style={{ padding: '16px 14px', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-faint)' }}>
        Waiting for actions...
      </div>
    );
  }
  return (
    <div className="arena-action-feed">
      {actions.slice(0, 60).map((entry) => {
        if (entry.type === 'hand_start' || entry.type === 'hand_end' || entry.type === 'arena_finished') {
          return (
            <div key={entry.id} className="arena-action-entry arena-action-entry--system">
              <span className="arena-action-entry__main">
                {entry.type === 'hand_start' && `— Hand #${entry.handNumber} started —`}
                {entry.type === 'hand_end' && `— Hand #${entry.handNumber} ended —`}
                {entry.type === 'arena_finished' && '— Match finished —'}
              </span>
              <span className="arena-action-entry__time">{timeAgo(entry.timestamp)}</span>
            </div>
          );
        }
        const actionType = entry.action?.type ?? 'unknown';
        return (
          <div key={entry.id} className={`arena-action-entry arena-action-entry--${actionType}`}>
            <span className="arena-action-entry__main">
              <strong>{entry.agentName}</strong> {formatAction(actionType, entry.action?.amount)}
            </span>
            <span className="arena-action-entry__time">{timeAgo(entry.timestamp)}</span>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function ArenaDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);

  const [arena, setArena] = useState<ArenaData | null>(null);
  const [loading, setLoading] = useState(true);

  const { gameState, actions, connected, arenaFinished } = useArenaSocket(id);

  useEffect(() => {
    fetch(buildApiUrl(`/arenas/${id}`))
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) setArena(data);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id]);

  // Derive agents from live gameState or fall back to arena seats
  const agents: AgentSummary[] = gameState
    ? gameState.players.map((p) => ({
        agentId: p.agentId,
        agentName: p.agentName,
        seatIndex: p.position ?? 0,
        currentStack: p.stack,
        isActive: !p.isFolded,
      }))
    : (arena?.seats ?? []).map((s) => ({
        agentId: s.agentId,
        agentName: s.agentName,
        seatIndex: s.seatIndex,
        currentStack: s.currentStack,
        eloRating: s.eloRating,
        isActive: s.isActive,
      }));

  const isFinished = arenaFinished || arena?.status === 'finished' || arena?.status === 'cancelled';
  const isLive = !isFinished && (arena?.status === 'running' || connected);

  const gameType = arena?.gameType ?? 'unknown';
  const VisualizationComponent = getVisualization(gameType) ?? ComingSoonVisualization;

  if (loading) {
    return (
      <MarketShell>
        <div className="arena-detail-skeleton">
          <div className="arena-skeleton-bar" style={{ height: 24, width: 200 }} />
          <div className="arena-skeleton-bar" style={{ height: 400 }} />
        </div>
      </MarketShell>
    );
  }

  return (
    <MarketShell>
      <div className="arena-detail-page">
        {/* Header */}
        <div className="arena-detail-page__header">
          <div className="arena-detail-page__header-left">
            <Link href="/markets" className="arena-detail-page__back">
              ← Markets
            </Link>
            <h1 className="arena-detail-page__title">
              {arena?.name ?? id}
            </h1>
            <div className="arena-detail-page__meta">
              {arena ? `${gameTypeLabel(arena.gameType)} · ${arena.smallBlind}/${arena.bigBlind} blinds` : ''}
            </div>
          </div>

          <div className="arena-detail-page__header-right">
            <div className="arena-detail-page__conn">
              <span className={`arena-detail-page__conn-dot arena-detail-page__conn-dot--${connected ? 'connected' : 'connecting'}`} />
              {connected ? 'Live' : 'Connecting'}
            </div>
          </div>
        </div>

        {/* Match ended banner */}
        {isFinished && (
          <div className="arena-match-ended-banner">Match Ended</div>
        )}

        {/* Body */}
        <div className="arena-detail-page__body">
          {/* Left column: visualization + betting panel */}
          <div className="arena-detail-page__main-col">
            {/* Visualization panel */}
            <div className="arena-detail-page__viz-panel">
              <VisualizationComponent
                arenaId={id}
                gameState={gameState}
                agents={agents}
                isLive={isLive}
                isFinished={!!isFinished}
              />
            </div>

            {/* Betting panel */}
            <BettingPanel
              arenaId={id}
              seatedAgents={agents.map((a) => ({ id: a.agentId, name: a.agentName }))}
              isLive={isLive}
              isFinished={!!isFinished}
            />
          </div>

          {/* Sidebar */}
          <aside className="arena-detail-page__sidebar">
            <div className="arena-sidebar-section">
              <div className="arena-sidebar-section__title">Leaderboard</div>
              <Leaderboard agents={agents} />
            </div>

            <div className="arena-sidebar-section">
              <div className="arena-sidebar-section__title">Action Feed</div>
              <ActionFeed actions={actions} />
            </div>
          </aside>
        </div>
      </div>
    </MarketShell>
  );
}

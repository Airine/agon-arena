'use client';

import { use, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { MarketShell, StatusBadge, SectionTitle, EmptyState } from '@/components/chrome';
import { useArenaSocket } from '@/hooks/useArenaSocket';
import { buildApiUrl } from '@/lib/api';
import {
  getVisualization,
  ComingSoonVisualization,
  type AgentSummary,
} from './_components';
import { BettingPanel } from './_components/BettingPanel';
import PnLChart from './_components/PnLChart';

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

const AGENT_ID_RE = /^[a-zA-Z0-9_-]{8,}$/;

// ---------------------------------------------------------------------------
// Matchup Header — multi-segment chip equity bar, works for 2–N agents
// ---------------------------------------------------------------------------

// One color per seat — extend if you ever support >6 players at once
const EQUITY_COLORS = [
  'var(--green)',   // 1st (leading)
  'var(--gold)',    // 2nd
  'var(--cyan)',    // 3rd
  'var(--purple)',  // 4th
  '#FF8C42',        // 5th
  '#A0E8AF',        // 6th
];

function MatchupHeader({
  agents,
  currentHandNumber,
  currentStage,
  isLive,
}: {
  agents: AgentSummary[];
  currentHandNumber: number | null;
  currentStage: string | null;
  isLive: boolean;
}) {
  // Sort by chip count descending so leader is always leftmost in the bar
  const sorted = [...agents].sort((a, b) => b.currentStack - a.currentStack);
  const total = sorted.reduce((s, a) => s + a.currentStack, 0) || 1;
  const is2p = sorted.length === 2;

  if (sorted.length === 0) return null;

  const infoLine = (
    <div className="arena-matchup-info">
      {currentHandNumber != null && <span>Hand #{currentHandNumber}</span>}
      {currentStage && (
        <>
          <span className="arena-matchup-info__sep">&middot;</span>
          <span>{STAGE_LABELS[currentStage] ?? currentStage}</span>
        </>
      )}
      {isLive && <span className="arena-matchup-info__live">live</span>}
    </div>
  );

  // Multi-segment bar — one segment per agent, width proportional to stack
  const equityBar = (
    <div className="arena-matchup-equity">
      {sorted.map((agent, i) => (
        <div
          key={agent.agentId}
          className="arena-matchup-equity__seg"
          style={{
            width: `${((agent.currentStack / total) * 100).toFixed(2)}%`,
            background: EQUITY_COLORS[i % EQUITY_COLORS.length],
          }}
        />
      ))}
    </div>
  );

  if (is2p) {
    // Flanked layout: [Name / Stack]  [bar + info]  [Stack / Name]
    return (
      <div className="arena-matchup-header">
        <div className="arena-matchup-agent arena-matchup-agent--left">
          <span className="arena-matchup-agent__name">
            {AGENT_ID_RE.test(sorted[0].agentId) ? (
              <Link href={`/agents/${sorted[0].agentId}`}>{sorted[0].agentName}</Link>
            ) : sorted[0].agentName}
          </span>
          <span className="arena-matchup-agent__stack" style={{ color: EQUITY_COLORS[0] }}>
            {formatStack(sorted[0].currentStack)}
          </span>
        </div>

        <div className="arena-matchup-center">
          {equityBar}
          {infoLine}
        </div>

        <div className="arena-matchup-agent arena-matchup-agent--right">
          <span className="arena-matchup-agent__stack" style={{ color: EQUITY_COLORS[1] }}>
            {formatStack(sorted[1].currentStack)}
          </span>
          <span className="arena-matchup-agent__name">
            {AGENT_ID_RE.test(sorted[1].agentId) ? (
              <Link href={`/agents/${sorted[1].agentId}`}>{sorted[1].agentName}</Link>
            ) : sorted[1].agentName}
          </span>
        </div>
      </div>
    );
  }

  // Multi-player layout: full-width bar + agent chip row below
  return (
    <div className="arena-matchup-header arena-matchup-header--multi">
      <div className="arena-matchup-center" style={{ width: '100%' }}>
        {equityBar}
        <div className="arena-matchup-agents-row">
          {sorted.map((agent, i) => (
            <div key={agent.agentId} className="arena-matchup-multi-agent">
              <span
                className="arena-matchup-multi-agent__dot"
                style={{ background: EQUITY_COLORS[i % EQUITY_COLORS.length] }}
              />
              <span className="arena-matchup-agent__name arena-matchup-agent__name--sm">
                {AGENT_ID_RE.test(agent.agentId) ? (
                  <Link href={`/agents/${agent.agentId}`}>{agent.agentName}</Link>
                ) : agent.agentName}
              </span>
              <span
                className="arena-matchup-agent__stack"
                style={{ color: EQUITY_COLORS[i % EQUITY_COLORS.length] }}
              >
                {formatStack(agent.currentStack)}
              </span>
            </div>
          ))}
        </div>
        {infoLine}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Leaderboard (ELO ratings sidebar)
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
          <span className="arena-leaderboard-row__name">
            {AGENT_ID_RE.test(agent.agentId) ? (
              <Link href={`/agents/${agent.agentId}`}>{agent.agentName}</Link>
            ) : (
              agent.agentName
            )}
          </span>
          <span className="arena-leaderboard-row__stack" style={{ marginRight: 8 }}>
            {formatStack(agent.currentStack)}
          </span>
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              color: 'var(--ink-soft)',
              minWidth: 36,
              textAlign: 'right',
              flexShrink: 0,
            }}
          >
            {agent.eloRating != null ? agent.eloRating : '\u2014'}
          </span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Action Feed — grouped by hand
// ---------------------------------------------------------------------------

interface HandGroup {
  handNumber: number;
  winnerName: string | null;
  isFinished: boolean;
  rounds: { stage: string; entries: ReturnType<typeof useArenaSocket>['actions'] }[];
}

function buildHandGroups(actions: ReturnType<typeof useArenaSocket>['actions']): HandGroup[] {
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
        // Find name from actions in this hand
        for (const r of g.rounds) {
          const found = r.entries.find(e => e.agentId === winnerAgentId);
          if (found?.agentName) { g.winnerName = found.agentName; break; }
        }
      }
      groupMap.set(entry.handNumber, g);
    } else if (entry.type === 'action' && entry.handNumber != null) {
      let g = groupMap.get(entry.handNumber);
      if (!g) { g = { handNumber: entry.handNumber, winnerName: null, isFinished: false, rounds: [] }; groupMap.set(entry.handNumber, g); }
      const stage = entry.stage ?? 'pre_flop';
      let round = g.rounds.find(r => r.stage === stage);
      if (!round) { round = { stage, entries: [] }; g.rounds.push(round); }
      round.entries.push(entry);
    }
  }

  // Return newest hand first
  return [...groupMap.values()].sort((a, b) => b.handNumber - a.handNumber);
}

const STAGE_LABELS: Record<string, string> = {
  pre_flop: 'Preflop', flop: 'Flop', turn: 'Turn', river: 'River', showdown: 'Showdown',
};

function ActionFeed({ actions }: { actions: ReturnType<typeof useArenaSocket>['actions'] }) {
  if (actions.length === 0) {
    return (
      <div style={{ padding: '16px 14px', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-faint)' }}>
        Waiting for actions...
      </div>
    );
  }

  const groups = buildHandGroups(actions);

  return (
    <div className="arena-action-feed">
      {groups.map((group) => (
        <div key={group.handNumber} className={`arena-hand-group${!group.isFinished ? ' arena-hand-group--live' : ''}`}>
          {/* Hand header */}
          <div className="arena-hand-group__header">
            <span className="arena-hand-group__num">Hand #{group.handNumber}</span>
            {group.winnerName && (
              <span className="arena-hand-group__winner">
                <span style={{ fontFamily: 'var(--font-serif)', fontWeight: 700, color: 'var(--gold)' }}>winner</span>
                {' '}{group.winnerName}
              </span>
            )}
            {!group.isFinished && (
              <span className="arena-hand-group__live">live</span>
            )}
          </div>

          {/* Rounds */}
          {group.rounds.map((round) => (
            <div key={round.stage} className="arena-hand-round">
              <div className="arena-hand-round__label">{STAGE_LABELS[round.stage] ?? round.stage}</div>
              {round.entries.map((entry) => {
                const actionType = entry.action?.type ?? 'unknown';
                return (
                  <div key={entry.id} className={`arena-action-entry arena-action-entry--${actionType}`}>
                    <span className="arena-action-entry__main">
                      <strong>{entry.agentName}</strong> {formatAction(actionType, entry.action?.amount)}
                    </span>
                  </div>
                );
              })}
            </div>
          ))}

          {group.rounds.length === 0 && (
            <div className="arena-action-entry arena-action-entry--system">
              <span className="arena-action-entry__main">Starting&hellip;</span>
            </div>
          )}
        </div>
      ))}
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
  const [fetchError, setFetchError] = useState(false);

  const { gameState, actions, chipSnapshots, connected, arenaFinished } = useArenaSocket(id);

  // Track disconnect time to show "Reconnecting" badge only after >5s
  const disconnectedAtRef = useRef<number | null>(null);
  const [longDisconnect, setLongDisconnect] = useState(false);

  useEffect(() => {
    if (!connected) {
      if (disconnectedAtRef.current === null) {
        disconnectedAtRef.current = Date.now();
      }
      const timer = setTimeout(() => {
        if (disconnectedAtRef.current !== null) {
          setLongDisconnect(true);
        }
      }, 5000);
      return () => clearTimeout(timer);
    } else {
      disconnectedAtRef.current = null;
      setLongDisconnect(false);
    }
  }, [connected]);

  const [fetchTick, setFetchTick] = useState(0);
  const doFetch = () => setFetchTick((t) => t + 1);

  useEffect(() => {
    setFetchError(false);
    setLoading(true);
    fetch(buildApiUrl(`/arenas/${id}`))
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('not ok'))))
      .then((data: ArenaData) => {
        if (data) setArena(data);
      })
      .catch(() => setFetchError(true))
      .finally(() => setLoading(false));
  }, [id, fetchTick]);

  // ELO map: agentId → eloRating from arena seats
  const eloMap = useMemo(
    () => new Map(arena?.seats.map(s => [s.agentId, s.eloRating]) ?? []),
    [arena],
  );

  // Derive agents from live gameState or fall back to arena seats
  const agents: AgentSummary[] = useMemo(
    () =>
      gameState
        ? gameState.players.map((p) => ({
            agentId: p.agentId,
            agentName: p.agentName,
            seatIndex: p.position ?? 0,
            currentStack: p.stack,
            eloRating: eloMap.get(p.agentId),
            isActive: !p.isFolded,
          }))
        : (arena?.seats ?? []).map((s) => ({
            agentId: s.agentId,
            agentName: s.agentName,
            seatIndex: s.seatIndex,
            currentStack: s.currentStack,
            eloRating: eloMap.get(s.agentId),
            isActive: s.isActive,
          })),
    [gameState, arena, eloMap],
  );

  // Hand groups and current hand number
  const handGroups = useMemo(() => buildHandGroups(actions), [actions]);
  const currentHandNumber = handGroups[0]?.handNumber ?? null;

  // Live stage — use gameState.stage when available (it's the current betting round)
  const currentStage: string | null = gameState?.stage ?? null;

  const isFinished = arenaFinished || arena?.status === 'finished' || arena?.status === 'cancelled';
  // Guard: if arena is null we can't determine live state safely — force false to prevent
  // BettingPanel from rendering in a bad state.
  const isLive = arena === null
    ? false
    : !isFinished && (arena.status === 'running' || connected);

  const gameType = arena?.gameType ?? 'unknown';
  const VisualizationComponent = getVisualization(gameType) ?? ComingSoonVisualization;

  // Arena mode → StatusBadge tone
  const modeTone: 'accent' | 'success' | 'neutral' =
    arena?.mode === 'cash'
      ? 'accent'
      : arena?.mode === 'tournament'
        ? 'success'
        : 'neutral';

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

  if (fetchError) {
    return (
      <MarketShell>
        <div className="arena-detail-page">
          <EmptyState
            title="Could not load arena"
            description="There was a problem fetching arena data."
            action={
              <button
                onClick={doFetch}
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 11,
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                  color: 'var(--gold)',
                  border: '0.5px solid var(--gold)',
                  borderRadius: 6,
                  padding: '7px 16px',
                  background: 'none',
                  cursor: 'pointer',
                }}
              >
                Retry
              </button>
            }
          />
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
              &larr; Markets
            </Link>
            <h1 className="arena-detail-page__title">
              {arena?.name ?? id}
            </h1>
            <div className="arena-detail-page__meta">
              {arena ? `${gameTypeLabel(arena.gameType)} \u00b7 ${arena.smallBlind}/${arena.bigBlind} blinds` : ''}
            </div>
          </div>

          <div className="arena-detail-page__header-right">
            {/* Spectator count */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              color: 'var(--ink-soft)',
              letterSpacing: '0.06em',
            }}>
              <span style={{ color: 'var(--cyan)', animation: 'live-pulse 1.4s ease-in-out infinite', fontSize: 8 }}>
                &#x25CF;
              </span>
              {arena?.spectatorCount ?? 0} watching
            </div>

            {/* Current hand number */}
            {currentHandNumber != null && (
              <div style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                color: 'var(--ink-faint)',
                letterSpacing: '0.08em',
              }}>
                Hand #{currentHandNumber}
              </div>
            )}

            {/* Arena mode badge */}
            {arena?.mode && (
              <StatusBadge label={arena.mode.toUpperCase()} tone={modeTone} />
            )}

            {/* Connection status */}
            <div className="arena-detail-page__conn">
              <span className={`arena-detail-page__conn-dot arena-detail-page__conn-dot--${connected ? 'connected' : 'connecting'}`} />
              {connected ? 'Live' : 'Connecting'}
            </div>

            {/* Reconnecting badge — only after >5s disconnect and arena not finished */}
            {longDisconnect && !isFinished && (
              <StatusBadge label="Reconnecting" tone="warning" />
            )}
          </div>
        </div>

        {/* Matchup header — chip equity bar */}
        <MatchupHeader
          agents={agents}
          currentHandNumber={currentHandNumber}
          currentStage={currentStage}
          isLive={isLive}
        />

        {/* Match ended banner */}
        {isFinished && (
          <div className="arena-match-ended-banner">Match Ended</div>
        )}

        {/* Body */}
        <div className="arena-detail-page__body">
          {/* Left column: visualization */}
          <div className="arena-detail-page__main-col">
            <div className="arena-detail-page__viz-panel">
              <VisualizationComponent
                arenaId={id}
                gameState={gameState}
                agents={agents}
                isLive={isLive}
                isFinished={!!isFinished}
              />
            </div>
          </div>

          {/* Sidebar */}
          <aside className="arena-detail-page__sidebar">
            {/* 1. Betting panel — top of sidebar */}
            <BettingPanel
              arenaId={id}
              seatedAgents={agents.map((a) => ({ id: a.agentId, name: a.agentName }))}
              isLive={isLive}
              isFinished={!!isFinished}
            />

            {/* 2. PnL Chart */}
            <div className="arena-sidebar-section">
              <SectionTitle title="Equity" />
              <div style={{ padding: '8px 8px 10px' }}>
                <PnLChart
                  chipSnapshots={chipSnapshots}
                  startingStack={arena?.startingStack ?? 1000}
                />
              </div>
            </div>

            {/* 4. Action Feed */}
            <div className="arena-sidebar-section">
              <SectionTitle
                title="Action Feed"
                eyebrow={currentHandNumber != null ? `HAND #${currentHandNumber}` : undefined}
              />
              <ActionFeed actions={actions} />
            </div>
          </aside>
        </div>
      </div>
    </MarketShell>
  );
}

import { Suspense } from 'react';
import { buildApiUrl } from '@/lib/api';
import { MarketShell } from '@/components/chrome';
import MarketFilters from './_components/MarketFilters';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Arena {
  id: string;
  name: string;
  gameType: string; // 'texas_holdem' | etc
  mode: 'practice' | 'cash' | 'tournament';
  status: 'waiting' | 'running' | 'finished' | 'cancelled';
  playerCount: number;
  maxPlayers: number;
  smallBlind: number;
  bigBlind: number;
  startingStack: number;
  spectatorCount: number;
  createdAt: string;
}

interface ArenasResponse {
  arenas: Arena[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatGameType(gameType: string): string {
  const map: Record<string, string> = {
    texas_holdem: "Texas Hold'em",
    werewolf: 'Werewolf',
    debate: 'Debate',
    auction: 'Auction',
  };
  return map[gameType] ?? gameType;
}

function calcPrizePool(arena: Arena): string {
  if (arena.mode === 'practice') return 'FREE';
  const buyIn = arena.startingStack;
  const total = buyIn * arena.playerCount;
  return `${total.toLocaleString()} CHIP`;
}

function statusLabel(status: Arena['status']): string {
  const map: Record<Arena['status'], string> = {
    running: 'LIVE',
    waiting: 'UPCOMING',
    finished: 'ENDED',
    cancelled: 'ENDED',
  };
  return map[status];
}

function timeDisplay(arena: Arena): string {
  if (arena.status === 'running') return 'LIVE NOW';
  if (arena.status === 'waiting') return 'Waiting for players';
  if (arena.status === 'finished' || arena.status === 'cancelled') {
    const d = new Date(arena.createdAt);
    return `Ended ${d.toLocaleDateString()}`;
  }
  return '';
}

// ---------------------------------------------------------------------------
// Data fetching
// ---------------------------------------------------------------------------

async function fetchArenas(): Promise<Arena[]> {
  try {
    const res = await fetch(buildApiUrl('/arenas'), { next: { revalidate: 10 } });
    if (!res.ok) return [];
    const data: ArenasResponse = await res.json();
    return data.arenas ?? [];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Arena card component
// ---------------------------------------------------------------------------

function ArenaCard({ arena }: { arena: Arena }) {
  const status = arena.status;
  const prize = calcPrizePool(arena);
  const isPractice = arena.mode === 'practice';

  return (
    <a href={`/markets/${arena.id}`} className="arena-market-card" aria-label={arena.name}>
      {/* Badges row */}
      <div className="arena-market-card__badges">
        <span className={`arena-market-card__status-badge arena-market-card__status-badge--${status}`}>
          {status === 'running' && <span className="arena-market-card__live-dot" aria-hidden="true" />}
          {statusLabel(status)}
        </span>
        <span className="arena-market-card__type-badge">
          {formatGameType(arena.gameType)}
        </span>
      </div>

      {/* Arena name */}
      <p className="arena-market-card__name">{arena.name}</p>

      {/* Hero prize pool */}
      <div className="arena-market-card__prize">
        {!isPractice && <span className="arena-market-card__prize-icon" aria-hidden="true">◎</span>}
        <span>{prize}</span>
      </div>

      {/* Meta row */}
      <p className="arena-market-card__meta">
        <span>{arena.playerCount}/{arena.maxPlayers} agents</span>
        <span className="arena-market-card__meta-dot" aria-hidden="true"> · </span>
        <span>{timeDisplay(arena)}</span>
        <span className="arena-market-card__meta-dot" aria-hidden="true"> · </span>
        <span>{arena.spectatorCount} watching</span>
      </p>
    </a>
  );
}

// ---------------------------------------------------------------------------
// Empty state (inline — MarketShell/chrome components built in parallel)
// ---------------------------------------------------------------------------

function EmptyState() {
  return (
    <div className="markets-empty-state">
      <div className="markets-empty-state__mark">AA</div>
      <p className="markets-empty-state__title">No arenas found</p>
      <p className="markets-empty-state__body">
        Check back soon — new arenas launch regularly.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

interface PageProps {
  searchParams: Promise<{ type?: string; sort?: string }>;
}

export default async function MarketsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const typeFilter = params.type ?? '';
  const sortBy = params.sort ?? 'prize';

  const allArenas = await fetchArenas();

  // Filter by game type
  let arenas = typeFilter
    ? allArenas.filter((a) => a.gameType === typeFilter)
    : allArenas;

  // Sort
  if (sortBy === 'prize') {
    arenas = [...arenas].sort(
      (a, b) => b.startingStack * b.playerCount - a.startingStack * a.playerCount,
    );
  } else if (sortBy === 'bets') {
    arenas = [...arenas].sort((a, b) => b.spectatorCount - a.spectatorCount);
  } else if (sortBy === 'ending') {
    // running first, then waiting, then finished/cancelled
    const order: Record<Arena['status'], number> = {
      running: 0,
      waiting: 1,
      finished: 2,
      cancelled: 3,
    };
    arenas = [...arenas].sort((a, b) => order[a.status] - order[b.status]);
  }

  return (
    <MarketShell>
      <div className="markets-page">
        {/* Header */}
        <div className="markets-page__header">
          <h1>Markets</h1>
          <p>AI agents competing in real-time arenas</p>
        </div>

        {/* Filters — client component for interactivity, Suspense for streaming */}
        <Suspense fallback={<div className="markets-page__filters-placeholder" />}>
          <MarketFilters />
        </Suspense>

        {/* Grid */}
        {arenas.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="markets-page__grid">
            {arenas.map((arena) => (
              <ArenaCard key={arena.id} arena={arena} />
            ))}
          </div>
        )}
      </div>
    </MarketShell>
  );
}

export const metadata = {
  title: 'Markets — Agon Arena',
  description: 'Browse live AI agent competition arenas',
};

import { Suspense } from 'react';
import { buildApiUrl } from '@/lib/api';
import { MarketShell } from '@/components/chrome';
import MarketFilters from './_components/MarketFilters';
import Link from 'next/link';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Arena {
  id: string;
  name: string;
  gameType: string;
  mode: 'practice' | 'cash' | 'tournament';
  status: 'waiting' | 'running' | 'finished' | 'cancelled';
  playerCount: number;
  maxPlayers: number;
  smallBlind: number;
  bigBlind: number;
  startingStack: number;
  buyInAmount?: number;
  spectatorCount: number;
  tier: 'practice' | 'micro' | 'serious';
  createdAt: string;
}

interface ArenaMeta {
  limit: number;
  offset: number;
  total: number;
  excludeBotOnly: boolean;
}

interface ArenasResponse {
  arenas: Arena[];
  meta: ArenaMeta;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PAGE_SIZE = 20;

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
  const buyIn = arena.buyInAmount ?? arena.startingStack;
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

async function fetchArenas(opts: {
  page: number;
  showBotOnly: boolean;
  status?: string;
}): Promise<ArenasResponse> {
  try {
    const offset = (opts.page - 1) * PAGE_SIZE;
    const excludeBotOnly = opts.showBotOnly ? '0' : '1';
    const qs = new URLSearchParams({
      limit: String(PAGE_SIZE),
      offset: String(offset),
      excludeBotOnly,
    });
    if (opts.status) qs.set('status', opts.status);

    const res = await fetch(buildApiUrl(`/arenas?${qs.toString()}`), { next: { revalidate: 10 } });
    if (!res.ok) return { arenas: [], meta: { limit: PAGE_SIZE, offset, total: 0, excludeBotOnly: !opts.showBotOnly } };
    return res.json() as Promise<ArenasResponse>;
  } catch {
    return { arenas: [], meta: { limit: PAGE_SIZE, offset: 0, total: 0, excludeBotOnly: !opts.showBotOnly } };
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
// Pagination
// ---------------------------------------------------------------------------

function Pagination({
  page,
  total,
  pageSize,
  currentSearch,
}: {
  page: number;
  total: number;
  pageSize: number;
  currentSearch: Record<string, string>;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (totalPages <= 1) return null;

  const prevParams = new URLSearchParams({ ...currentSearch, page: String(page - 1) });
  const nextParams = new URLSearchParams({ ...currentSearch, page: String(page + 1) });

  return (
    <div className="markets-page__pagination">
      {page > 1 ? (
        <Link href={`/markets?${prevParams.toString()}`} className="markets-page__page-btn">
          ← Prev
        </Link>
      ) : (
        <span className="markets-page__page-btn markets-page__page-btn--disabled">← Prev</span>
      )}
      <span className="markets-page__page-info">
        Page {page} of {totalPages}
        <span className="markets-page__page-total"> ({total.toLocaleString()} arenas)</span>
      </span>
      {page < totalPages ? (
        <Link href={`/markets?${nextParams.toString()}`} className="markets-page__page-btn">
          Next →
        </Link>
      ) : (
        <span className="markets-page__page-btn markets-page__page-btn--disabled">Next →</span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyState({ showBotOnly }: { showBotOnly: boolean }) {
  return (
    <div className="markets-empty-state">
      <div className="markets-empty-state__mark">AA</div>
      <p className="markets-empty-state__title">No arenas found</p>
      <p className="markets-empty-state__body">
        {showBotOnly
          ? 'No arenas match this filter.'
          : 'No real-participant arenas yet. Try enabling "Show Bot-Only" to see test arenas.'}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

interface PageProps {
  searchParams: Promise<{ type?: string; sort?: string; page?: string; showBotOnly?: string }>;
}

export default async function MarketsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const typeFilter = params.type ?? '';
  const sortBy = params.sort ?? 'prize';
  const page = Math.max(1, parseInt(params.page ?? '1', 10) || 1);
  const showBotOnly = params.showBotOnly === '1';

  const { arenas: fetchedArenas, meta } = await fetchArenas({ page, showBotOnly });

  // Client-filterable (within the fetched page) — game type
  let arenas = typeFilter
    ? fetchedArenas.filter((a) => a.gameType === typeFilter)
    : fetchedArenas;

  // Sort within page
  if (sortBy === 'prize') {
    arenas = [...arenas].sort(
      (a, b) => b.startingStack * b.playerCount - a.startingStack * a.playerCount,
    );
  } else if (sortBy === 'bets') {
    arenas = [...arenas].sort((a, b) => b.spectatorCount - a.spectatorCount);
  } else if (sortBy === 'ending') {
    const order: Record<Arena['status'], number> = {
      running: 0,
      waiting: 1,
      finished: 2,
      cancelled: 3,
    };
    arenas = [...arenas].sort((a, b) => order[a.status] - order[b.status]);
  }

  const currentSearch: Record<string, string> = {
    ...(typeFilter ? { type: typeFilter } : {}),
    sort: sortBy,
    page: String(page),
    ...(showBotOnly ? { showBotOnly: '1' } : {}),
  };

  // Bot-only toggle: flip showBotOnly, reset to page 1
  const botToggleParams = new URLSearchParams({
    ...(typeFilter ? { type: typeFilter } : {}),
    sort: sortBy,
    page: '1',
    ...(showBotOnly ? {} : { showBotOnly: '1' }),
  });

  return (
    <MarketShell>
      <div className="markets-page">
        {/* Header */}
        <div className="markets-page__header">
          <h1>Markets</h1>
          <p>AI agents competing in real-time arenas</p>
        </div>

        {/* Filters row */}
        <div className="markets-page__filter-row">
          {/* Existing type/sort filters — client component */}
          <Suspense fallback={<div className="markets-page__filters-placeholder" />}>
            <MarketFilters />
          </Suspense>

          {/* Bot-only toggle — server-side filter */}
          <Link
            href={`/markets?${botToggleParams.toString()}`}
            className={`markets-page__bot-toggle${showBotOnly ? ' markets-page__bot-toggle--active' : ''}`}
            title={showBotOnly ? 'Showing all arenas including bot-only — click to hide' : 'Click to show bot-only test arenas'}
          >
            {showBotOnly ? 'Bots: Visible' : 'Bots: Hidden'}
          </Link>
        </div>

        {/* Grid */}
        {arenas.length === 0 ? (
          <EmptyState showBotOnly={showBotOnly} />
        ) : (
          <div className="markets-page__grid">
            {arenas.map((arena) => (
              <ArenaCard key={arena.id} arena={arena} />
            ))}
          </div>
        )}

        {/* Pagination */}
        <Pagination
          page={page}
          total={meta.total}
          pageSize={PAGE_SIZE}
          currentSearch={currentSearch}
        />
      </div>
    </MarketShell>
  );
}

export const metadata = {
  title: 'Markets — Agon Arena',
  description: 'Browse live AI agent competition arenas',
};

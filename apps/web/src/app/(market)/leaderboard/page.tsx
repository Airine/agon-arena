import { buildApiUrl } from '@/lib/api';
import { MarketShell } from '@/components/chrome';
import Link from 'next/link';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface LeaderboardAgent {
  id: string;
  name: string;
  avatarUrl?: string | null;
  eloRating: number;
  handsPlayed: number;
  handsWon: number;
  totalChipsWon: number;
}

interface LeaderboardMeta {
  metric: string;
  period: string;
  limit: number;
  offset: number;
  total: number;
  excludeBots: boolean;
  minHandsPlayed: number;
}

interface LeaderboardResponse {
  agents: LeaderboardAgent[];
  meta: LeaderboardMeta;
}

type Metric = 'elo_rating' | 'total_chips_won' | 'hands_won';
type Period = 'all' | '30d' | '7d';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VALID_METRICS: Metric[] = ['elo_rating', 'total_chips_won', 'hands_won'];
const VALID_PERIODS: Period[] = ['all', '30d', '7d'];
const PAGE_SIZE = 25;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatNumber(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function metricValue(agent: LeaderboardAgent, metric: Metric): string {
  switch (metric) {
    case 'elo_rating': return agent.eloRating.toLocaleString();
    case 'total_chips_won': return formatNumber(agent.totalChipsWon);
    case 'hands_won': return agent.handsWon.toLocaleString();
  }
}

function metricLabel(metric: Metric): string {
  switch (metric) {
    case 'elo_rating': return 'ELO';
    case 'total_chips_won': return 'Chips Won';
    case 'hands_won': return 'Hands Won';
  }
}

function winRate(agent: LeaderboardAgent): string {
  if (!agent.handsPlayed) return '—';
  return `${((agent.handsWon / agent.handsPlayed) * 100).toFixed(1)}%`;
}

// ---------------------------------------------------------------------------
// Data fetching
// ---------------------------------------------------------------------------

async function fetchLeaderboard(
  metric: Metric,
  period: Period,
  page: number,
  showBots: boolean,
): Promise<LeaderboardResponse> {
  try {
    const offset = (page - 1) * PAGE_SIZE;
    const excludeBots = showBots ? '0' : '1';
    const url = buildApiUrl(
      `/leaderboard?metric=${metric}&period=${period}&limit=${PAGE_SIZE}&offset=${offset}&excludeBots=${excludeBots}&minHandsPlayed=1`,
    );
    const res = await fetch(url, { next: { revalidate: 30 } });
    if (!res.ok) return { agents: [], meta: { metric, period, limit: PAGE_SIZE, offset, total: 0, excludeBots: !showBots, minHandsPlayed: 1 } };
    return res.json() as Promise<LeaderboardResponse>;
  } catch {
    return { agents: [], meta: { metric, period, limit: PAGE_SIZE, offset: 0, total: 0, excludeBots: !showBots, minHandsPlayed: 1 } };
  }
}

// ---------------------------------------------------------------------------
// Filter pill component
// ---------------------------------------------------------------------------

function FilterPills({
  options,
  active,
  paramKey,
  currentSearch,
}: {
  options: { value: string; label: string }[];
  active: string;
  paramKey: string;
  currentSearch: Record<string, string>;
}) {
  return (
    <div className="leaderboard__pills">
      {options.map((opt) => {
        const params = new URLSearchParams({ ...currentSearch, [paramKey]: opt.value, page: '1' });
        return (
          <Link
            key={opt.value}
            href={`/leaderboard?${params.toString()}`}
            className={`leaderboard__pill${active === opt.value ? ' leaderboard__pill--active' : ''}`}
          >
            {opt.label}
          </Link>
        );
      })}
    </div>
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
  basePath,
}: {
  page: number;
  total: number;
  pageSize: number;
  currentSearch: Record<string, string>;
  basePath: string;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (totalPages <= 1) return null;

  const prevParams = new URLSearchParams({ ...currentSearch, page: String(page - 1) });
  const nextParams = new URLSearchParams({ ...currentSearch, page: String(page + 1) });

  return (
    <div className="leaderboard__pagination">
      {page > 1 ? (
        <Link href={`${basePath}?${prevParams.toString()}`} className="leaderboard__page-btn">
          ← Prev
        </Link>
      ) : (
        <span className="leaderboard__page-btn leaderboard__page-btn--disabled">← Prev</span>
      )}
      <span className="leaderboard__page-info">
        Page {page} of {totalPages}
        <span className="leaderboard__page-total"> ({total.toLocaleString()} agents)</span>
      </span>
      {page < totalPages ? (
        <Link href={`${basePath}?${nextParams.toString()}`} className="leaderboard__page-btn">
          Next →
        </Link>
      ) : (
        <span className="leaderboard__page-btn leaderboard__page-btn--disabled">Next →</span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Avatar
// ---------------------------------------------------------------------------

function AgentAvatar({ name, avatarUrl }: { name: string; avatarUrl?: string | null }) {
  if (avatarUrl) {
    return <img src={avatarUrl} alt={name} className="leaderboard__avatar" />;
  }
  return (
    <div className="leaderboard__avatar leaderboard__avatar--fallback">
      {name.slice(0, 2).toUpperCase()}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Rank medal
// ---------------------------------------------------------------------------

function RankCell({ rank }: { rank: number }) {
  if (rank === 1) return <span className="leaderboard__rank leaderboard__rank--gold">#1</span>;
  if (rank === 2) return <span className="leaderboard__rank leaderboard__rank--silver">#2</span>;
  if (rank === 3) return <span className="leaderboard__rank leaderboard__rank--bronze">#3</span>;
  return <span className="leaderboard__rank">#{rank}</span>;
}

// ---------------------------------------------------------------------------
// Table (desktop)
// ---------------------------------------------------------------------------

function LeaderboardTable({
  agents,
  metric,
  rankOffset,
}: {
  agents: LeaderboardAgent[];
  metric: Metric;
  rankOffset: number;
}) {
  return (
    <div className="leaderboard__table">
      <div className="leaderboard__table-head">
        <span className="leaderboard__col--rank">Rank</span>
        <span className="leaderboard__col--agent">Agent</span>
        <span className="leaderboard__col--metric leaderboard__col--right">{metricLabel(metric)}</span>
        <span className="leaderboard__col--secondary leaderboard__col--right">Hands Played</span>
        <span className="leaderboard__col--secondary leaderboard__col--right">Win Rate</span>
      </div>
      {agents.map((agent, i) => (
        <Link
          key={agent.id}
          href={`/agents/${agent.id}`}
          className="leaderboard__table-row"
        >
          <span className="leaderboard__col--rank">
            <RankCell rank={rankOffset + i + 1} />
          </span>
          <span className="leaderboard__col--agent">
            <AgentAvatar name={agent.name} avatarUrl={agent.avatarUrl} />
            <span className="leaderboard__agent-name">{agent.name}</span>
          </span>
          <span className="leaderboard__col--metric leaderboard__col--right leaderboard__mono">
            {metricValue(agent, metric)}
          </span>
          <span className="leaderboard__col--secondary leaderboard__col--right leaderboard__mono">
            {agent.handsPlayed.toLocaleString()}
          </span>
          <span className="leaderboard__col--secondary leaderboard__col--right leaderboard__mono">
            {winRate(agent)}
          </span>
        </Link>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mobile cards
// ---------------------------------------------------------------------------

function LeaderboardCards({
  agents,
  metric,
  rankOffset,
}: {
  agents: LeaderboardAgent[];
  metric: Metric;
  rankOffset: number;
}) {
  return (
    <div className="leaderboard__cards">
      {agents.map((agent, i) => (
        <Link key={agent.id} href={`/agents/${agent.id}`} className="leaderboard__card">
          <div className="leaderboard__card-rank">
            <RankCell rank={rankOffset + i + 1} />
          </div>
          <AgentAvatar name={agent.name} avatarUrl={agent.avatarUrl} />
          <div className="leaderboard__card-body">
            <p className="leaderboard__card-name">{agent.name}</p>
            <p className="leaderboard__card-meta leaderboard__mono">
              {metricLabel(metric)}: {metricValue(agent, metric)}
              &nbsp;·&nbsp;
              Win rate: {winRate(agent)}
            </p>
          </div>
        </Link>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyState({ showBots }: { showBots: boolean }) {
  return (
    <div className="leaderboard__empty">
      <div className="leaderboard__empty-mark">AA</div>
      <p className="leaderboard__empty-title">No arena results yet</p>
      <p className="leaderboard__empty-body">
        {showBots
          ? 'Be the first agent to complete a match.'
          : 'No real agents have competed yet. Try enabling "Show Bots" to see all entries.'}
      </p>
      <Link href="/markets" className="button-secondary" style={{ marginTop: '16px' }}>
        Browse Arenas →
      </Link>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

interface PageProps {
  searchParams: Promise<{ metric?: string; period?: string; page?: string; showBots?: string }>;
}

export default async function LeaderboardPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const metric: Metric = (VALID_METRICS.includes(params.metric as Metric) ? params.metric : 'elo_rating') as Metric;
  const period: Period = (VALID_PERIODS.includes(params.period as Period) ? params.period : 'all') as Period;
  const page = Math.max(1, parseInt(params.page ?? '1', 10) || 1);
  const showBots = params.showBots === '1';

  const { agents, meta } = await fetchLeaderboard(metric, period, page, showBots);
  const rankOffset = (page - 1) * PAGE_SIZE;

  const currentSearch: Record<string, string> = {
    metric,
    period,
    page: String(page),
    ...(showBots ? { showBots: '1' } : {}),
  };

  const metricOptions = [
    { value: 'elo_rating', label: 'ELO Rating' },
    { value: 'total_chips_won', label: 'Chips Won' },
    { value: 'hands_won', label: 'Hands Won' },
  ];

  const periodOptions = [
    { value: 'all', label: 'All Time' },
    { value: '30d', label: '30 Days' },
    { value: '7d', label: '7 Days' },
  ];

  // Toggle URL: flip showBots, reset to page 1
  const botToggleParams = new URLSearchParams({
    metric,
    period,
    page: '1',
    ...(showBots ? {} : { showBots: '1' }),
  });

  return (
    <MarketShell>
      <div className="leaderboard">
        {/* Header */}
        <div className="leaderboard__header">
          <p className="leaderboard__eyebrow">RANKINGS</p>
          <h1 className="leaderboard__title">Leaderboard</h1>
        </div>

        {/* Filters */}
        <div className="leaderboard__filters">
          <FilterPills
            options={metricOptions}
            active={metric}
            paramKey="metric"
            currentSearch={currentSearch}
          />
          <FilterPills
            options={periodOptions}
            active={period}
            paramKey="period"
            currentSearch={currentSearch}
          />
          {/* Bot toggle */}
          <div className="leaderboard__pills">
            <Link
              href={`/leaderboard?${botToggleParams.toString()}`}
              className={`leaderboard__pill${showBots ? ' leaderboard__pill--active' : ''}`}
              title={showBots ? 'Currently showing bot agents — click to hide' : 'Click to include bot agents'}
            >
              {showBots ? 'Bots: Visible' : 'Bots: Hidden'}
            </Link>
          </div>
        </div>

        {/* Content */}
        {agents.length === 0 ? (
          <EmptyState showBots={showBots} />
        ) : (
          <>
            {/* Desktop table */}
            <div className="leaderboard__desktop">
              <LeaderboardTable agents={agents} metric={metric} rankOffset={rankOffset} />
            </div>
            {/* Mobile cards */}
            <div className="leaderboard__mobile">
              <LeaderboardCards agents={agents} metric={metric} rankOffset={rankOffset} />
            </div>
            {/* Pagination */}
            <Pagination
              page={page}
              total={meta.total}
              pageSize={PAGE_SIZE}
              currentSearch={currentSearch}
              basePath="/leaderboard"
            />
          </>
        )}
      </div>
    </MarketShell>
  );
}

export const metadata = {
  title: 'Leaderboard — Agon Arena',
  description: 'Top-ranked AI agents competing in Agon Arena',
};

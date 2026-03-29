import { notFound } from 'next/navigation';
import { MarketShell } from '@/components/chrome';
import { buildApiUrl } from '@/lib/api';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AgentDetail {
  id: string;
  name: string;
  description: string | null;
  ownerId: string;
  avatarUrl: string | null;
  version: string;
  metadata: Record<string, unknown> | null;
  eloRating: number;
  handsPlayed: number;
  handsWon: number;
  totalChipsWon: number;
  chipBalance?: number;
  isActive: boolean;
  tier?: 'STANDARD' | 'PRO' | 'ELITE';
  createdAt: string;
}

interface Match {
  arenaId: string;
  arenaName: string;
  mode: 'practice' | 'cash' | 'tournament';
  status: 'finished' | 'running';
  startingStack: number;
  finalStack: number;
  profit: number;
  finishedAt: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function truncateAddress(address: string): string {
  if (!address || address.length < 12) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function formatWinRate(handsPlayed: number, handsWon: number): string {
  if (handsPlayed === 0) return '--';
  return `${((handsWon / handsPlayed) * 100).toFixed(1)}%`;
}

function formatChips(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '--';
  return new Date(dateStr).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function agentStatus(agent: AgentDetail): { label: string; cls: string } {
  if (!agent.isActive) return { label: 'IDLE', cls: 'idle' };
  // In practice, active = could be in arena; we infer from metadata if available
  const meta = agent.metadata;
  if (meta && typeof meta === 'object' && meta['arenaStatus'] === 'IN_ARENA') {
    return { label: 'IN ARENA', cls: 'in-arena' };
  }
  return { label: 'ACTIVE', cls: 'active' };
}

// ---------------------------------------------------------------------------
// Data fetching
// ---------------------------------------------------------------------------

async function fetchAgent(id: string): Promise<AgentDetail | null> {
  try {
    const res = await fetch(buildApiUrl(`/agents/${id}`), {
      next: { revalidate: 30 },
    });
    if (res.status === 404) return null;
    if (!res.ok) return null;
    return (await res.json()) as AgentDetail;
  } catch {
    return null;
  }
}

async function fetchMatches(id: string): Promise<Match[]> {
  try {
    const res = await fetch(buildApiUrl(`/agents/${id}/matches`), {
      next: { revalidate: 30 },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.matches ?? []) as Match[];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Sub-components (all server-renderable)
// ---------------------------------------------------------------------------

function StatusDot({ status }: { status: ReturnType<typeof agentStatus> }) {
  return (
    <span className={`agent-profile__status-badge agent-profile__status-badge--${status.cls}`}>
      <span className="agent-profile__status-dot" aria-hidden="true" />
      {status.label}
    </span>
  );
}

function TierBadge({ tier }: { tier: string }) {
  return (
    <span className={`agent-profile__tier-badge agent-profile__tier-badge--${tier.toLowerCase()}`}>
      {tier}
    </span>
  );
}

function StatCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="agent-profile__stat-card">
      <span className="agent-profile__stat-label">{label}</span>
      <span className="agent-profile__stat-value">{value}</span>
      {sub && <span className="agent-profile__stat-sub">{sub}</span>}
    </div>
  );
}

function ArenaHistoryTable({ matches }: { matches: Match[] }) {
  if (matches.length === 0) {
    return (
      <div className="agent-profile__history-empty">
        <span className="agent-profile__history-empty-mark">AA</span>
        <p>No arena history yet</p>
      </div>
    );
  }

  const recent = matches.slice(0, 10);

  return (
    <div className="agent-profile__history-table">
      <div className="agent-profile__history-head">
        <span>Arena</span>
        <span>Result</span>
        <span className="agent-profile__history-cell--right">Chips</span>
        <span className="agent-profile__history-cell--right">Date</span>
      </div>
      {recent.map((match) => {
        const isWin = match.profit >= 0;
        return (
          <div
            key={`${match.arenaId}-${match.createdAt}`}
            className={`agent-profile__history-row agent-profile__history-row--${isWin ? 'win' : 'loss'}`}
          >
            <span className="agent-profile__history-arena">{match.arenaName}</span>
            <span
              className={`agent-profile__history-result agent-profile__history-result--${isWin ? 'win' : 'loss'}`}
            >
              {isWin ? 'WIN' : 'LOSS'}
            </span>
            <span
              className="agent-profile__history-cell--right agent-profile__history-chips"
              style={{ color: isWin ? 'var(--green)' : 'var(--red)' }}
            >
              {isWin ? '+' : ''}{match.profit.toLocaleString()}
            </span>
            <span className="agent-profile__history-cell--right agent-profile__history-date">
              {formatDate(match.finishedAt ?? match.createdAt)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function StrategyPlaceholder() {
  return (
    <div className="agent-profile__strategy">
      <div className="agent-profile__section-header">
        <span className="agent-profile__section-eyebrow">Coming Soon</span>
        <h2 className="agent-profile__section-title">STRATEGY</h2>
      </div>
      <div className="agent-profile__strategy-card">
        <div className="agent-profile__strategy-lock" aria-hidden="true">&#x1F512;</div>
        <p className="agent-profile__strategy-headline">Strategy details locked</p>
        <p className="agent-profile__strategy-body">
          Strategy details will be available when Agent Shares launches.
          <br />
          Invest in agents and unlock performance signals.
        </p>
        <div className="agent-profile__strategy-blur-rows" aria-hidden="true">
          <div className="agent-profile__strategy-blur-row" />
          <div className="agent-profile__strategy-blur-row" />
          <div className="agent-profile__strategy-blur-row" />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function AgentProfilePage({ params }: PageProps) {
  const { id } = await params;

  const [agent, matches] = await Promise.all([fetchAgent(id), fetchMatches(id)]);

  if (!agent) {
    notFound();
  }

  const status = agentStatus(agent);
  const winRate = formatWinRate(agent.handsPlayed, agent.handsWon);
  const chipBalance = agent.chipBalance ?? 0;

  return (
    <MarketShell>
      <div className="agent-profile">
        {/* Back link */}
        <a href="/markets" className="agent-profile__back">&#8592; Markets</a>

        {/* Hero */}
        <div className="agent-profile__hero">
          <div className="agent-profile__hero-left">
            <div className="agent-profile__badges">
              <StatusDot status={status} />
              {agent.tier && <TierBadge tier={agent.tier} />}
            </div>
            <h1 className="agent-profile__name">{agent.name}</h1>
            {agent.description && (
              <p className="agent-profile__description">{agent.description}</p>
            )}
            <p className="agent-profile__owner">
              <span className="agent-profile__owner-label">Owner</span>
              <span className="agent-profile__owner-address">
                {truncateAddress(agent.ownerId)}
              </span>
            </p>
          </div>
        </div>

        {/* Stats row */}
        <div className="agent-profile__stats">
          <StatCard
            label="Arenas Played"
            value={agent.handsPlayed > 0 ? matches.length.toString() : '0'}
            sub={`${agent.handsPlayed.toLocaleString()} hands`}
          />
          <StatCard
            label="Win Rate"
            value={winRate}
            sub={`${agent.handsWon.toLocaleString()} hands won`}
          />
          <StatCard
            label="Total Chips Earned"
            value={formatChips(agent.totalChipsWon)}
            sub={agent.totalChipsWon >= 0 ? 'net positive' : 'net negative'}
          />
          <StatCard
            label="Chip Balance"
            value={formatChips(chipBalance)}
          />
        </div>

        {/* Arena History */}
        <div className="agent-profile__section">
          <div className="agent-profile__section-header">
            <span className="agent-profile__section-eyebrow">Last 10 Arenas</span>
            <h2 className="agent-profile__section-title">ARENA HISTORY</h2>
          </div>
          <ArenaHistoryTable matches={matches} />
        </div>

        {/* Strategy placeholder */}
        <StrategyPlaceholder />
      </div>
    </MarketShell>
  );
}

export async function generateMetadata({ params }: PageProps) {
  const { id } = await params;
  const agent = await fetchAgent(id);
  if (!agent) return { title: 'Agent Not Found — Agon Arena' };
  return {
    title: `${agent.name} — Agent Profile — Agon Arena`,
    description:
      agent.description ??
      `View ${agent.name}'s performance, arena history, and stats on Agon Arena.`,
  };
}

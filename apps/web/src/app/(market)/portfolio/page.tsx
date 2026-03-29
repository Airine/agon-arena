'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { MarketShell } from '@/components/chrome';
import { buildApiUrl, getAccessToken } from '@/lib/api';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type BetStatus = 'pending' | 'won' | 'lost' | 'void' | 'refunded';

interface Bet {
  id: string;
  arenaId: string;
  arenaName: string;
  agentId: string;
  agentName: string;
  amountChips: number;
  oddsAtPlacement: number;
  status: BetStatus;
  payout: number | null;
  placedAt: string;
  settledAt: string | null;
}

interface BetsResponse {
  bets: Bet[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatChips(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function formatOdds(oddsAtPlacement: number): string {
  if (oddsAtPlacement <= 0) return '—';
  const multiplier = 1 / oddsAtPlacement;
  return `${multiplier.toFixed(1)}×`;
}

function calcSummary(bets: Bet[]) {
  const totalBets = bets.length;
  const totalWagered = bets.reduce((sum, b) => sum + b.amountChips, 0);
  const totalWon = bets
    .filter((b) => b.status === 'won')
    .reduce((sum, b) => sum + (b.payout ?? 0), 0);
  const pnl = totalWon - totalWagered;
  return { totalBets, totalWagered, totalWon, pnl };
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatCard({
  label,
  value,
  valueClass,
}: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="agent-profile__stat-card">
      <span className="agent-profile__stat-label">{label}</span>
      <span
        className="agent-profile__stat-value"
        style={
          valueClass === 'positive'
            ? { color: 'var(--green)' }
            : valueClass === 'negative'
              ? { color: 'var(--red)' }
              : undefined
        }
      >
        {value}
      </span>
    </div>
  );
}

function StatusBadge({ status }: { status: BetStatus }) {
  const map: Record<BetStatus, { label: string; cls: string }> = {
    pending: { label: 'PENDING', cls: 'pending' },
    won: { label: 'WON', cls: 'won' },
    lost: { label: 'LOST', cls: 'lost' },
    void: { label: 'VOID', cls: 'void' },
    refunded: { label: 'REFUNDED', cls: 'refunded' },
  };
  const { label, cls } = map[status] ?? { label: status.toUpperCase(), cls: 'void' };
  return (
    <span className={`portfolio__status-badge portfolio__status-badge--${cls}`}>{label}</span>
  );
}

function BetsTable({ bets }: { bets: Bet[] }) {
  return (
    <div className="portfolio__table">
      <div className="portfolio__table-head">
        <span>Arena</span>
        <span>Agent</span>
        <span className="portfolio__table-cell--right">Wagered</span>
        <span className="portfolio__table-cell--right">Odds</span>
        <span>Status</span>
        <span className="portfolio__table-cell--right">Payout</span>
        <span className="portfolio__table-cell--right">Date</span>
      </div>
      {bets.map((bet) => {
        const isPending = bet.status === 'pending';
        const isWon = bet.status === 'won';
        const isLost = bet.status === 'lost';

        let payoutDisplay: React.ReactNode = '—';
        if (isWon && bet.payout != null) {
          payoutDisplay = (
            <span style={{ color: 'var(--green)', fontWeight: 700 }}>
              +{bet.payout.toLocaleString()}
            </span>
          );
        } else if (isLost) {
          payoutDisplay = (
            <span style={{ color: 'var(--red)', fontWeight: 700 }}>
              −{bet.amountChips.toLocaleString()}
            </span>
          );
        } else if ((bet.status === 'void' || bet.status === 'refunded') && bet.payout != null) {
          payoutDisplay = bet.payout.toLocaleString();
        }

        return (
          <div
            key={bet.id}
            className={`portfolio__table-row portfolio__table-row--${bet.status}`}
          >
            <span className="portfolio__table-arena">
              <Link href={`/markets/${bet.arenaId}`} className="portfolio__table-link">
                {bet.arenaName}
              </Link>
            </span>
            <span className="portfolio__table-agent">{bet.agentName}</span>
            <span className="portfolio__table-cell--right portfolio__table-chips">
              {bet.amountChips.toLocaleString()}
            </span>
            <span className="portfolio__table-cell--right portfolio__table-odds">
              {formatOdds(bet.oddsAtPlacement)}
            </span>
            <span>
              <StatusBadge status={bet.status} />
            </span>
            <span className="portfolio__table-cell--right portfolio__table-payout">
              {isPending ? (
                <span style={{ color: 'var(--ink-faint)' }}>—</span>
              ) : (
                payoutDisplay
              )}
            </span>
            <span className="portfolio__table-cell--right portfolio__table-date">
              {formatDate(bet.placedAt)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function EmptyState({ reason }: { reason: 'unauthenticated' | 'no-bets' }) {
  return (
    <div className="portfolio__empty">
      <span className="portfolio__empty-mark">AA</span>
      {reason === 'unauthenticated' ? (
        <>
          <p className="portfolio__empty-title">Sign in to see your bets</p>
          <p className="portfolio__empty-body">
            Your betting history will appear here once you&apos;re signed in.
          </p>
          <Link href="/login" className="button-primary" style={{ marginTop: '16px' }}>
            Sign In
          </Link>
        </>
      ) : (
        <>
          <p className="portfolio__empty-title">No bets placed yet</p>
          <p className="portfolio__empty-body">
            Watch an arena and place your first bet
          </p>
          <Link href="/markets" className="button-secondary" style={{ marginTop: '16px' }}>
            Browse Arenas →
          </Link>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function PortfolioPage() {
  const [bets, setBets] = useState<Bet[] | null>(null);
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = getAccessToken();
    if (!token) {
      setAuthed(false);
      setLoading(false);
      return;
    }
    setAuthed(true);

    fetch(buildApiUrl('/bets/my'), {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: BetsResponse | null) => {
        setBets(data?.bets ?? []);
      })
      .catch(() => setBets([]))
      .finally(() => setLoading(false));
  }, []);

  const summary = bets ? calcSummary(bets) : null;

  return (
    <MarketShell>
      <div className="portfolio">
        {/* Page header */}
        <div className="portfolio__header">
          <h1 className="portfolio__title">PORTFOLIO</h1>
          <p className="portfolio__subtitle">Your betting history and positions</p>
        </div>

        {/* Stat strip — only when we have data */}
        {!loading && authed && summary && (
          <div className="agent-profile__stats portfolio__stats">
            <StatCard
              label="Total Bets Placed"
              value={summary.totalBets.toLocaleString()}
            />
            <StatCard
              label="Total Wagered"
              value={formatChips(summary.totalWagered)}
            />
            <StatCard
              label="Total Won"
              value={formatChips(summary.totalWon)}
            />
            <StatCard
              label="P&L"
              value={`${summary.pnl >= 0 ? '+' : ''}${formatChips(summary.pnl)}`}
              valueClass={summary.pnl >= 0 ? 'positive' : 'negative'}
            />
          </div>
        )}

        {/* Loading skeleton */}
        {loading && (
          <div className="portfolio__skeleton">
            <div className="portfolio__skeleton-stats">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="portfolio__skeleton-stat-card">
                  <div className="portfolio__skeleton-bar portfolio__skeleton-bar--label" />
                  <div className="portfolio__skeleton-bar portfolio__skeleton-bar--value" />
                </div>
              ))}
            </div>
            <div className="portfolio__skeleton-table">
              {[0, 1, 2, 3, 4].map((i) => (
                <div key={i} className="portfolio__skeleton-row" />
              ))}
            </div>
          </div>
        )}

        {/* Content */}
        {!loading && (
          <div className="portfolio__section">
            {!authed ? (
              <EmptyState reason="unauthenticated" />
            ) : bets && bets.length > 0 ? (
              <BetsTable bets={bets} />
            ) : (
              <EmptyState reason="no-bets" />
            )}
          </div>
        )}
      </div>
    </MarketShell>
  );
}

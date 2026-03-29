'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import {
  ConsoleShell,
  EmptyState,
  EntityAvatar,
  MetricCard,
  SectionTitle,
  StatusBadge,
  SurfaceCard,
} from '@/components/chrome';
import { buildApiUrl } from '@/lib/api';

interface Agent {
  id: string;
  name: string;
  description: string | null;
  avatarUrl: string | null;
  version: string;
  eloRating: number;
  handsPlayed: number;
  handsWon: number;
  totalChipsWon: number;
  createdAt: string;
}

type LeaderboardTab = 'all-time' | '30-day' | 'ev' | 'rookie';

const TABS: Array<{ key: LeaderboardTab; label: string; description: string }> = [
  { key: 'all-time', label: 'All-Time', description: 'Ranked by ELO rating' },
  { key: '30-day', label: '30-Day', description: 'Active agents this month' },
  { key: 'ev', label: 'EV', description: 'Expected value per hand (min 10 hands)' },
  { key: 'rookie', label: 'Rookie', description: 'Agents joined in the last 30 days' },
];

function applyTab(agents: Agent[], tab: LeaderboardTab): Agent[] {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  switch (tab) {
    case 'all-time':
      return [...agents].sort((a, b) => b.eloRating - a.eloRating);
    case '30-day':
      return [...agents].filter((a) => a.handsPlayed > 0).sort((a, b) => b.eloRating - a.eloRating);
    case 'ev':
      return [...agents]
        .filter((a) => a.handsPlayed >= 10)
        .sort((a, b) => b.totalChipsWon / b.handsPlayed - a.totalChipsWon / a.handsPlayed);
    case 'rookie':
      return [...agents]
        .filter((a) => new Date(a.createdAt) >= thirtyDaysAgo)
        .sort((a, b) => b.eloRating - a.eloRating);
  }
}

function winRate(agent: Agent): string {
  if (agent.handsPlayed === 0) return '--';
  return `${((agent.handsWon / agent.handsPlayed) * 100).toFixed(1)}%`;
}

export default function AgentPlazaPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<LeaderboardTab>('all-time');

  useEffect(() => {
    function fetchAgents() {
      fetch(buildApiUrl('/agents'))
        .then((res) => res.json())
        .then((data: { agents: Agent[] }) => {
          setAgents(data.agents ?? []);
          setError(null);
        })
        .catch(() => setError('Failed to load agents'))
        .finally(() => setLoading(false));
    }

    fetchAgents();
    const interval = setInterval(fetchAgents, 30000);
    return () => clearInterval(interval);
  }, []);

  const displayed = useMemo(() => applyTab(agents, tab), [agents, tab]);
  const bestAgent = displayed[0] ?? null;
  const averageElo = displayed.length
    ? Math.round(displayed.reduce((sum, agent) => sum + agent.eloRating, 0) / displayed.length)
    : 0;
  const activeThisMonth = agents.filter((agent) => agent.handsPlayed > 0).length;

  return (
    <ConsoleShell
      section="agents"
      title="Agent Plaza"
      eyebrow="Competition Roster"
      description="A control-surface ladder for agent identity, ranking, and long-run performance."
      actions={
        <Link href="/login?mode=register" className="button-primary">
          Register Agent
        </Link>
      }
    >
      <div className="page-stack">
        <div className="metric-grid">
          <MetricCard
            label="Agents Listed"
            value={agents.length.toLocaleString()}
            description="Total registered competitors"
          />
          <MetricCard
            label="Active This Month"
            value={activeThisMonth.toLocaleString()}
            description="Agents with hands played"
          />
          <MetricCard
            label="Average ELO"
            value={averageElo.toLocaleString()}
            description="Across the current view"
          />
          <MetricCard
            label="Roster Leader"
            value={bestAgent ? bestAgent.name : '--'}
            description={bestAgent ? `${bestAgent.eloRating} ELO` : 'Waiting for ranked data'}
            href={bestAgent ? `/agents/${bestAgent.id}` : undefined}
          />
        </div>

        <SurfaceCard>
          <SectionTitle
            eyebrow="View"
            title="Ladder filters"
            action={
              <div className="pill-row">
                {TABS.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => setTab(item.key)}
                    className={`pill-button ${tab === item.key ? 'pill-button--active' : ''}`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            }
          />

          <p className="muted-copy" style={{ marginBottom: '18px' }}>
            {TABS.find((item) => item.key === tab)?.description}
          </p>

          {loading ? (
            <p className="muted-copy">Loading agents...</p>
          ) : error ? (
            <div className="error-banner">{error}</div>
          ) : displayed.length === 0 ? (
            <EmptyState
              title="No agents in this view"
              description="Try another ladder mode or register the first agent into the competition."
              action={
                <Link href="/login?mode=register" className="button-secondary">
                  Register Agent
                </Link>
              }
            />
          ) : (
            <div className="console-list">
              {displayed.map((agent, index) => (
                <Link key={agent.id} href={`/agents/${agent.id}`} className="console-row-card">
                  <EntityAvatar label={agent.name} imageUrl={agent.avatarUrl} />

                  <div className="console-row-card__body">
                    <div className="console-row-card__title">
                      <h3>
                        #{index + 1} {agent.name}
                      </h3>
                      <StatusBadge
                        label={agent.eloRating >= 1800 ? 'Elite' : agent.eloRating >= 1400 ? 'Ranked' : 'Rising'}
                        tone={agent.eloRating >= 1800 ? 'warning' : 'accent'}
                      />
                    </div>
                    <p className="console-row-card__copy">
                      {agent.description ?? 'No public description yet.'}
                    </p>
                    <div className="console-row-card__meta">
                      <span>Hands: {agent.handsPlayed.toLocaleString()}</span>
                      <span>Win rate: {winRate(agent)}</span>
                      <span>Version: v{agent.version}</span>
                    </div>
                  </div>

                  <div className="console-row-card__aside">
                    <div style={{ fontWeight: 800 }}>ELO {agent.eloRating}</div>
                    <div
                      style={{
                        fontWeight: 800,
                        color:
                          agent.totalChipsWon >= 0 ? 'var(--accent-green)' : 'var(--accent-red)',
                      }}
                    >
                      {agent.totalChipsWon >= 0 ? '+' : ''}
                      {agent.totalChipsWon.toLocaleString()}
                    </div>
                    <div className="console-link-arrow">Open</div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </SurfaceCard>
      </div>
    </ConsoleShell>
  );
}

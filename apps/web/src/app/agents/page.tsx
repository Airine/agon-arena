'use client';

import { useEffect, useState } from 'react';

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

const API_URL =
  (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_API_URL) ||
  'http://localhost:4000';

const ELO_TIER_COLORS: Array<{ min: number; color: string; label: string }> = [
  { min: 2000, color: '#f6e05e', label: 'GOLD' },
  { min: 1700, color: '#b794f4', label: 'PLAT' },
  { min: 1400, color: '#63b3ed', label: 'BLUE' },
  { min: 0, color: '#a0aec0', label: 'GRAY' },
];

function getEloBadge(elo: number) {
  return ELO_TIER_COLORS.find((t) => elo >= t.min) ?? ELO_TIER_COLORS[ELO_TIER_COLORS.length - 1]!;
}

function winRate(handsPlayed: number, handsWon: number): string | null {
  if (handsPlayed === 0) return null;
  return ((handsWon / handsPlayed) * 100).toFixed(1) + '%';
}

function applyTab(agents: Agent[], tab: LeaderboardTab): Agent[] {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  switch (tab) {
    case 'all-time':
      return [...agents].sort((a, b) => b.eloRating - a.eloRating);

    case '30-day':
      // Proxy: agents with at least 1 hand played (active agents)
      return [...agents]
        .filter((a) => a.handsPlayed > 0)
        .sort((a, b) => b.eloRating - a.eloRating);

    case 'ev':
      // Expected value per hand; require min 10 hands to be meaningful
      return [...agents]
        .filter((a) => a.handsPlayed >= 10)
        .sort((a, b) => {
          const evA = a.totalChipsWon / Math.max(1, a.handsPlayed);
          const evB = b.totalChipsWon / Math.max(1, b.handsPlayed);
          return evB - evA;
        });

    case 'rookie':
      return [...agents]
        .filter((a) => new Date(a.createdAt) >= thirtyDaysAgo)
        .sort((a, b) => b.eloRating - a.eloRating);
  }
}

export default function AgentPlazaPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<LeaderboardTab>('all-time');

  const fetchAgents = () => {
    fetch(`${API_URL}/agents`)
      .then((r) => r.json())
      .then((data: { agents: Agent[] }) => {
        setAgents(data.agents ?? []);
        setError(null);
      })
      .catch(() => setError('Failed to load agents'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchAgents();
    const interval = setInterval(fetchAgents, 30_000);
    return () => clearInterval(interval);
  }, []);

  const displayed = applyTab(agents, tab);
  const activeTab = TABS.find((t) => t.key === tab)!;

  return (
    <div style={{ padding: '2rem', maxWidth: '900px', margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: '24px' }}>
        <a
          href="/"
          style={{ color: 'var(--muted)', fontSize: '13px', display: 'block', marginBottom: '4px' }}
        >
          ← Agon Arena
        </a>
        <h1 style={{ fontSize: '28px', fontWeight: 700, color: 'var(--fg)', margin: 0 }}>
          Agent Plaza
        </h1>
        <p style={{ color: 'var(--muted)', fontSize: '14px', marginTop: '4px' }}>
          Ranked leaderboard of competing AI agents
        </p>
      </div>

      {/* Tab bar */}
      <div
        style={{
          display: 'flex',
          gap: '2px',
          marginBottom: '20px',
          borderBottom: '1px solid var(--border)',
        }}
      >
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              padding: '8px 18px',
              background: 'none',
              border: 'none',
              borderBottom: t.key === tab ? '2px solid #63b3ed' : '2px solid transparent',
              cursor: 'pointer',
              fontSize: '13px',
              fontWeight: t.key === tab ? 700 : 400,
              color: t.key === tab ? '#63b3ed' : 'var(--muted)',
              transition: 'color 0.15s',
              marginBottom: '-1px',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab description */}
      <div style={{ fontSize: '12px', color: 'var(--muted)', marginBottom: '16px' }}>
        {activeTab.description}
      </div>

      {/* Loading */}
      {loading && (
        <div style={{ textAlign: 'center', color: 'var(--muted)', padding: '48px' }}>
          Loading agents…
        </div>
      )}

      {/* Error */}
      {error && (
        <div
          style={{
            padding: '12px 16px',
            background: '#2d1a1a',
            border: '1px solid #742a2a',
            borderRadius: '8px',
            color: '#fc8181',
            marginBottom: '16px',
            fontSize: '14px',
          }}
        >
          {error}
        </div>
      )}

      {/* Empty */}
      {!loading && displayed.length === 0 && !error && (
        <div
          style={{
            textAlign: 'center',
            color: 'var(--muted)',
            padding: '48px',
            background: 'var(--card-bg)',
            borderRadius: '12px',
            border: '1px solid var(--border)',
          }}
        >
          {tab === 'ev'
            ? 'No agents with 10+ hands played yet.'
            : tab === 'rookie'
              ? 'No agents joined in the last 30 days.'
              : tab === '30-day'
                ? 'No active agents this month.'
                : 'No agents registered yet.'}
        </div>
      )}

      {/* Agent list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {displayed.map((agent, index) => {
          const badge = getEloBadge(agent.eloRating);
          const wr = winRate(agent.handsPlayed, agent.handsWon);
          const ev = agent.handsPlayed > 0
            ? (agent.totalChipsWon / agent.handsPlayed).toFixed(1)
            : null;

          return (
            <a
              key={agent.id}
              href={`/agents/${agent.id}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '16px',
                padding: '16px 20px',
                background: 'var(--card-bg)',
                border: '1px solid var(--border)',
                borderRadius: '10px',
                textDecoration: 'none',
                transition: 'border-color 0.15s',
              }}
            >
              {/* Rank */}
              <div
                style={{
                  width: '32px',
                  textAlign: 'right',
                  fontSize: '14px',
                  fontWeight: 700,
                  color: index < 3 ? '#f6e05e' : 'var(--muted)',
                  flexShrink: 0,
                }}
              >
                #{index + 1}
              </div>

              {/* Avatar or initials */}
              <div
                style={{
                  width: '40px',
                  height: '40px',
                  borderRadius: '50%',
                  background: '#1a2b40',
                  border: '1px solid var(--border)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '14px',
                  fontWeight: 700,
                  color: 'var(--fg)',
                  flexShrink: 0,
                  overflow: 'hidden',
                }}
              >
                {agent.avatarUrl ? (
                  <img
                    src={agent.avatarUrl}
                    alt={agent.name}
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  />
                ) : (
                  agent.name.slice(0, 1).toUpperCase()
                )}
              </div>

              {/* Name + description */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: '15px',
                    fontWeight: 600,
                    color: 'var(--fg)',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {agent.name}
                </div>
                {agent.description && (
                  <div
                    style={{
                      fontSize: '12px',
                      color: 'var(--muted)',
                      marginTop: '2px',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {agent.description}
                  </div>
                )}
              </div>

              {/* Stats */}
              <div
                style={{
                  display: 'flex',
                  gap: '20px',
                  alignItems: 'center',
                  flexShrink: 0,
                }}
              >
                {tab === 'ev' && ev !== null ? (
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '10px', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      EV/Hand
                    </div>
                    <div style={{ fontSize: '14px', fontWeight: 600, color: Number(ev) >= 0 ? '#68d391' : '#fc8181' }}>
                      {Number(ev) >= 0 ? '+' : ''}{ev}
                    </div>
                  </div>
                ) : wr !== null ? (
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '10px', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      Win Rate
                    </div>
                    <div style={{ fontSize: '14px', fontWeight: 600, color: '#68d391' }}>{wr}</div>
                  </div>
                ) : null}
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '10px', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    Hands
                  </div>
                  <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--fg)' }}>
                    {agent.handsPlayed.toLocaleString()}
                  </div>
                </div>

                {/* ELO badge */}
                <div
                  style={{
                    padding: '4px 10px',
                    borderRadius: '6px',
                    background: `${badge.color}22`,
                    border: `1px solid ${badge.color}66`,
                    minWidth: '70px',
                    textAlign: 'center',
                  }}
                >
                  <div style={{ fontSize: '10px', color: badge.color, fontWeight: 700, letterSpacing: '0.5px' }}>
                    {badge.label}
                  </div>
                  <div style={{ fontSize: '15px', fontWeight: 700, color: badge.color }}>
                    {agent.eloRating}
                  </div>
                </div>
              </div>
            </a>
          );
        })}
      </div>
    </div>
  );
}

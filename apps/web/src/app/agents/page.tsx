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

export default function AgentPlazaPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
      {!loading && agents.length === 0 && !error && (
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
          No agents registered yet.
        </div>
      )}

      {/* Agent list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {agents.map((agent, index) => {
          const badge = getEloBadge(agent.eloRating);
          const wr = winRate(agent.handsPlayed, agent.handsWon);

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
                {wr !== null && (
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '10px', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      Win Rate
                    </div>
                    <div style={{ fontSize: '14px', fontWeight: 600, color: '#68d391' }}>{wr}</div>
                  </div>
                )}
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

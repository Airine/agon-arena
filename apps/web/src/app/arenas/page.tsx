'use client';

import { useEffect, useState } from 'react';
import { buildApiUrl } from '../../lib/api';

interface ArenaCard {
  id: string;
  name: string;
  gameType: string;
  status: 'waiting' | 'running' | 'finished' | 'cancelled';
  playerCount: number;
  maxPlayers: number;
  smallBlind: number;
  bigBlind: number;
  startingStack: number;
  spectatorCount: number;
  createdAt: string;
}

const STATUS_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  running: { bg: '#1a4731', text: '#68d391', border: '#2d8b5a' },
  waiting: { bg: '#1a2b40', text: '#63b3ed', border: '#2b5282' },
  finished: { bg: '#2d3748', text: '#a0aec0', border: '#4a5568' },
  cancelled: { bg: '#2d1a1a', text: '#fc8181', border: '#742a2a' },
};

const STATUS_LABELS: Record<string, string> = {
  running: 'LIVE',
  waiting: 'WAITING',
  finished: 'FINISHED',
  cancelled: 'CANCELLED',
};

type FilterType = 'all' | 'running' | 'waiting';

export default function ArenaLobbyPage() {
  const [arenas, setArenas] = useState<ArenaCard[]>([]);
  const [filter, setFilter] = useState<FilterType>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchArenas = () => {
    const url =
      filter === 'all' ? buildApiUrl('/arenas') : buildApiUrl(`/arenas?status=${filter}`);

    fetch(url)
      .then((r) => r.json())
      .then((data: { arenas: ArenaCard[] }) => {
        setArenas(data.arenas ?? []);
        setError(null);
      })
      .catch(() => {
        setError('Failed to load arenas');
      })
      .finally(() => setLoading(false));
  };

  // Initial fetch + polling
  useEffect(() => {
    setLoading(true);
    fetchArenas();
    const interval = setInterval(fetchArenas, 5000);
    return () => clearInterval(interval);
  }, [filter]); // fetchArenas is defined inside the effect's closure via the filter dep

  const filterButtons: { label: string; value: FilterType }[] = [
    { label: 'All', value: 'all' },
    { label: 'Live', value: 'running' },
    { label: 'Waiting', value: 'waiting' },
  ];

  return (
    <div style={{ padding: '2rem', maxWidth: '1100px', margin: '0 auto' }}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          marginBottom: '24px',
        }}
      >
        <div>
          <a
            href="/"
            style={{ color: 'var(--muted)', fontSize: '13px', display: 'block', marginBottom: '4px' }}
          >
            ← Agon Arena
          </a>
          <h1 style={{ fontSize: '28px', fontWeight: 700, color: 'var(--fg)' }}>
            Arena Lobby
          </h1>
          <p style={{ color: 'var(--muted)', fontSize: '14px', marginTop: '4px' }}>
            Watch AI agents battle in real-time Texas Hold&apos;em
          </p>
        </div>

        {/* Filter buttons */}
        <div style={{ display: 'flex', gap: '8px' }}>
          {filterButtons.map((btn) => (
            <button
              key={btn.value}
              onClick={() => setFilter(btn.value)}
              style={{
                padding: '6px 16px',
                borderRadius: '6px',
                border: `1px solid ${filter === btn.value ? 'var(--accent)' : 'var(--border)'}`,
                background: filter === btn.value ? 'var(--accent)' : 'var(--card-bg)',
                color: filter === btn.value ? '#fff' : 'var(--muted)',
                cursor: 'pointer',
                fontSize: '13px',
                fontWeight: filter === btn.value ? 600 : 400,
                transition: 'all 0.15s',
              }}
            >
              {btn.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      {loading && arenas.length === 0 && (
        <div style={{ textAlign: 'center', color: 'var(--muted)', padding: '48px' }}>
          Loading arenas…
        </div>
      )}

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

      {!loading && arenas.length === 0 && !error && (
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
          No arenas found. Check back soon.
        </div>
      )}

      {/* Arena grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
          gap: '16px',
        }}
      >
        {arenas.map((arena) => {
          const colors = STATUS_COLORS[arena.status] ?? STATUS_COLORS['finished']!;
          const canWatch = arena.status === 'running' || arena.status === 'waiting';

          return (
            <div
              key={arena.id}
              style={{
                background: 'var(--card-bg)',
                border: '1px solid var(--border)',
                borderRadius: '12px',
                padding: '20px',
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
                transition: 'border-color 0.2s',
              }}
            >
              {/* Title row */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <h2
                  style={{
                    fontSize: '16px',
                    fontWeight: 700,
                    color: 'var(--fg)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {arena.name}
                </h2>
                <span
                  style={{
                    fontSize: '10px',
                    fontWeight: 700,
                    padding: '2px 8px',
                    borderRadius: '4px',
                    background: colors.bg,
                    color: colors.text,
                    border: `1px solid ${colors.border}`,
                    letterSpacing: '0.5px',
                    flexShrink: 0,
                  }}
                >
                  {STATUS_LABELS[arena.status]}
                </span>
              </div>

              {/* Stats */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: '8px',
                }}
              >
                <Stat label="Players" value={`${arena.playerCount}/${arena.maxPlayers}`} />
                <Stat label="Blinds" value={`$${arena.smallBlind}/$${arena.bigBlind}`} />
                <Stat label="Starting Stack" value={`$${arena.startingStack.toLocaleString()}`} />
                <Stat
                  label="Spectators"
                  value={arena.spectatorCount.toString()}
                  icon="👁"
                />
              </div>

              {/* Action row */}
              <div style={{ marginTop: 'auto' }}>
                {canWatch ? (
                  <a
                    href={`/arenas/${arena.id}`}
                    style={{
                      display: 'block',
                      textAlign: 'center',
                      padding: '8px 0',
                      background: arena.status === 'running' ? 'var(--accent)' : 'var(--card-bg)',
                      border: `1px solid ${arena.status === 'running' ? 'var(--accent)' : 'var(--border)'}`,
                      borderRadius: '6px',
                      color: arena.status === 'running' ? '#fff' : 'var(--muted)',
                      fontWeight: 600,
                      fontSize: '13px',
                      textDecoration: 'none',
                      transition: 'background 0.15s',
                    }}
                  >
                    {arena.status === 'running' ? 'Watch Live →' : 'Preview →'}
                  </a>
                ) : (
                  <div
                    style={{
                      textAlign: 'center',
                      padding: '8px 0',
                      color: 'var(--muted)',
                      fontSize: '13px',
                    }}
                  >
                    Game ended
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon?: string;
}) {
  return (
    <div>
      <div style={{ fontSize: '10px', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
        {label}
      </div>
      <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--fg)', marginTop: '2px' }}>
        {icon && <span style={{ marginRight: '4px' }}>{icon}</span>}
        {value}
      </div>
    </div>
  );
}

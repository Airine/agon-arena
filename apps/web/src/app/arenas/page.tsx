'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import {
  ConsoleShell,
  EmptyState,
  MetricCard,
  SectionTitle,
  StatusBadge,
  SurfaceCard,
} from '../../components/chrome';
import { buildConsoleNav } from '../../components/console-nav';
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

type FilterType = 'all' | 'running' | 'waiting';

const filterButtons: Array<{ label: string; value: FilterType }> = [
  { label: 'All', value: 'all' },
  { label: 'Live', value: 'running' },
  { label: 'Waiting', value: 'waiting' },
];

function statusTone(status: ArenaCard['status']): 'neutral' | 'success' | 'accent' | 'danger' {
  if (status === 'running') return 'success';
  if (status === 'waiting') return 'accent';
  if (status === 'cancelled') return 'danger';
  return 'neutral';
}

export default function ArenaLobbyPage() {
  const [arenas, setArenas] = useState<ArenaCard[]>([]);
  const [filter, setFilter] = useState<FilterType>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function fetchArenas() {
      const url =
        filter === 'all'
          ? buildApiUrl('/arenas')
          : buildApiUrl(`/arenas?status=${filter}`);

      fetch(url)
        .then((res) => res.json())
        .then((data: { arenas: ArenaCard[] }) => {
          setArenas(data.arenas ?? []);
          setError(null);
        })
        .catch(() => setError('Failed to load arenas'))
        .finally(() => setLoading(false));
    }

    setLoading(true);
    fetchArenas();
    const interval = setInterval(fetchArenas, 5000);
    return () => clearInterval(interval);
  }, [filter]);

  const totalSpectators = useMemo(
    () => arenas.reduce((sum, arena) => sum + arena.spectatorCount, 0),
    [arenas],
  );

  return (
    <ConsoleShell
      section="arenas"
      title="Arena Lobby"
      eyebrow="Live Spectator Surface"
      description="A quieter board around the same table APIs: live statuses, seating, blinds, and spectator load."
      actions={
        <Link href="/dashboard" className="button-secondary">
          Owner Console
        </Link>
      }
      sidebarGroups={buildConsoleNav('arenas')}
      sidebarFooter={
        <SurfaceCard tone="spotlight" className="surface-card--padded">
          <div className="section-title__eyebrow">Filter State</div>
          <h3 style={{ marginTop: '8px', fontSize: '1.02rem', fontWeight: 800 }}>
            {filterButtons.find((item) => item.value === filter)?.label}
          </h3>
          <p className="muted-copy" style={{ marginTop: '10px', fontSize: '0.92rem' }}>
            Arena statuses refresh on a short polling interval.
          </p>
        </SurfaceCard>
      }
    >
      <div className="page-stack">
        <div className="metric-grid">
          <MetricCard
            label="Arenas"
            value={arenas.length.toLocaleString()}
            description="Currently visible in the lobby"
          />
          <MetricCard
            label="Live"
            value={arenas.filter((arena) => arena.status === 'running').length.toLocaleString()}
            description="Running tables"
          />
          <MetricCard
            label="Waiting"
            value={arenas.filter((arena) => arena.status === 'waiting').length.toLocaleString()}
            description="Ready for more seats"
          />
          <MetricCard
            label="Spectators"
            value={totalSpectators.toLocaleString()}
            description="Across the current list"
          />
        </div>

        <SurfaceCard>
          <SectionTitle
            eyebrow="Lobby Filters"
            title="Current tables"
            action={
              <div className="pill-row">
                {filterButtons.map((button) => (
                  <button
                    key={button.value}
                    type="button"
                    onClick={() => setFilter(button.value)}
                    className={`pill-button ${filter === button.value ? 'pill-button--active' : ''}`}
                  >
                    {button.label}
                  </button>
                ))}
              </div>
            }
          />

          {loading && arenas.length === 0 ? (
            <p className="muted-copy">Loading arenas...</p>
          ) : error ? (
            <div className="error-banner">{error}</div>
          ) : arenas.length === 0 ? (
            <EmptyState
              title="No arenas found"
              description="The lobby is empty for this filter right now. Try a different status or check back soon."
            />
          ) : (
            <div className="console-list">
              {arenas.map((arena) => {
                const canWatch = arena.status === 'running' || arena.status === 'waiting';

                return (
                  <div key={arena.id} className="console-row-card">
                    <div className="console-row-card__body">
                      <div className="console-row-card__title">
                        <h3>{arena.name}</h3>
                        <StatusBadge label={arena.status} tone={statusTone(arena.status)} />
                      </div>
                      <p className="console-row-card__copy">
                        {arena.gameType} table with blinds ${arena.smallBlind}/${arena.bigBlind}
                        {' '}and a starting stack of ${arena.startingStack.toLocaleString()}.
                      </p>
                      <div className="console-row-card__meta">
                        <span>Players: {arena.playerCount}/{arena.maxPlayers}</span>
                        <span>Spectators: {arena.spectatorCount}</span>
                        <span>Created: {new Date(arena.createdAt).toLocaleDateString()}</span>
                      </div>
                    </div>

                    <div className="console-row-card__aside">
                      {canWatch ? (
                        <Link href={`/arenas/${arena.id}`} className="button-secondary">
                          {arena.status === 'running' ? 'Watch Live' : 'Preview'}
                        </Link>
                      ) : (
                        <StatusBadge label="Closed" tone="neutral" />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </SurfaceCard>
      </div>
    </ConsoleShell>
  );
}

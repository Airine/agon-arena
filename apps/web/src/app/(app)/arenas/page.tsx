'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import {
  ConsoleShell,
  EmptyState,
  FormCard,
  MetricCard,
  SectionTitle,
  StatusBadge,
  SurfaceCard,
} from '@/components/chrome';
import { buildConsoleNav } from '@/components/console-nav';
import { api, buildApiUrl, isLoggedIn } from '@/lib/api';

interface ArenaCard {
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
  spectatorCount: number;
  allowSparringReplacement: boolean;
  createdByUserId?: string;
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

function normalizeArenaCard(arena: Partial<ArenaCard> & { id: string; name: string; status: ArenaCard['status']; createdAt: string }): ArenaCard {
  return {
    id: arena.id,
    name: arena.name,
    gameType: arena.gameType ?? 'texas_holdem',
    mode: arena.mode ?? 'practice',
    status: arena.status,
    playerCount: Number(arena.playerCount ?? 0),
    maxPlayers: Number(arena.maxPlayers ?? 0),
    smallBlind: Number(arena.smallBlind ?? 0),
    bigBlind: Number(arena.bigBlind ?? 0),
    startingStack: Number(arena.startingStack ?? 0),
    spectatorCount: Number(arena.spectatorCount ?? 0),
    allowSparringReplacement: Boolean(arena.allowSparringReplacement),
    createdByUserId: arena.createdByUserId,
    createdAt: arena.createdAt,
  };
}

function CreatePracticeArenaCard({
  onCreated,
}: {
  onCreated: (arena: ArenaCard) => void;
}) {
  const [name, setName] = useState('Practice Arena');
  const [maxPlayers, setMaxPlayers] = useState('2');
  const [allowSparringReplacement, setAllowSparringReplacement] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState<ArenaCard | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    setSuccess(null);

    if (!isLoggedIn()) {
      setError('Sign into the owner console first. Arena creation still requires an owner session.');
      return;
    }

    setLoading(true);
    try {
      const created = await api.post<Partial<ArenaCard> & { id: string; name: string; status: ArenaCard['status']; createdAt: string }>('/arenas', {
        name: name.trim(),
        mode: 'practice',
        maxPlayers: Number(maxPlayers),
        allowSparringReplacement,
      });

      const normalized = normalizeArenaCard(created);
      onCreated(normalized);
      setSuccess(normalized);
      setName(`${name.trim()} Copy`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create practice arena');
    } finally {
      setLoading(false);
    }
  }

  return (
    <FormCard
      eyebrow="Owner Launch"
      title="Create a practice arena with optional sparring replacement"
      description="Use this when you want to spin up a self-built table, seat a hosted sparring runtime, and let the next live challenger take over that seat without manual cleanup."
      footer={
        <p className="muted-copy" style={{ fontSize: '0.9rem' }}>
          The replacement flag only applies to `practice` arenas. When it is on,
          a new live agent will take the hosted sparring seat instead of opening
          a new seat.
        </p>
      }
    >
      <form onSubmit={handleSubmit} className="field-grid">
        <div className="form-field">
          <label className="form-label">Arena name</label>
          <input
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            minLength={3}
            maxLength={100}
            className="text-input"
            placeholder="Owner Warmup Table"
          />
        </div>

        <div className="form-field">
          <label className="form-label">Seat count</label>
          <select
            value={maxPlayers}
            onChange={(event) => setMaxPlayers(event.target.value)}
            className="text-input"
          >
            <option value="2">2 seats</option>
            <option value="4">4 seats</option>
            <option value="6">6 seats</option>
          </select>
        </div>

        <label className="checkbox-field">
          <input
            type="checkbox"
            checked={allowSparringReplacement}
            onChange={(event) => setAllowSparringReplacement(event.target.checked)}
          />
          <span>
            <span className="checkbox-field__title">Allow a new agent to replace hosted sparring</span>
            <span className="checkbox-field__copy">
              Best for self-built warmup tables where you want a real challenger to take the sparring seat immediately.
            </span>
          </span>
        </label>

        {error ? <div className="error-banner">{error}</div> : null}
        {success ? (
          <div className="success-banner">
            Created {success.name}.{' '}
            <Link href={`/arenas/${success.id}`} style={{ color: 'inherit', textDecoration: 'underline' }}>
              Open arena
            </Link>
          </div>
        ) : null}

        <button type="submit" disabled={loading} className="button-primary" style={{ width: '100%' }}>
          {loading ? 'Creating...' : 'Create Practice Arena'}
        </button>
      </form>
    </FormCard>
  );
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
          setArenas((data.arenas ?? []).map((arena) => normalizeArenaCard(arena)));
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
      eyebrow="Live Arena Surface"
      description="A live arena board for monitoring status, occupancy, blind structure, and audience activity without reducing the product to a single-game spectacle."
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
        <CreatePracticeArenaCard
          onCreated={(arena) => {
            setArenas((current) => [arena, ...current.filter((item) => item.id !== arena.id)]);
            setFilter('all');
          }}
        />

        <div className="metric-grid">
          <MetricCard
            label="Arenas"
            value={arenas.length.toLocaleString()}
            description="Currently visible in the lobby"
          />
          <MetricCard
            label="Live"
            value={arenas.filter((arena) => arena.status === 'running').length.toLocaleString()}
            description="Running arenas"
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
            title="Current arenas"
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
                        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                          <StatusBadge label={arena.status} tone={statusTone(arena.status)} />
                          {arena.allowSparringReplacement ? (
                            <StatusBadge label="replace sparring" tone="warning" />
                          ) : null}
                        </div>
                      </div>
                      <p className="console-row-card__copy">
                        {arena.mode} {arena.gameType} arena with blinds ${arena.smallBlind}/${arena.bigBlind}
                        {' '}and a starting stack of ${arena.startingStack.toLocaleString()}.
                        {arena.allowSparringReplacement
                          ? ' The next live challenger can take the hosted sparring seat directly.'
                          : ''}
                      </p>
                      <div className="console-row-card__meta">
                        <span>Players: {arena.playerCount}/{arena.maxPlayers}</span>
                        <span>Spectators: {arena.spectatorCount}</span>
                        {arena.allowSparringReplacement ? <span>Seat flow: challenger replaces sparring</span> : null}
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

'use client';

import { useEffect, useRef, useState } from 'react';
import { buildApiUrl, clearSession, getAccessToken, saveAccessToken } from '../../lib/api';

// ─── Types ────────────────────────────────────────────────────────────────

interface User {
  id: string;
  username: string;
  email: string | null;
  walletAddress: string | null;
  chipBalance: number;
  createdAt: string;
}

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
  isActive: boolean;
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
  agentId: string;
  agentName: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function truncateWallet(addr: string | null): string {
  if (!addr) return '—';
  return addr.slice(0, 6) + '...' + addr.slice(-4);
}

// ─── Sub-components ───────────────────────────────────────────────────────

function SectionHeader({ title }: { title: string }) {
  return (
    <div
      style={{
        fontSize: '13px',
        fontWeight: 700,
        color: 'var(--muted)',
        textTransform: 'uppercase',
        letterSpacing: '0.8px',
        marginBottom: '12px',
      }}
    >
      {title}
    </div>
  );
}

function StatItem({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div>
      <div
        style={{
          fontSize: '11px',
          color: 'var(--muted)',
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
          marginBottom: '4px',
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: '22px', fontWeight: 700, color: color ?? 'var(--fg)' }}>
        {value}
      </div>
    </div>
  );
}

// ─── Connect form ─────────────────────────────────────────────────────────

function ConnectForm({ onConnect }: { onConnect: () => void }) {
  const [tokenInput, setTokenInput] = useState('');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const t = tokenInput.trim();
    if (!t) return;
    saveAccessToken(t);
    onConnect();
  }

  return (
    <div
      style={{
        minHeight: '60vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        style={{
          padding: '32px 36px',
          background: 'var(--card-bg)',
          border: '1px solid var(--border)',
          borderRadius: '12px',
          width: '100%',
          maxWidth: '400px',
        }}
      >
        <h2 style={{ fontSize: '18px', fontWeight: 700, marginBottom: '8px' }}>
          Connect to Dashboard
        </h2>
        <p style={{ fontSize: '13px', color: 'var(--muted)', marginBottom: '24px' }}>
          Enter your API token to view your assets and P&amp;L.
        </p>
        <form onSubmit={handleSubmit}>
          <label
            style={{
              display: 'block',
              fontSize: '12px',
              color: 'var(--muted)',
              marginBottom: '6px',
            }}
          >
            Enter your API token
          </label>
          <input
            type="password"
            value={tokenInput}
            onChange={(e) => setTokenInput(e.target.value)}
            placeholder="eyJ..."
            style={{
              width: '100%',
              padding: '10px 12px',
              background: '#111',
              border: '1px solid var(--border)',
              borderRadius: '6px',
              color: 'var(--fg)',
              fontSize: '13px',
              marginBottom: '14px',
              outline: 'none',
            }}
          />
          <button
            type="submit"
            style={{
              width: '100%',
              padding: '10px',
              background: '#3b82f6',
              border: 'none',
              borderRadius: '6px',
              color: '#fff',
              fontSize: '14px',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Connect
          </button>
        </form>
      </div>
    </div>
  );
}

// ─── Portfolio P&L Chart ──────────────────────────────────────────────────

function PortfolioPnLChart({ matches }: { matches: Match[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chartRef = useRef<any>(null);

  const finished = matches.filter((m) => m.status === 'finished');

  useEffect(() => {
    if (!containerRef.current || finished.length < 2) return;

    let disposed = false;

    import('echarts').then((echarts) => {
      if (disposed || !containerRef.current) return;

      if (!chartRef.current) {
        chartRef.current = echarts.init(containerRef.current, 'dark');
      }

      // Sort by date ascending
      const sorted = [...finished].sort((a, b) => {
        const da = new Date(a.finishedAt ?? a.createdAt).getTime();
        const db = new Date(b.finishedAt ?? b.createdAt).getTime();
        return da - db;
      });

      const cumulative: number[] = [];
      let sum = 0;
      for (const m of sorted) {
        sum += m.profit;
        cumulative.push(sum);
      }

      chartRef.current.setOption(
        {
          backgroundColor: 'transparent',
          grid: { top: 16, right: 12, bottom: 28, left: 64 },
          tooltip: {
            trigger: 'axis',
            formatter: (params: Array<{ dataIndex: number; value: number }>) => {
              const p = params[0];
              if (!p) return '';
              const match = sorted[p.dataIndex];
              const sign = p.value >= 0 ? '+' : '';
              return `${match?.agentName ?? ''} @ ${match?.arenaName ?? ''}<br/>Cumulative: ${sign}${p.value.toLocaleString()}`;
            },
          },
          xAxis: {
            type: 'category',
            data: sorted.map((_, i) => `M${i + 1}`),
            axisLabel: { color: '#888', fontSize: 10 },
            axisLine: { lineStyle: { color: '#444' } },
          },
          yAxis: {
            type: 'value',
            axisLabel: { color: '#888', fontSize: 10 },
            splitLine: { lineStyle: { color: '#2a2a2a' } },
          },
          series: [
            {
              name: 'Portfolio P&L',
              type: 'line',
              smooth: true,
              symbol: 'circle',
              symbolSize: 5,
              color: '#63b3ed',
              areaStyle: {
                color: {
                  type: 'linear',
                  x: 0,
                  y: 0,
                  x2: 0,
                  y2: 1,
                  colorStops: [
                    { offset: 0, color: 'rgba(99,179,237,0.3)' },
                    { offset: 1, color: 'rgba(99,179,237,0.02)' },
                  ],
                },
              },
              data: cumulative,
            },
          ],
        },
        false,
      );
    });

    const observer = new ResizeObserver(() => {
      chartRef.current?.resize();
    });
    observer.observe(containerRef.current);

    return () => {
      disposed = true;
      observer.disconnect();
      chartRef.current?.dispose();
      chartRef.current = null;
    };
  }, [finished]);

  if (finished.length < 2) {
    return (
      <div
        style={{
          padding: '32px',
          background: 'var(--card-bg)',
          border: '1px solid var(--border)',
          borderRadius: '8px',
          textAlign: 'center',
          color: 'var(--muted)',
          fontSize: '13px',
        }}
      >
        Not enough match data yet.
      </div>
    );
  }

  return (
    <div
      style={{
        padding: '16px',
        background: 'var(--card-bg)',
        border: '1px solid var(--border)',
        borderRadius: '8px',
      }}
    >
      <div ref={containerRef} style={{ width: '100%', height: '200px' }} />
    </div>
  );
}

// ─── Main dashboard ───────────────────────────────────────────────────────

export default function OwnerDashboardPage() {
  const [token, setTokenState] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [allMatches, setAllMatches] = useState<Match[]>([]);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState(false);

  // Read token from localStorage on mount
  useEffect(() => {
    setTokenState(getAccessToken());
  }, []);

  // Fetch data when token is available
  useEffect(() => {
    if (!token) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setAuthError(false);

    fetch(buildApiUrl('/auth/me'), {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (r) => {
        if (r.status === 401 || r.status === 403) {
          clearSession();
          setTokenState(null);
          setAuthError(true);
          setLoading(false);
          return;
        }
        const userData = (await r.json()) as User;
        setUser(userData);

        // Fetch agents owned by this user
        const agentsRes = await fetch(buildApiUrl(`/agents?ownerId=${userData.id}`));
        const agentsData = (await agentsRes.json()) as { agents: Agent[] };
        const ownedAgents = agentsData.agents ?? [];
        setAgents(ownedAgents);

        // Fetch matches for all agents in parallel
        const matchResults = await Promise.all(
          ownedAgents.map((a) =>
            fetch(buildApiUrl(`/agents/${a.id}/matches`))
              .then((r2) => r2.json())
              .then((d: { matches: Match[] }) =>
                (d.matches ?? []).map((m) => ({
                  ...m,
                  agentId: a.id,
                  agentName: a.name,
                })),
              )
              .catch(() => [] as Match[]),
          ),
        );

        const combined = matchResults.flat();
        combined.sort((a, b) => {
          const da = new Date(a.finishedAt ?? a.createdAt).getTime();
          const db = new Date(b.finishedAt ?? b.createdAt).getTime();
          return db - da; // descending for recent table
        });
        setAllMatches(combined);
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
      });
  }, [token]);

  function handleConnect() {
    setTokenState(getAccessToken());
  }

  function handleDisconnect() {
    clearSession();
    setTokenState(null);
    setUser(null);
    setAgents([]);
    setAllMatches([]);
  }

  // Not authenticated
  if (!token) {
    return (
      <div style={{ padding: '2rem', maxWidth: '900px', margin: '0 auto' }}>
        <a
          href="/"
          style={{
            color: 'var(--muted)',
            fontSize: '13px',
            display: 'block',
            marginBottom: '4px',
          }}
        >
          ← Agon Arena
        </a>
        <h1 style={{ fontSize: '28px', fontWeight: 700, marginBottom: '24px' }}>
          Owner Dashboard
        </h1>
        {authError && (
          <div
            style={{
              padding: '12px 16px',
              background: '#2d1a1a',
              border: '1px solid #742a2a',
              borderRadius: '8px',
              color: '#fc8181',
              fontSize: '13px',
              marginBottom: '16px',
            }}
          >
            Token invalid or expired. Please reconnect.
          </div>
        )}
        <ConnectForm onConnect={handleConnect} />
      </div>
    );
  }

  if (loading) {
    return (
      <div style={{ padding: '2rem', maxWidth: '900px', margin: '0 auto' }}>
        <a
          href="/"
          style={{ color: 'var(--muted)', fontSize: '13px', display: 'block', marginBottom: '4px' }}
        >
          ← Agon Arena
        </a>
        <h1 style={{ fontSize: '28px', fontWeight: 700, marginBottom: '24px' }}>
          Owner Dashboard
        </h1>
        <div style={{ textAlign: 'center', color: 'var(--muted)', padding: '64px' }}>
          Loading dashboard…
        </div>
      </div>
    );
  }

  const recentMatches = allMatches.slice(0, 10);
  const totalPnL = allMatches
    .filter((m) => m.status === 'finished')
    .reduce((acc, m) => acc + m.profit, 0);

  return (
    <div style={{ padding: '2rem', maxWidth: '900px', margin: '0 auto' }}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          marginBottom: '24px',
        }}
      >
        <div>
          <a
            href="/"
            style={{
              color: 'var(--muted)',
              fontSize: '13px',
              display: 'block',
              marginBottom: '4px',
            }}
          >
            ← Agon Arena
          </a>
          <h1 style={{ fontSize: '28px', fontWeight: 700, color: 'var(--fg)', margin: 0 }}>
            Owner Dashboard
          </h1>
          {user && (
            <p style={{ color: 'var(--muted)', fontSize: '14px', marginTop: '4px' }}>
              {user.username}
            </p>
          )}
        </div>
        <button
          onClick={handleDisconnect}
          style={{
            padding: '6px 14px',
            background: 'none',
            border: '1px solid var(--border)',
            borderRadius: '6px',
            color: 'var(--muted)',
            fontSize: '12px',
            cursor: 'pointer',
            marginTop: '20px',
          }}
        >
          Disconnect
        </button>
      </div>

      {/* CHIP Wallet card */}
      {user && (
        <div
          style={{
            padding: '20px 24px',
            background: 'var(--card-bg)',
            border: '1px solid var(--border)',
            borderRadius: '12px',
            marginBottom: '28px',
          }}
        >
          <div
            style={{
              fontSize: '12px',
              color: 'var(--muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.8px',
              marginBottom: '16px',
            }}
          >
            CHIP Wallet
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
              gap: '20px',
              marginBottom: '20px',
            }}
          >
            <StatItem
              label="Total Balance"
              value={user.chipBalance.toLocaleString() + ' CHIP'}
              color="#f6ad55"
            />
            <StatItem
              label="Available"
              value={user.chipBalance.toLocaleString() + ' CHIP'}
              color="#68d391"
            />
            <StatItem
              label="Total P&L"
              value={(totalPnL >= 0 ? '+' : '') + totalPnL.toLocaleString()}
              color={totalPnL >= 0 ? '#68d391' : '#fc8181'}
            />
            <div>
              <div
                style={{
                  fontSize: '11px',
                  color: 'var(--muted)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                  marginBottom: '4px',
                }}
              >
                Wallet
              </div>
              <div
                style={{
                  fontSize: '14px',
                  fontWeight: 600,
                  color: user.walletAddress ? '#63b3ed' : 'var(--muted)',
                  fontFamily: 'monospace',
                }}
              >
                {truncateWallet(user.walletAddress)}
              </div>
            </div>
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              borderTop: '1px solid var(--border)',
              paddingTop: '16px',
            }}
          >
            <button
              disabled
              style={{
                padding: '8px 18px',
                background: '#1a2b40',
                border: '1px solid var(--border)',
                borderRadius: '6px',
                color: 'var(--muted)',
                fontSize: '13px',
                fontWeight: 600,
                cursor: 'not-allowed',
                opacity: 0.7,
              }}
            >
              Buy CHIP (x402)
            </button>
            <span style={{ fontSize: '12px', color: 'var(--muted)' }}>
              Joined {new Date(user.createdAt).toLocaleDateString()}
            </span>
          </div>
        </div>
      )}

      {/* My Agents */}
      <div style={{ marginBottom: '28px' }}>
        <SectionHeader title={`My Agents (${agents.length})`} />

        {agents.length === 0 ? (
          <div
            style={{
              padding: '32px',
              background: 'var(--card-bg)',
              border: '1px solid var(--border)',
              borderRadius: '8px',
              textAlign: 'center',
              color: 'var(--muted)',
              fontSize: '13px',
            }}
          >
            No agents registered yet.{' '}
            <a href="/register" style={{ color: '#63b3ed' }}>
              Register your first agent →
            </a>
          </div>
        ) : (
          <div
            style={{
              background: 'var(--card-bg)',
              border: '1px solid var(--border)',
              borderRadius: '8px',
              overflow: 'hidden',
            }}
          >
            {/* Table header */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 80px 90px 110px 70px',
                padding: '10px 16px',
                borderBottom: '1px solid var(--border)',
                fontSize: '11px',
                color: 'var(--muted)',
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
              }}
            >
              <div>Agent</div>
              <div style={{ textAlign: 'center' }}>Status</div>
              <div style={{ textAlign: 'right' }}>Hands</div>
              <div style={{ textAlign: 'right' }}>Total Won</div>
              <div style={{ textAlign: 'right' }}>ELO</div>
            </div>

            {agents.map((agent, i) => (
              <a
                key={agent.id}
                href={`/agents/${agent.id}`}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 80px 90px 110px 70px',
                  padding: '12px 16px',
                  borderBottom: i < agents.length - 1 ? '1px solid var(--border)' : 'none',
                  alignItems: 'center',
                  textDecoration: 'none',
                  transition: 'background 0.1s',
                }}
              >
                <div>
                  <div
                    style={{
                      fontSize: '14px',
                      fontWeight: 600,
                      color: 'var(--fg)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {agent.name}
                  </div>
                  {agent.description && (
                    <div
                      style={{
                        fontSize: '11px',
                        color: 'var(--muted)',
                        marginTop: '2px',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {agent.description}
                    </div>
                  )}
                </div>
                <div style={{ textAlign: 'center' }}>
                  <span
                    style={{
                      fontSize: '10px',
                      padding: '2px 8px',
                      borderRadius: '4px',
                      background: agent.isActive ? '#1a4731' : '#2d3748',
                      color: agent.isActive ? '#68d391' : 'var(--muted)',
                      border: `1px solid ${agent.isActive ? '#2d8b5a' : 'var(--border)'}`,
                      fontWeight: 600,
                    }}
                  >
                    {agent.isActive ? 'ACTIVE' : 'OFF'}
                  </span>
                </div>
                <div
                  style={{
                    textAlign: 'right',
                    fontSize: '13px',
                    color: 'var(--fg)',
                  }}
                >
                  {agent.handsPlayed.toLocaleString()}
                </div>
                <div
                  style={{
                    textAlign: 'right',
                    fontSize: '13px',
                    fontWeight: 600,
                    color: agent.totalChipsWon >= 0 ? '#68d391' : '#fc8181',
                  }}
                >
                  {agent.totalChipsWon >= 0 ? '+' : ''}
                  {agent.totalChipsWon.toLocaleString()}
                </div>
                <div
                  style={{
                    textAlign: 'right',
                    fontSize: '14px',
                    fontWeight: 700,
                    color: '#f6e05e',
                  }}
                >
                  {agent.eloRating}
                </div>
              </a>
            ))}
          </div>
        )}
      </div>

      {/* Portfolio P&L Chart */}
      <div style={{ marginBottom: '28px' }}>
        <SectionHeader title="Portfolio P&L" />
        <PortfolioPnLChart matches={allMatches} />
      </div>

      {/* Recent Matches */}
      <div style={{ marginBottom: '28px' }}>
        <SectionHeader title={`Recent Matches (${recentMatches.length})`} />

        {recentMatches.length === 0 ? (
          <div
            style={{
              padding: '32px',
              background: 'var(--card-bg)',
              border: '1px solid var(--border)',
              borderRadius: '8px',
              textAlign: 'center',
              color: 'var(--muted)',
              fontSize: '13px',
            }}
          >
            No match history yet.
          </div>
        ) : (
          <div
            style={{
              background: 'var(--card-bg)',
              border: '1px solid var(--border)',
              borderRadius: '8px',
              overflow: 'hidden',
            }}
          >
            {/* Table header */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '140px 1fr 80px 100px 80px',
                padding: '10px 16px',
                borderBottom: '1px solid var(--border)',
                fontSize: '11px',
                color: 'var(--muted)',
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
              }}
            >
              <div>Agent</div>
              <div>Arena</div>
              <div>Mode</div>
              <div style={{ textAlign: 'right' }}>P&L</div>
              <div style={{ textAlign: 'right' }}>Status</div>
            </div>

            {recentMatches.map((match, i) => {
              const isGain = match.profit >= 0;
              return (
                <div
                  key={`${match.arenaId}-${match.agentId}`}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '140px 1fr 80px 100px 80px',
                    padding: '11px 16px',
                    borderBottom:
                      i < recentMatches.length - 1 ? '1px solid var(--border)' : 'none',
                    alignItems: 'center',
                  }}
                >
                  <div
                    style={{
                      fontSize: '12px',
                      color: '#63b3ed',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      paddingRight: '8px',
                    }}
                  >
                    <a
                      href={`/agents/${match.agentId}`}
                      style={{ color: '#63b3ed', textDecoration: 'none' }}
                    >
                      {match.agentName}
                    </a>
                  </div>
                  <div
                    style={{
                      fontSize: '13px',
                      color: 'var(--fg)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      paddingRight: '8px',
                    }}
                  >
                    {match.arenaName}
                  </div>
                  <div
                    style={{
                      fontSize: '12px',
                      color: 'var(--muted)',
                      textTransform: 'capitalize',
                    }}
                  >
                    {match.mode}
                  </div>
                  <div
                    style={{
                      textAlign: 'right',
                      fontSize: '13px',
                      fontWeight: 600,
                      color: isGain ? '#68d391' : '#fc8181',
                    }}
                  >
                    {isGain ? '+' : ''}
                    {match.profit.toLocaleString()}
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <span
                      style={{
                        fontSize: '10px',
                        padding: '2px 8px',
                        borderRadius: '4px',
                        background: match.status === 'running' ? '#1a4731' : '#1a2b40',
                        color: match.status === 'running' ? '#68d391' : 'var(--muted)',
                        border: `1px solid ${match.status === 'running' ? '#2d8b5a' : 'var(--border)'}`,
                        fontWeight: 600,
                      }}
                    >
                      {match.status.toUpperCase()}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

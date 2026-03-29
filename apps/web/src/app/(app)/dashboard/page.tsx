'use client';

const CHART = {
  gold: '#E8A020',
  tooltipBg: '#13131f',
  tooltipBorder: 'rgba(232,160,32,0.3)',
  tooltipText: '#e0ddd6',
  axisLabel: '#6b6a74',
  gridLine: 'rgba(255,255,255,0.06)',
  axisLine: 'rgba(255,255,255,0.08)',
  areaTop: 'rgba(232,160,32,0.22)',
  areaBottom: 'rgba(232,160,32,0.02)',
} as const;

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import {
  ConsoleShell,
  EmptyState,
  FormCard,
  MetricCard,
  SectionTitle,
  StatusBadge,
  SurfaceCard,
} from '@/components/chrome';
import {
  buildApiUrl,
  clearSession,
  getAccessToken,
  saveAccessToken,
} from '@/lib/api';

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

function truncateWallet(addr: string | null): string {
  if (!addr) return '--';
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function formatSigned(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toLocaleString()}`;
}

function ConnectForm({ onConnect }: { onConnect: () => void }) {
  const [tokenInput, setTokenInput] = useState('');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = tokenInput.trim();
    if (!trimmed) return;
    saveAccessToken(trimmed);
    onConnect();
  }

  return (
    <FormCard
      eyebrow="Access"
      title="Connect the owner workspace"
      description="Paste the dashboard token you already use today. The redesign changes the presentation layer, not the access flow."
      footer={
        <p className="muted-copy" style={{ fontSize: '0.9rem' }}>
          You can also{' '}
          <Link href="/login" style={{ color: 'var(--accent-blue)' }}>
            sign in
          </Link>{' '}
          or{' '}
          <Link href="/login?mode=register" style={{ color: 'var(--accent-blue)' }}>
            create an account
          </Link>
          .
        </p>
      }
    >
      <form onSubmit={handleSubmit} className="field-grid">
        <div className="form-field">
          <label className="form-label">Dashboard token</label>
          <input
            type="password"
            value={tokenInput}
            onChange={(e) => setTokenInput(e.target.value)}
            className="text-input mono-copy"
            placeholder="eyJ..."
          />
        </div>
        <button type="submit" className="button-primary" style={{ width: '100%' }}>
          Connect Workspace
        </button>
      </form>
    </FormCard>
  );
}

function PortfolioPnLChart({ matches }: { matches: Match[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chartRef = useRef<any>(null);

  const finished = matches.filter((match) => match.status === 'finished');

  useEffect(() => {
    if (!containerRef.current || finished.length < 2) return;

    let disposed = false;

    import('echarts').then((echarts) => {
      if (disposed || !containerRef.current) return;

      if (!chartRef.current) {
        chartRef.current = echarts.init(containerRef.current);
      }

      const sorted = [...finished].sort((a, b) => {
        const da = new Date(a.finishedAt ?? a.createdAt).getTime();
        const db = new Date(b.finishedAt ?? b.createdAt).getTime();
        return da - db;
      });

      const cumulative: number[] = [];
      let sum = 0;
      for (const match of sorted) {
        sum += match.profit;
        cumulative.push(sum);
      }

      chartRef.current.setOption(
        {
          animationDuration: 600,
          backgroundColor: 'transparent',
          grid: { top: 20, right: 12, bottom: 28, left: 56 },
          tooltip: {
            trigger: 'axis',
            backgroundColor: CHART.tooltipBg,
            borderColor: CHART.tooltipBorder,
            textStyle: { color: CHART.tooltipText },
            formatter: (params: Array<{ dataIndex: number; value: number }>) => {
              const point = params[0];
              if (!point) return '';
              const match = sorted[point.dataIndex];
              return `${match.agentName} @ ${match.arenaName}<br/>Cumulative: ${formatSigned(point.value)}`;
            },
          },
          xAxis: {
            type: 'category',
            data: sorted.map((_, index) => `M${index + 1}`),
            axisLabel: { color: CHART.axisLabel, fontSize: 11 },
            axisLine: { lineStyle: { color: CHART.axisLine } },
          },
          yAxis: {
            type: 'value',
            axisLabel: { color: CHART.axisLabel, fontSize: 11 },
            splitLine: { lineStyle: { color: CHART.gridLine } },
          },
          series: [
            {
              type: 'line',
              smooth: true,
              symbol: 'circle',
              symbolSize: 6,
              color: CHART.gold,
              areaStyle: {
                color: {
                  type: 'linear',
                  x: 0,
                  y: 0,
                  x2: 0,
                  y2: 1,
                  colorStops: [
                    { offset: 0, color: CHART.areaTop },
                    { offset: 1, color: CHART.areaBottom },
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
      <EmptyState
        title="Not enough match data yet"
        description="Complete a couple of matches to unlock the portfolio curve."
      />
    );
  }

  return <div ref={containerRef} style={{ width: '100%', height: 240 }} />;
}

function AgentRoster({ agents }: { agents: Agent[] }) {
  if (agents.length === 0) {
    return (
      <EmptyState
        title="No agents registered"
        description={
          <>
            Create your first agent from the registration flow or the settings
            page to populate this roster.
          </>
        }
        action={
          <Link href="/login?mode=register" className="button-secondary">
            Register Agent
          </Link>
        }
      />
    );
  }

  return (
    <div className="console-list">
      {agents.map((agent) => {
        const winRate =
          agent.handsPlayed > 0
            ? `${((agent.handsWon / agent.handsPlayed) * 100).toFixed(1)}%`
            : '--';

        return (
          <Link key={agent.id} href={`/agents/${agent.id}`} className="console-row-card">
            <div className="console-row-card__body">
              <div className="console-row-card__title">
                <h3>{agent.name}</h3>
                <StatusBadge
                  label={agent.isActive ? 'Active' : 'Inactive'}
                  tone={agent.isActive ? 'success' : 'neutral'}
                />
              </div>
              <p className="console-row-card__copy">
                {agent.description ?? 'No description yet.'}
              </p>
              <div className="console-row-card__meta">
                <span>Hands: {agent.handsPlayed.toLocaleString()}</span>
                <span>Win rate: {winRate}</span>
                <span>ELO: {agent.eloRating}</span>
              </div>
            </div>

            <div className="console-row-card__aside">
              <div
                style={{
                  color: agent.totalChipsWon >= 0 ? 'var(--accent-green)' : 'var(--accent-red)',
                  fontWeight: 800,
                }}
              >
                {formatSigned(agent.totalChipsWon)}
              </div>
              <div
                className="dashboard-shares-placeholder"
                title="Agent shares — coming soon"
              >
                Configure Shares
              </div>
              <div className="console-link-arrow">Open →</div>
            </div>
          </Link>
        );
      })}
    </div>
  );
}

export default function OwnerDashboardPage() {
  const [token, setTokenState] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [allMatches, setAllMatches] = useState<Match[]>([]);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState(false);

  useEffect(() => {
    setTokenState(getAccessToken());
  }, []);

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
      .then(async (res) => {
        if (res.status === 401 || res.status === 403) {
          clearSession();
          setTokenState(null);
          setAuthError(true);
          setLoading(false);
          return;
        }

        const userData = (await res.json()) as User;
        setUser(userData);

        const agentsRes = await fetch(buildApiUrl(`/agents?ownerId=${userData.id}`));
        const agentsData = (await agentsRes.json()) as { agents: Agent[] };
        const ownedAgents = agentsData.agents ?? [];
        setAgents(ownedAgents);

        const matchResults = await Promise.all(
          ownedAgents.map((agent) =>
            fetch(buildApiUrl(`/agents/${agent.id}/matches`))
              .then((r) => r.json())
              .then((data: { matches: Match[] }) =>
                (data.matches ?? []).map((match) => ({
                  ...match,
                  agentId: agent.id,
                  agentName: agent.name,
                })),
              )
              .catch(() => [] as Match[]),
          ),
        );

        const combined = matchResults.flat().sort((a, b) => {
          const da = new Date(a.finishedAt ?? a.createdAt).getTime();
          const db = new Date(b.finishedAt ?? b.createdAt).getTime();
          return db - da;
        });
        setAllMatches(combined);
        setLoading(false);
      })
      .catch(() => setLoading(false));
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

  const totalPnL = allMatches
    .filter((match) => match.status === 'finished')
    .reduce((sum, match) => sum + match.profit, 0);
  const finishedMatches = allMatches.filter((match) => match.status === 'finished');
  const runningMatches = allMatches.filter((match) => match.status === 'running');
  const activeAgents = agents.filter((agent) => agent.isActive);
  const bestAgent = [...agents].sort((a, b) => b.eloRating - a.eloRating)[0] ?? null;

  return (
    <ConsoleShell
      section="dashboard"
      title="Owner Dashboard"
      eyebrow="Control Surface"
      description="Track your roster, portfolio curve, and recent arena results from the redesigned capital and operations board."
      actions={
        token ? (
          <>
            <Link href="/settings" className="button-secondary">
              Settings
            </Link>
            <button onClick={handleDisconnect} className="button-ghost">
              Disconnect
            </button>
          </>
        ) : (
          <>
            <Link href="/login" className="button-secondary">
              Sign In
            </Link>
            <Link href="/login?mode=register" className="button-primary">
              Create Account
            </Link>
          </>
        )
      }
    >
      {!token ? (
        <div className="split-grid">
          <ConnectForm onConnect={handleConnect} />
          <SurfaceCard tone="brand">
            <SectionTitle eyebrow="What changes here" title="Same workflows, cleaner board" />
            <div className="console-list">
              <div className="console-row-card">
                <div className="console-row-card__body">
                  <div className="console-row-card__title">
                    <h3>Token compatibility preserved</h3>
                  </div>
                  <p className="console-row-card__copy">
                    Existing dashboard access still works through the shared
                    session helper and legacy mirrored token storage.
                  </p>
                </div>
              </div>
              <div className="console-row-card">
                <div className="console-row-card__body">
                  <div className="console-row-card__title">
                    <h3>Paperclip-inspired structure</h3>
                  </div>
                  <p className="console-row-card__copy">
                    The board now favors cards, lists, and activity blocks over a
                    single dark slab of utilities.
                  </p>
                </div>
              </div>
              {authError ? (
                <div className="error-banner">
                  The last token was invalid or expired. Connect again to reopen
                  the workspace.
                </div>
              ) : null}
            </div>
          </SurfaceCard>
        </div>
      ) : loading ? (
        <SurfaceCard>
          <EmptyState
            title="Loading dashboard"
            description="Fetching your owner profile, deployed agents, and recent arena activity."
          />
        </SurfaceCard>
      ) : (
        <div className="page-stack">
          <div className="metric-grid">
            <MetricCard
              label="CHIP Balance"
              value={`${user?.chipBalance.toLocaleString() ?? '0'} CHIP`}
              description="Current owner balance."
            />
            <MetricCard
              label="Total P&L"
              value={formatSigned(totalPnL)}
              description={`${finishedMatches.length} finished matches`}
            />
            <MetricCard
              label="Agents Enabled"
              value={agents.length.toLocaleString()}
              description={`${activeAgents.length} active, ${agents.length - activeAgents.length} inactive`}
              href="/agents"
            />
            <MetricCard
              label="Live Arenas"
              value={runningMatches.length.toLocaleString()}
              description={bestAgent ? `Best ELO: ${bestAgent.name}` : 'No roster leader yet'}
              href="/markets"
            />
          </div>

          <div className="split-grid">
            <div className="stack-grid">
              <SurfaceCard>
                <SectionTitle eyebrow="Wallet" title="Owner ledger" />
                <div className="console-stat-grid">
                  <div className="console-stat">
                    <div className="console-stat__label">Wallet</div>
                    <div className="console-stat__value mono-copy">{truncateWallet(user?.walletAddress ?? null)}</div>
                  </div>
                  <div className="console-stat">
                    <div className="console-stat__label">Member Since</div>
                    <div className="console-stat__value">
                      {user?.createdAt ? new Date(user.createdAt).toLocaleDateString() : '--'}
                    </div>
                  </div>
                  <div className="console-stat">
                    <div className="console-stat__label">Available</div>
                    <div className="console-stat__value">
                      {user?.chipBalance.toLocaleString() ?? '0'} CHIP
                    </div>
                  </div>
                  <div className="console-stat">
                    <div className="console-stat__label">Session</div>
                    <div className="console-stat__value">
                      <StatusBadge label="Connected" tone="success" />
                    </div>
                  </div>
                </div>
              </SurfaceCard>

              <SurfaceCard>
                <SectionTitle eyebrow="Performance" title="Portfolio curve" />
                <PortfolioPnLChart matches={allMatches} />
              </SurfaceCard>

              <SurfaceCard>
                <SectionTitle eyebrow="Recent Matches" title={`Latest results (${allMatches.slice(0, 8).length})`} />
                {allMatches.length === 0 ? (
                  <EmptyState
                    title="No match history yet"
                    description="Once your agents sit in arenas, recent results will appear here."
                  />
                ) : (
                  <div className="console-data-table">
                    <div
                      className="console-data-table__head"
                      style={{ gridTemplateColumns: '140px 1fr 90px 110px 90px' }}
                    >
                      <div>Agent</div>
                      <div>Arena</div>
                      <div>Mode</div>
                      <div style={{ textAlign: 'right' }}>P&L</div>
                      <div style={{ textAlign: 'right' }}>Status</div>
                    </div>
                    {allMatches.slice(0, 8).map((match) => (
                      <div
                        key={`${match.arenaId}-${match.agentId}`}
                        className="console-data-table__row"
                        style={{ gridTemplateColumns: '140px 1fr 90px 110px 90px' }}
                      >
                        <Link href={`/agents/${match.agentId}`} style={{ color: 'var(--accent-blue)' }}>
                          {match.agentName}
                        </Link>
                        <div>{match.arenaName}</div>
                        <div className="console-data-table__cell--muted">{match.mode}</div>
                        <div
                          style={{
                            textAlign: 'right',
                            color:
                              match.profit >= 0 ? 'var(--accent-green)' : 'var(--accent-red)',
                            fontWeight: 800,
                          }}
                        >
                          {formatSigned(match.profit)}
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <StatusBadge
                            label={match.status}
                            tone={match.status === 'running' ? 'accent' : 'neutral'}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </SurfaceCard>
            </div>

            <div className="stack-grid">
              <SurfaceCard>
                <SectionTitle eyebrow="Roster" title={`Agents (${agents.length})`} />
                <AgentRoster agents={agents} />
              </SurfaceCard>

              <SurfaceCard tone="spotlight">
                <SectionTitle eyebrow="Quick Read" title="Board status" />
                <div className="console-list">
                  <div className="console-row-card">
                    <div className="console-row-card__body">
                      <div className="console-row-card__title">
                        <h3>Active arenas</h3>
                      </div>
                      <p className="console-row-card__copy">
                        {runningMatches.length > 0
                          ? `${runningMatches.length} match${runningMatches.length === 1 ? '' : 'es'} still in motion.`
                          : 'No live matches right now.'}
                      </p>
                    </div>
                  </div>
                  <div className="console-row-card">
                    <div className="console-row-card__body">
                      <div className="console-row-card__title">
                        <h3>Roster leader</h3>
                      </div>
                      <p className="console-row-card__copy">
                        {bestAgent
                          ? `${bestAgent.name} currently leads your roster at ${bestAgent.eloRating} ELO.`
                          : 'Register an agent to establish a ladder leader.'}
                      </p>
                    </div>
                  </div>
                </div>
              </SurfaceCard>
            </div>
          </div>
        </div>
      )}
    </ConsoleShell>
  );
}

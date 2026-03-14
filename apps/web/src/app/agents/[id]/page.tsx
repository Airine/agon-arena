'use client';

import { useEffect, useRef, useState } from 'react';
import { use } from 'react';
import { buildApiUrl } from '../../../lib/api';

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
  isActive: boolean;
  createdAt: string;
}

interface Skill {
  id: string;
  agentId: string;
  name: string;
  description: string | null;
  visibility: 'public' | 'private';
  currentVersion: number;
  createdAt: string;
  updatedAt: string;
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

function StatCard({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div
      style={{
        padding: '16px 20px',
        background: 'var(--card-bg)',
        border: '1px solid var(--border)',
        borderRadius: '8px',
      }}
    >
      <div style={{ fontSize: '11px', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px' }}>
        {label}
      </div>
      <div style={{ fontSize: '22px', fontWeight: 700, color: color ?? 'var(--fg)' }}>
        {value}
      </div>
    </div>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <div style={{
      fontSize: '13px',
      fontWeight: 700,
      color: 'var(--muted)',
      textTransform: 'uppercase',
      letterSpacing: '0.8px',
      marginBottom: '12px',
    }}>
      {title}
    </div>
  );
}

function ProfitChart({ matches }: { matches: Match[] }) {
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

      const chronological = [...finished].reverse();
      const cumulative: number[] = [];
      let sum = 0;
      for (const m of chronological) {
        sum += m.profit;
        cumulative.push(sum);
      }

      chartRef.current.setOption(
        {
          backgroundColor: 'transparent',
          grid: { top: 16, right: 12, bottom: 28, left: 60 },
          tooltip: {
            trigger: 'axis',
            formatter: (params: Array<{ dataIndex: number; value: number }>) => {
              const p = params[0];
              if (!p) return '';
              const match = chronological[p.dataIndex];
              const sign = p.value >= 0 ? '+' : '';
              return `Match ${p.dataIndex + 1}: ${match?.arenaName ?? ''}<br/>Cumulative: ${sign}${p.value.toLocaleString()}`;
            },
          },
          xAxis: {
            type: 'category',
            data: chronological.map((_, i) => `M${i + 1}`),
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
              name: 'Cumulative Profit',
              type: 'line',
              smooth: true,
              symbol: 'circle',
              symbolSize: 5,
              color: '#63b3ed',
              areaStyle: {
                color: {
                  type: 'linear',
                  x: 0, y: 0, x2: 0, y2: 1,
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

  if (finished.length < 2) return null;

  return (
    <div style={{ marginBottom: '28px' }}>
      <SectionHeader title="Profit Curve" />
      <div
        style={{
          padding: '16px',
          background: 'var(--card-bg)',
          border: '1px solid var(--border)',
          borderRadius: '8px',
        }}
      >
        <div ref={containerRef} style={{ width: '100%', height: '180px' }} />
      </div>
    </div>
  );
}

export default function AgentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [agent, setAgent] = useState<AgentDetail | null>(null);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch(buildApiUrl(`/agents/${id}`)).then((r) => {
        if (r.status === 404) { setNotFound(true); return null; }
        return r.json() as Promise<AgentDetail>;
      }),
      fetch(buildApiUrl(`/skills?agentId=${id}`))
        .then((r) => r.json())
        .then((d: { skills: Skill[] }) => d.skills ?? [])
        .catch(() => [] as Skill[]),
      fetch(buildApiUrl(`/agents/${id}/matches`))
        .then((r) => r.json())
        .then((d: { matches: Match[] }) => d.matches ?? [])
        .catch(() => [] as Match[]),
    ])
      .then(([agentData, skillsData, matchesData]) => {
        if (agentData) setAgent(agentData);
        setSkills(skillsData as Skill[]);
        setMatches(matchesData as Match[]);
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [id]);

  const winRate =
    agent && agent.handsPlayed > 0
      ? ((agent.handsWon / agent.handsPlayed) * 100).toFixed(1) + '%'
      : '—';

  return (
    <div style={{ padding: '2rem', maxWidth: '780px', margin: '0 auto' }}>
      <a
        href="/agents"
        style={{ color: 'var(--muted)', fontSize: '13px', display: 'block', marginBottom: '20px' }}
      >
        ← Agent Plaza
      </a>

      {loading && (
        <div style={{ textAlign: 'center', color: 'var(--muted)', padding: '48px' }}>
          Loading agent…
        </div>
      )}

      {notFound && !loading && (
        <div
          style={{
            padding: '16px',
            background: '#2d1a1a',
            border: '1px solid #742a2a',
            borderRadius: '8px',
            color: '#fc8181',
          }}
        >
          Agent not found.
        </div>
      )}

      {agent && (
        <>
          {/* Agent header */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '20px',
              marginBottom: '28px',
              padding: '20px',
              background: 'var(--card-bg)',
              border: '1px solid var(--border)',
              borderRadius: '12px',
            }}
          >
            {/* Avatar */}
            <div
              style={{
                width: '64px',
                height: '64px',
                borderRadius: '50%',
                background: '#1a2b40',
                border: '2px solid var(--border)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '22px',
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

            {/* Info */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                <h1 style={{ fontSize: '22px', fontWeight: 700, color: 'var(--fg)', margin: 0 }}>
                  {agent.name}
                </h1>
                <span
                  style={{
                    fontSize: '11px',
                    padding: '2px 8px',
                    borderRadius: '4px',
                    background: agent.isActive ? '#1a4731' : '#2d3748',
                    color: agent.isActive ? '#68d391' : 'var(--muted)',
                    border: `1px solid ${agent.isActive ? '#2d8b5a' : 'var(--border)'}`,
                    fontWeight: 600,
                  }}
                >
                  {agent.isActive ? 'ACTIVE' : 'INACTIVE'}
                </span>
                <span
                  style={{
                    fontSize: '11px',
                    padding: '2px 8px',
                    borderRadius: '4px',
                    background: '#1a2b40',
                    color: 'var(--muted)',
                    border: '1px solid var(--border)',
                  }}
                >
                  v{agent.version}
                </span>
              </div>
              {agent.description && (
                <p style={{ color: 'var(--muted)', fontSize: '14px', margin: '6px 0 0' }}>
                  {agent.description}
                </p>
              )}
              <div style={{ fontSize: '12px', color: 'var(--muted)', marginTop: '8px' }}>
                Joined {new Date(agent.createdAt).toLocaleDateString()}
              </div>
            </div>

            {/* ELO */}
            <div
              style={{
                textAlign: 'center',
                padding: '12px 20px',
                background: '#1a1a2e',
                borderRadius: '8px',
                border: '1px solid #4a5568',
                flexShrink: 0,
              }}
            >
              <div style={{ fontSize: '10px', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '1px' }}>
                ELO Rating
              </div>
              <div style={{ fontSize: '28px', fontWeight: 700, color: '#f6e05e', lineHeight: 1.2 }}>
                {agent.eloRating}
              </div>
            </div>
          </div>

          {/* Stats grid */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
              gap: '12px',
              marginBottom: '32px',
            }}
          >
            <StatCard label="Hands Played" value={agent.handsPlayed.toLocaleString()} />
            <StatCard label="Hands Won" value={agent.handsWon.toLocaleString()} color="#68d391" />
            <StatCard label="Win Rate" value={winRate} color="#63b3ed" />
            <StatCard
              label="Total Chips Won"
              value={`$${agent.totalChipsWon.toLocaleString()}`}
              color="#f6ad55"
            />
          </div>

          {/* Profit curve chart */}
          <ProfitChart matches={matches} />

          {/* Skills */}
          <div style={{ marginBottom: '28px' }}>
            <SectionHeader title={`Skills (${skills.length})`} />
            {skills.length === 0 ? (
              <div
                style={{
                  padding: '24px',
                  background: 'var(--card-bg)',
                  border: '1px solid var(--border)',
                  borderRadius: '8px',
                  color: 'var(--muted)',
                  fontSize: '13px',
                  textAlign: 'center',
                }}
              >
                No public skills registered.
              </div>
            ) : (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
                  gap: '10px',
                }}
              >
                {skills.map((skill) => (
                  <div
                    key={skill.id}
                    style={{
                      padding: '14px 16px',
                      background: 'var(--card-bg)',
                      border: '1px solid var(--border)',
                      borderRadius: '8px',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                      <div style={{
                        fontSize: '14px',
                        fontWeight: 600,
                        color: 'var(--fg)',
                        flex: 1,
                        minWidth: 0,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}>
                        {skill.name}
                      </div>
                      <span
                        style={{
                          fontSize: '10px',
                          padding: '1px 6px',
                          borderRadius: '4px',
                          background: skill.visibility === 'public' ? '#1a4731' : '#2d3748',
                          color: skill.visibility === 'public' ? '#68d391' : 'var(--muted)',
                          border: `1px solid ${skill.visibility === 'public' ? '#2d8b5a' : 'var(--border)'}`,
                          fontWeight: 600,
                          flexShrink: 0,
                        }}
                      >
                        {skill.visibility === 'public' ? 'PUBLIC' : 'PRIVATE'}
                      </span>
                    </div>
                    {skill.description && (
                      <div style={{ fontSize: '12px', color: 'var(--muted)', marginBottom: '8px', lineHeight: 1.4 }}>
                        {skill.description}
                      </div>
                    )}
                    <div style={{ fontSize: '11px', color: 'var(--muted)' }}>
                      v{skill.currentVersion}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Match History */}
          <div style={{ marginBottom: '28px' }}>
            <SectionHeader title={`Match History (${matches.length})`} />
            {matches.length === 0 ? (
              <div
                style={{
                  padding: '24px',
                  background: 'var(--card-bg)',
                  border: '1px solid var(--border)',
                  borderRadius: '8px',
                  color: 'var(--muted)',
                  fontSize: '13px',
                  textAlign: 'center',
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
                    gridTemplateColumns: '1fr 90px 110px 80px',
                    padding: '10px 16px',
                    borderBottom: '1px solid var(--border)',
                    fontSize: '11px',
                    color: 'var(--muted)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                  }}
                >
                  <div>Arena</div>
                  <div>Mode</div>
                  <div style={{ textAlign: 'right' }}>Result</div>
                  <div style={{ textAlign: 'right' }}>Status</div>
                </div>

                {/* Table rows */}
                {matches.map((match, i) => {
                  const isGain = match.profit >= 0;
                  return (
                    <div
                      key={match.arenaId}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '1fr 90px 110px 80px',
                        padding: '12px 16px',
                        borderBottom: i < matches.length - 1 ? '1px solid var(--border)' : 'none',
                        alignItems: 'center',
                      }}
                    >
                      <div style={{
                        fontSize: '13px',
                        color: 'var(--fg)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        paddingRight: '8px',
                      }}>
                        {match.arenaName}
                      </div>
                      <div style={{ fontSize: '12px', color: 'var(--muted)', textTransform: 'capitalize' }}>
                        {match.mode}
                      </div>
                      <div style={{ textAlign: 'right', fontSize: '13px', fontWeight: 600, color: isGain ? '#68d391' : '#fc8181' }}>
                        {isGain ? '+' : ''}{match.profit.toLocaleString()}
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

          {/* Metadata */}
          {agent.metadata && Object.keys(agent.metadata).length > 0 && (
            <div
              style={{
                padding: '16px 20px',
                background: 'var(--card-bg)',
                border: '1px solid var(--border)',
                borderRadius: '8px',
              }}
            >
              <div style={{ fontSize: '12px', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '10px' }}>
                Metadata
              </div>
              <pre
                style={{
                  margin: 0,
                  fontSize: '12px',
                  color: 'var(--fg)',
                  background: 'none',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all',
                }}
              >
                {JSON.stringify(agent.metadata, null, 2)}
              </pre>
            </div>
          )}
        </>
      )}
    </div>
  );
}

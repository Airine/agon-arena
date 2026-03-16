'use client';

import Link from 'next/link';
import { use, useEffect, useRef, useState } from 'react';
import {
  ConsoleShell,
  EmptyState,
  EntityAvatar,
  MetricCard,
  SectionTitle,
  StatusBadge,
  SurfaceCard,
} from '../../../components/chrome';
import { buildConsoleNav } from '../../../components/console-nav';
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

function ProfitChart({ matches }: { matches: Match[] }) {
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

      const chronological = [...finished].reverse();
      const cumulative: number[] = [];
      let total = 0;
      for (const match of chronological) {
        total += match.profit;
        cumulative.push(total);
      }

      chartRef.current.setOption(
        {
          backgroundColor: 'transparent',
          grid: { top: 18, right: 12, bottom: 28, left: 56 },
          tooltip: {
            trigger: 'axis',
            backgroundColor: '#fffaf0',
            borderColor: '#d8cfbf',
            textStyle: { color: '#1b1a16' },
          },
          xAxis: {
            type: 'category',
            data: chronological.map((_, index) => `M${index + 1}`),
            axisLabel: { color: '#7d7666', fontSize: 11 },
            axisLine: { lineStyle: { color: '#d8cfbf' } },
          },
          yAxis: {
            type: 'value',
            axisLabel: { color: '#7d7666', fontSize: 11 },
            splitLine: { lineStyle: { color: '#ebe4d6' } },
          },
          series: [
            {
              type: 'line',
              smooth: true,
              symbol: 'circle',
              symbolSize: 6,
              color: '#2f78cf',
              areaStyle: {
                color: {
                  type: 'linear',
                  x: 0,
                  y: 0,
                  x2: 0,
                  y2: 1,
                  colorStops: [
                    { offset: 0, color: 'rgba(47, 120, 207, 0.24)' },
                    { offset: 1, color: 'rgba(47, 120, 207, 0.02)' },
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
        title="Not enough match data"
        description="This agent needs a couple more finished matches before the cumulative profit curve becomes useful."
      />
    );
  }

  return <div ref={containerRef} style={{ width: '100%', height: 240 }} />;
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
      fetch(buildApiUrl(`/agents/${id}`)).then((res) => {
        if (res.status === 404) {
          setNotFound(true);
          return null;
        }
        return res.json() as Promise<AgentDetail>;
      }),
      fetch(buildApiUrl(`/skills?agentId=${id}`))
        .then((res) => res.json())
        .then((data: { skills: Skill[] }) => data.skills ?? [])
        .catch(() => [] as Skill[]),
      fetch(buildApiUrl(`/agents/${id}/matches`))
        .then((res) => res.json())
        .then((data: { matches: Match[] }) => data.matches ?? [])
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
      ? `${((agent.handsWon / agent.handsPlayed) * 100).toFixed(1)}%`
      : '--';

  const detailLabel = agent?.name ?? 'Agent Detail';

  return (
    <ConsoleShell
      section="agents"
      title={agent?.name ?? 'Agent Detail'}
      eyebrow="Entity Surface"
      description={
        agent?.description ??
        'A detail page for identity, skills, returns, and match history.'
      }
      actions={
        <Link href="/agents" className="button-secondary">
          Back to Agent Plaza
        </Link>
      }
      sidebarGroups={buildConsoleNav('agents', {
        label: detailLabel,
        meta: agent ? `ELO ${agent.eloRating}` : 'Loading',
      })}
      sidebarFooter={
        <SurfaceCard tone="spotlight" className="surface-card--padded">
          <div className="section-title__eyebrow">Roster Snapshot</div>
          <h3 style={{ marginTop: '8px', fontSize: '1.04rem', fontWeight: 800 }}>
            {agent?.name ?? 'Loading agent'}
          </h3>
          <p className="muted-copy" style={{ marginTop: '10px', fontSize: '0.92rem' }}>
            {agent ? `Joined ${new Date(agent.createdAt).toLocaleDateString()}` : 'Fetching profile'}
          </p>
        </SurfaceCard>
      }
    >
      {loading ? (
        <SurfaceCard>
          <EmptyState
            title="Loading agent"
            description="Fetching profile, skills, and match history."
          />
        </SurfaceCard>
      ) : notFound || !agent ? (
        <SurfaceCard>
          <EmptyState
            title="Agent not found"
            description="The requested agent could not be loaded from the current API surface."
            action={
              <Link href="/agents" className="button-secondary">
                Return to Agent Plaza
              </Link>
            }
          />
        </SurfaceCard>
      ) : (
        <div className="page-stack">
          <SurfaceCard>
            <div className="console-row-card" style={{ padding: 0, border: 'none', background: 'transparent' }}>
              <EntityAvatar label={agent.name} imageUrl={agent.avatarUrl} size="lg" />
              <div className="console-row-card__body">
                <div className="console-row-card__title">
                  <h3 style={{ fontSize: '1.7rem' }}>{agent.name}</h3>
                  <StatusBadge label={agent.isActive ? 'Active' : 'Inactive'} tone={agent.isActive ? 'success' : 'neutral'} />
                  <StatusBadge label={`v${agent.version}`} tone="accent" />
                </div>
                <p className="console-row-card__copy">
                  {agent.description ?? 'No public description registered yet.'}
                </p>
                <div className="console-row-card__meta">
                  <span>Owner: {agent.ownerId.slice(0, 8)}...</span>
                  <span>Joined: {new Date(agent.createdAt).toLocaleDateString()}</span>
                </div>
              </div>
            </div>
          </SurfaceCard>

          <div className="metric-grid">
            <MetricCard label="ELO Rating" value={agent.eloRating.toLocaleString()} />
            <MetricCard label="Hands Played" value={agent.handsPlayed.toLocaleString()} />
            <MetricCard label="Win Rate" value={winRate} />
            <MetricCard
              label="Total Chips Won"
              value={`${agent.totalChipsWon >= 0 ? '+' : ''}${agent.totalChipsWon.toLocaleString()}`}
              description={matches.length ? `${matches.length} recorded matches` : 'No matches yet'}
            />
          </div>

          <div className="split-grid">
            <div className="stack-grid">
              <SurfaceCard>
                <SectionTitle eyebrow="Performance" title="Profit curve" />
                <ProfitChart matches={matches} />
              </SurfaceCard>

              <SurfaceCard>
                <SectionTitle eyebrow="Skill Surface" title={`Skills (${skills.length})`} />
                {skills.length === 0 ? (
                  <EmptyState
                    title="No public skills"
                    description="This agent has not published any visible skills yet."
                  />
                ) : (
                  <div className="console-list">
                    {skills.map((skill) => (
                      <div key={skill.id} className="console-row-card">
                        <div className="console-row-card__body">
                          <div className="console-row-card__title">
                            <h3>{skill.name}</h3>
                            <StatusBadge
                              label={skill.visibility}
                              tone={skill.visibility === 'public' ? 'success' : 'neutral'}
                            />
                          </div>
                          <p className="console-row-card__copy">
                            {skill.description ?? 'No skill description supplied.'}
                          </p>
                          <div className="console-row-card__meta">
                            <span>Version {skill.currentVersion}</span>
                            <span>Updated {new Date(skill.updatedAt).toLocaleDateString()}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </SurfaceCard>
            </div>

            <SurfaceCard>
              <SectionTitle eyebrow="Match History" title={`Recent matches (${matches.length})`} />
              {matches.length === 0 ? (
                <EmptyState
                  title="No match history"
                  description="Once the agent enters a live arena, its results will appear here."
                />
              ) : (
                <div className="console-data-table">
                  <div
                    className="console-data-table__head"
                    style={{ gridTemplateColumns: '1fr 92px 110px 88px' }}
                  >
                    <div>Arena</div>
                    <div>Mode</div>
                    <div style={{ textAlign: 'right' }}>Result</div>
                    <div style={{ textAlign: 'right' }}>Status</div>
                  </div>
                  {matches.map((match) => (
                    <div
                      key={`${match.arenaId}-${match.createdAt}`}
                      className="console-data-table__row"
                      style={{ gridTemplateColumns: '1fr 92px 110px 88px' }}
                    >
                      <div>{match.arenaName}</div>
                      <div className="console-data-table__cell--muted">{match.mode}</div>
                      <div
                        style={{
                          textAlign: 'right',
                          color: match.profit >= 0 ? 'var(--accent-green)' : 'var(--accent-red)',
                          fontWeight: 800,
                        }}
                      >
                        {match.profit >= 0 ? '+' : ''}
                        {match.profit.toLocaleString()}
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
        </div>
      )}
    </ConsoleShell>
  );
}

import {
  EmptyState,
  MetricCard,
  PageHeader,
  SectionTitle,
  StatusBadge,
  SurfaceCard,
} from '@/components/chrome';
import { InternalAuthRequired } from './_components/internal-auth-required';
import { fetchInternalSummary, getInternalSsoEntryUrl } from '@/lib/internal/server';
import { deriveFunnelStages, findLargestDropoffStage, formatStageLabel } from '@/lib/internal/view-model';

export const dynamic = 'force-dynamic';

function toneForVerdict(verdict: string | undefined) {
  switch (verdict) {
    case 'ready':
      return 'success' as const;
    case 'blocked':
      return 'danger' as const;
    default:
      return 'warning' as const;
  }
}

function toneForSeverity(severity: string | undefined) {
  switch (severity) {
    case 'danger':
      return 'danger' as const;
    case 'warning':
      return 'warning' as const;
    default:
      return 'accent' as const;
  }
}

export default async function InternalCommandCenterPage() {
  const summary = await fetchInternalSummary();

  if (summary.kind === 'auth') {
    return <InternalAuthRequired entryUrl={getInternalSsoEntryUrl()} />;
  }

  if (summary.kind === 'error') {
    return (
      <div className="page-stack">
        <PageHeader
          eyebrow="Internal"
          title="Command Center"
          description="Shared operational truth for activation, blockers, and release readiness."
        />
        <div className="error-banner">{summary.message}</div>
      </div>
    );
  }

  const activationOverview = summary.data.activationOverview;
  const derivedStages = deriveFunnelStages(summary.data.funnelSummary?.stages ?? []);
  const largestDropoff = findLargestDropoffStage(summary.data.funnelSummary?.stages ?? []);
  const blockerItems = summary.data.blockerQueue?.items ?? [];
  const runtimeIssues = summary.data.runtimeRedZone?.issues ?? [];
  const releaseGate = summary.data.releaseGate;
  const recentSuccessfulAgents = summary.data.recentSuccessfulAgents?.items ?? [];

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Internal"
        title="Command Center"
        description="Shared operational truth for activation, blocker urgency, runtime health, and release readiness."
        actions={
          releaseGate?.verdict ? (
            <StatusBadge label={releaseGate.verdict} tone={toneForVerdict(releaseGate.verdict)} />
          ) : null
        }
      />

      {summary.data.partials?.length ? (
        <div className="info-banner">
          Partial data available: {summary.data.partials.join(', ')}.
        </div>
      ) : null}

      <div className="metric-grid">
        <MetricCard
          label="New agents · 7d"
          value={activationOverview?.newAgents7d ?? '—'}
          description={`Today: ${activationOverview?.newAgentsToday ?? '—'}`}
        />
        <MetricCard
          label="First actions · 7d"
          value={activationOverview?.firstActionSubmitted7d ?? '—'}
          description={`Today: ${activationOverview?.firstActionSubmittedToday ?? '—'}`}
        />
        <MetricCard
          label="Completed arenas · 7d"
          value={activationOverview?.completedArenas7d ?? '—'}
          description={`Today: ${activationOverview?.completedArenasToday ?? '—'}`}
        />
        <MetricCard
          label="Largest blocker"
          value={activationOverview?.largestBlockerLabel ?? 'No blocker'}
          description={
            activationOverview?.trendDeltaPct != null
              ? `Trend vs prior period: ${Math.round(activationOverview.trendDeltaPct * 100)}%`
              : 'Trend unavailable'
          }
        />
      </div>

      <div className="split-grid">
        <SurfaceCard tone="console" className="surface-card--padded">
          <SectionTitle eyebrow="Funnel" title="Activation stage summary" />
          {derivedStages.length === 0 ? (
            <EmptyState
              title="No funnel data yet"
              description="Once stage rollups land, this table will show where agents are dropping."
            />
          ) : (
            <div className="console-data-table">
              <div
                className="console-data-table__head"
                style={{ gridTemplateColumns: 'minmax(180px,1.2fr) minmax(100px,0.8fr) minmax(120px,0.8fr)' }}
              >
                <span>Stage</span>
                <span>Count</span>
                <span>Conversion</span>
              </div>
              {derivedStages.map((stage) => (
                <div
                  key={stage.stage}
                  className="console-data-table__row"
                  style={{ gridTemplateColumns: 'minmax(180px,1.2fr) minmax(100px,0.8fr) minmax(120px,0.8fr)' }}
                >
                  <span>{formatStageLabel(stage.stage)}</span>
                  <span>{stage.count}</span>
                  <span className="console-data-table__cell--muted">
                    {stage.derivedConversionRate == null
                      ? '—'
                      : `${Math.round(stage.derivedConversionRate * 100)}%`}
                  </span>
                </div>
              ))}
            </div>
          )}
          <div className="inline-meta internal-section-footer">
            <span>
              Largest drop-off:{' '}
              {largestDropoff ? formatStageLabel(largestDropoff.stage) : 'Not enough data'}
            </span>
            {largestDropoff ? <span>Lost: {largestDropoff.dropCount}</span> : null}
          </div>
        </SurfaceCard>

        <SurfaceCard tone="console" className="surface-card--padded">
          <SectionTitle eyebrow="Release" title="Gate status" />
          {releaseGate?.verdict ? (
            <div className="stack-grid">
              <StatusBadge
                label={releaseGate.verdict}
                tone={toneForVerdict(releaseGate.verdict)}
              />
              <div className="inline-meta">
                <span>
                  Updated:{' '}
                  {releaseGate.updatedAt
                    ? new Date(releaseGate.updatedAt).toLocaleString()
                    : 'Unknown'}
                </span>
              </div>
              {(releaseGate.unmetConditions ?? []).length > 0 ? (
                <ul className="internal-simple-list">
                  {(releaseGate.unmetConditions ?? []).map((condition) => (
                    <li key={condition}>{condition}</li>
                  ))}
                </ul>
              ) : (
                <p className="muted-copy">No unmet conditions reported.</p>
              )}
            </div>
          ) : (
            <EmptyState
              title="No gate verdict available"
              description="Once gate data is published, this card will track launch readiness and evidence links."
            />
          )}
        </SurfaceCard>
      </div>

      <div className="supporting-grid">
        <SurfaceCard tone="console" className="surface-card--padded">
          <SectionTitle eyebrow="Recent Wins" title="Latest successful agents" />
          {recentSuccessfulAgents.length === 0 ? (
            <EmptyState
              title="No successful agents yet"
              description="Once agents reach first action or completed arena, the latest successes will appear here."
            />
          ) : (
            <div className="console-list">
              {recentSuccessfulAgents.map((item) => (
                <div key={item.id} className="console-row-card">
                  <div className="console-row-card__body">
                    <div className="console-row-card__title">
                      <h3>{item.displayName}</h3>
                      <StatusBadge label={formatStageLabel(item.stage)} tone="success" />
                    </div>
                    <p className="console-row-card__copy">
                      {item.arenaName
                        ? `Arena: ${item.arenaName}`
                        : 'No arena label recorded'}
                    </p>
                    <div className="console-row-card__meta">
                      <span>{new Date(item.occurredAt).toLocaleString()}</span>
                      {item.arenaId ? <span>{item.arenaId}</span> : null}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </SurfaceCard>

        <SurfaceCard tone="console" className="surface-card--padded">
          <SectionTitle eyebrow="Queue" title="Alpha blocker queue" />
          {blockerItems.length === 0 ? (
            <EmptyState
              title="No blockers right now"
              description="Stuck contacts, overdue follow-ups, and missing notes will appear here."
            />
          ) : (
            <div className="console-list">
              {blockerItems.map((item) => (
                <div key={item.id} className="console-row-card">
                  <div className="console-row-card__body">
                    <div className="console-row-card__title">
                      <h3>{item.title}</h3>
                      {item.owner ? (
                        <StatusBadge label={item.owner} tone="neutral" />
                      ) : null}
                    </div>
                    <p className="console-row-card__copy">{item.reason}</p>
                    <div className="console-row-card__meta">
                      <span>Age: {item.ageHours != null ? `${item.ageHours}h` : 'Unknown'}</span>
                      <span>
                        Next follow-up:{' '}
                        {item.nextFollowUpAt
                          ? new Date(item.nextFollowUpAt).toLocaleString()
                          : 'Unscheduled'}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </SurfaceCard>

        <SurfaceCard tone="console" className="surface-card--padded">
          <SectionTitle eyebrow="Runtime" title="Red zone" />
          {runtimeIssues.length === 0 ? (
            <EmptyState
              title="No runtime incidents reported"
              description="Activation-critical failures will appear here when the runtime health feed publishes them."
            />
          ) : (
            <div className="console-list">
              {runtimeIssues.map((issue) => (
                <div key={issue.id} className="console-row-card">
                  <div className="console-row-card__body">
                    <div className="console-row-card__title">
                      <h3>{issue.label}</h3>
                      <StatusBadge label={issue.severity} tone={toneForSeverity(issue.severity)} />
                    </div>
                    <p className="console-row-card__copy">{issue.detail}</p>
                    {issue.metric ? (
                      <div className="console-row-card__meta">
                        <span>{issue.metric}</span>
                      </div>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </SurfaceCard>
      </div>
    </div>
  );
}

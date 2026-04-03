import {
  EmptyState,
  MetricCard,
  PageHeader,
} from '@/components/chrome';
import { InternalAuthRequired } from '../_components/internal-auth-required';
import { ReleaseGateClient } from '../_components/release-gate-client';
import { fetchInternalReleaseGates, getInternalSsoEntryUrl } from '@/lib/internal/server';
import { summarizeReleaseGates } from '@/lib/internal/view-model';

export const dynamic = 'force-dynamic';

export default async function InternalReleaseGatePage() {
  const response = await fetchInternalReleaseGates();

  if (response.kind === 'auth') {
    return <InternalAuthRequired entryUrl={getInternalSsoEntryUrl()} />;
  }

  if (response.kind === 'error') {
    return (
      <div className="page-stack">
        <PageHeader
          eyebrow="Internal"
          title="Release Gate"
          description="Track go / no-go signals, evidence links, and notes for Phase 1 readiness."
        />
        <div className="error-banner">{response.message}</div>
      </div>
    );
  }

  const gates = response.data.gates ?? [];
  const gateSummary = summarizeReleaseGates(gates);

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Internal"
        title="Release Gate"
        description="Keep launch blockers, watch items, and decision evidence visible in one place."
      />

      <div className="metric-grid">
        <MetricCard
          label="Gate verdict"
          value={gateSummary.verdict}
          description="Conservative aggregate across all tracked checks"
        />
        <MetricCard
          label="Unmet checks"
          value={gateSummary.unmetCount}
          description="Items not yet marked pass"
        />
        <MetricCard
          label="Tracked gates"
          value={gates.length}
          description="Editable launch criteria rows"
        />
        <MetricCard
          label="Last update"
          value={
            gates[0]?.updatedAt
              ? new Date(gates[0].updatedAt).toLocaleDateString()
              : '—'
          }
          description="Most recently touched release gate"
        />
      </div>

      {gates.length === 0 ? (
        <EmptyState
          title="No release gates configured yet"
          description="Seed Phase 1 gate rows in the API layer to unlock editing here."
        />
      ) : (
        <ReleaseGateClient initialGates={gates} />
      )}
    </div>
  );
}

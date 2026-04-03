import {
  EmptyState,
  MetricCard,
  PageHeader,
} from '@/components/chrome';
import { InternalAuthRequired } from '../_components/internal-auth-required';
import { AlphaPipelineClient } from '../_components/alpha-pipeline-client';
import { fetchInternalAlphaContacts, getInternalSsoEntryUrl } from '@/lib/internal/server';
import { summarizeAlphaQueue } from '@/lib/internal/view-model';

export const dynamic = 'force-dynamic';

export default async function InternalAlphaPipelinePage() {
  const response = await fetchInternalAlphaContacts();

  if (response.kind === 'auth') {
    return <InternalAuthRequired entryUrl={getInternalSsoEntryUrl()} />;
  }

  if (response.kind === 'error') {
    return (
      <div className="page-stack">
        <PageHeader
          eyebrow="Internal"
          title="Alpha Pipeline"
          description="Editable roster for owners, blockers, follow-ups, and activation progress."
        />
        <div className="error-banner">{response.message}</div>
      </div>
    );
  }

  const contacts = response.data.contacts ?? [];
  const queueSummary = summarizeAlphaQueue(contacts);

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Internal"
        title="Alpha Pipeline"
        description="Track each external alpha, update ownership, and keep follow-up discipline visible."
      />

      <div className="metric-grid">
        <MetricCard
          label="Contacts"
          value={contacts.length}
          description="Total alpha roster rows loaded"
        />
        <MetricCard
          label="Stuck >24h"
          value={queueSummary.stuckOver24h}
          description="Contacts with no recent progress"
        />
        <MetricCard
          label="Follow-ups overdue"
          value={queueSummary.followUpOverdue}
          description="Rows with a follow-up timestamp in the past"
        />
        <MetricCard
          label="Missing owner note"
          value={queueSummary.missingOwnerNote}
          description="Assigned contacts without a recent note"
        />
      </div>

      {contacts.length === 0 ? (
        <EmptyState
          title="No alpha contacts yet"
          description="Once the Phase 1 business tables are seeded, the editable roster will appear here."
        />
      ) : (
        <AlphaPipelineClient initialContacts={contacts} />
      )}
    </div>
  );
}

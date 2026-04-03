'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { StatusBadge, SurfaceCard } from '@/components/chrome';
import type {
  InternalReleaseGate,
  InternalReleaseGatePatch,
  ReleaseGateStatus,
} from '@/lib/internal/contracts';

const STATUS_OPTIONS: ReleaseGateStatus[] = ['pass', 'watch', 'blocked'];

function badgeTone(status: ReleaseGateStatus) {
  switch (status) {
    case 'pass':
      return 'success' as const;
    case 'watch':
      return 'warning' as const;
    case 'blocked':
      return 'danger' as const;
  }
}

export function ReleaseGateClient({
  initialGates,
}: {
  initialGates: InternalReleaseGate[];
}) {
  const router = useRouter();
  const [gates, setGates] = useState(initialGates);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSave(
    gateId: string,
    payload: InternalReleaseGatePatch,
  ): Promise<void> {
    setSavingId(gateId);
    setError(null);

    try {
      const response = await fetch(`/api/internal/release-gates/${gateId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = (await response.json().catch(() => ({}))) as Partial<{
        error: string;
      }>;

      if (!response.ok) {
        throw new Error(data.error ?? 'Release gate update failed.');
      }

      setGates((current) =>
        current.map((gate) =>
          gate.id === gateId
            ? {
                ...gate,
                ...payload,
                updatedAt: new Date().toISOString(),
              }
            : gate,
        ),
      );
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Release gate update failed.');
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div className="stack-grid">
      {error ? <div className="error-banner">{error}</div> : null}
      {gates.map((gate) => (
        <ReleaseGateCard
          key={gate.id}
          gate={gate}
          saving={savingId === gate.id}
          onSave={(payload) => handleSave(gate.id, payload)}
        />
      ))}
    </div>
  );
}

function ReleaseGateCard({
  gate,
  saving,
  onSave,
}: {
  gate: InternalReleaseGate;
  saving: boolean;
  onSave: (payload: InternalReleaseGatePatch) => Promise<void>;
}) {
  const [status, setStatus] = useState<ReleaseGateStatus>(gate.status);
  const [note, setNote] = useState(gate.note ?? '');
  const [evidenceUrl, setEvidenceUrl] = useState(gate.evidenceUrl ?? '');

  return (
    <SurfaceCard tone="console" className="surface-card--padded">
      <form
        className="field-grid"
        onSubmit={(event) => {
          event.preventDefault();
          void onSave({
            status,
            note: note.trim(),
            evidenceUrl: evidenceUrl.trim() || null,
          });
        }}
      >
        <div className="section-title">
          <div>
            <div className="section-title__eyebrow">Gate</div>
            <h2 className="section-title__text">{gate.gateKey}</h2>
          </div>
          <StatusBadge label={status} tone={badgeTone(status)} />
        </div>

        <div className="inline-meta">
          <span>
            Last update:{' '}
            {gate.updatedAt ? new Date(gate.updatedAt).toLocaleString() : 'Not recorded'}
          </span>
          <span>Updated by: {gate.updatedByEmail ?? 'Unknown'}</span>
        </div>

        <div className="form-field">
          <label className="form-label">Gate status</label>
          <select
            className="text-input"
            value={status}
            onChange={(event) => setStatus(event.target.value as ReleaseGateStatus)}
          >
            {STATUS_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>

        <div className="form-field">
          <label className="form-label">Evidence URL</label>
          <input
            className="text-input mono-copy"
            value={evidenceUrl}
            onChange={(event) => setEvidenceUrl(event.target.value)}
            placeholder="https://..."
          />
        </div>

        <div className="form-field">
          <label className="form-label">Notes</label>
          <textarea
            className="text-area"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Latest gate decision context"
          />
        </div>

        <button type="submit" className="button-primary" disabled={saving}>
          {saving ? 'Saving…' : 'Save gate'}
        </button>
      </form>
    </SurfaceCard>
  );
}

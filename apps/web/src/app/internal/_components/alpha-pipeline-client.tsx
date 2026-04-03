'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { StatusBadge, SurfaceCard } from '@/components/chrome';
import type {
  AlphaContactStatus,
  InternalAlphaContact,
  InternalAlphaContactPatch,
} from '@/lib/internal/contracts';

const STATUS_OPTIONS: AlphaContactStatus[] = [
  'new',
  'contacted',
  'installing',
  'smoke_passed',
  'competing',
  'first_action_submitted',
  'completed_arena',
  'blocked',
  'paused',
  'lost',
];

function formatStatusLabel(status: string): string {
  return status
    .split('_')
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(' ');
}

function toneForStatus(status: AlphaContactStatus) {
  switch (status) {
    case 'completed_arena':
    case 'first_action_submitted':
    case 'smoke_passed':
      return 'success' as const;
    case 'blocked':
    case 'lost':
      return 'danger' as const;
    case 'paused':
    case 'installing':
      return 'warning' as const;
    default:
      return 'accent' as const;
  }
}

export function AlphaPipelineClient({
  initialContacts,
}: {
  initialContacts: InternalAlphaContact[];
}) {
  const router = useRouter();
  const [contacts, setContacts] = useState(initialContacts);
  const [selectedId, setSelectedId] = useState(initialContacts[0]?.id ?? null);
  const [ownerEmail, setOwnerEmail] = useState('');
  const [status, setStatus] = useState<AlphaContactStatus>('new');
  const [currentBlocker, setCurrentBlocker] = useState('');
  const [nextFollowUpAt, setNextFollowUpAt] = useState('');
  const [notes, setNotes] = useState('');
  const [tags, setTags] = useState('');
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const selectedContact = useMemo(
    () => contacts.find((contact) => contact.id === selectedId) ?? null,
    [contacts, selectedId],
  );

  useEffect(() => {
    if (!selectedContact) return;
    setOwnerEmail(selectedContact.ownerEmail ?? '');
    setStatus(selectedContact.status);
    setCurrentBlocker(selectedContact.currentBlocker ?? '');
    setNextFollowUpAt(selectedContact.nextFollowUpAt ?? '');
    setNotes(selectedContact.notes ?? '');
    setTags((selectedContact.tags ?? []).join(', '));
    setFeedback(null);
    setError(null);
  }, [selectedContact]);

  async function handleSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedContact) return;

    const payload: InternalAlphaContactPatch = {
      ownerEmail: ownerEmail.trim(),
      status,
      currentBlocker: currentBlocker.trim(),
      nextFollowUpAt: nextFollowUpAt.trim() || null,
      notes: notes.trim(),
      tags: tags
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean),
    };

    setSaving(true);
    setFeedback(null);
    setError(null);

    try {
      const response = await fetch(`/api/internal/alpha-contacts/${selectedContact.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = (await response.json().catch(() => ({}))) as Partial<{
        error: string;
        contact: InternalAlphaContact;
      }>;

      if (!response.ok) {
        throw new Error(data.error ?? 'Alpha contact update failed.');
      }

      setContacts((current) =>
        current.map((contact) =>
          contact.id === selectedContact.id
            ? { ...contact, ...payload, tags: payload.tags ?? [] }
            : contact,
        ),
      );
      setFeedback('Saved. Refreshing server data…');
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Alpha contact update failed.');
    } finally {
      setSaving(false);
    }
  }

  if (contacts.length === 0) {
    return null;
  }

  return (
    <div className="split-grid">
      <SurfaceCard tone="console" className="surface-card--padded">
        <div className="section-title">
          <div>
            <div className="section-title__eyebrow">Roster</div>
            <h2 className="section-title__text">Active alpha operators</h2>
          </div>
        </div>
        <div className="console-data-table">
          <div
            className="console-data-table__head"
            style={{
              gridTemplateColumns:
                'minmax(160px,1.3fr) minmax(110px,0.8fr) minmax(140px,1fr) minmax(140px,1fr) minmax(160px,1fr)',
            }}
          >
            <span>Contact</span>
            <span>Status</span>
            <span>Owner</span>
            <span>Next Follow-up</span>
            <span>Blocker</span>
          </div>
          {contacts.map((contact) => (
            <button
              key={contact.id}
              type="button"
              className="console-data-table__row internal-table-button"
              style={{
                gridTemplateColumns:
                  'minmax(160px,1.3fr) minmax(110px,0.8fr) minmax(140px,1fr) minmax(140px,1fr) minmax(160px,1fr)',
              }}
              onClick={() => setSelectedId(contact.id)}
            >
              <span className="internal-table-button__primary">
                {contact.displayName}
                <span className="console-data-table__cell--muted">{contact.source}</span>
              </span>
              <span>
                <StatusBadge
                  label={formatStatusLabel(contact.status)}
                  tone={toneForStatus(contact.status)}
                />
              </span>
              <span className="console-data-table__cell--muted">
                {contact.ownerEmail ?? 'Unassigned'}
              </span>
              <span className="console-data-table__cell--muted">
                {contact.nextFollowUpAt
                  ? new Date(contact.nextFollowUpAt).toLocaleString()
                  : 'Not scheduled'}
              </span>
              <span className="console-data-table__cell--muted">
                {contact.currentBlocker ?? '—'}
              </span>
            </button>
          ))}
        </div>
      </SurfaceCard>

      <SurfaceCard tone="console" className="surface-card--padded">
        {selectedContact ? (
          <form className="field-grid" onSubmit={handleSave}>
            <div className="section-title">
              <div>
                <div className="section-title__eyebrow">Detail drawer</div>
                <h2 className="section-title__text">{selectedContact.displayName}</h2>
              </div>
              <StatusBadge
                label={formatStatusLabel(selectedContact.status)}
                tone={toneForStatus(selectedContact.status)}
              />
            </div>

            <div className="inline-meta">
              <span>Source: {selectedContact.source}</span>
              <span>Last activity: {selectedContact.lastActivityAt ? new Date(selectedContact.lastActivityAt).toLocaleString() : 'No activity yet'}</span>
            </div>

            <div className="form-field">
              <label className="form-label">Owner email</label>
              <input
                className="text-input"
                value={ownerEmail}
                onChange={(event) => setOwnerEmail(event.target.value)}
                placeholder="owner@singularity-x.ai"
              />
            </div>

            <div className="form-field">
              <label className="form-label">Status</label>
              <select
                className="text-input"
                value={status}
                onChange={(event) => setStatus(event.target.value as AlphaContactStatus)}
              >
                {STATUS_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {formatStatusLabel(option)}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-field">
              <label className="form-label">Current blocker</label>
              <input
                className="text-input"
                value={currentBlocker}
                onChange={(event) => setCurrentBlocker(event.target.value)}
                placeholder="Wallet auth stalled"
              />
            </div>

            <div className="form-field">
              <label className="form-label">Next follow-up (ISO timestamp)</label>
              <input
                className="text-input mono-copy"
                value={nextFollowUpAt}
                onChange={(event) => setNextFollowUpAt(event.target.value)}
                placeholder="2026-04-04T10:00:00.000Z"
              />
            </div>

            <div className="form-field">
              <label className="form-label">Tags</label>
              <input
                className="text-input"
                value={tags}
                onChange={(event) => setTags(event.target.value)}
                placeholder="design partner, mobile, priority"
              />
            </div>

            <div className="form-field">
              <label className="form-label">Notes</label>
              <textarea
                className="text-area"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="Latest owner note or next action"
              />
            </div>

            {feedback ? <div className="success-banner">{feedback}</div> : null}
            {error ? <div className="error-banner">{error}</div> : null}

            <button type="submit" className="button-primary" disabled={saving}>
              {saving ? 'Saving…' : 'Save contact'}
            </button>
          </form>
        ) : null}
      </SurfaceCard>
    </div>
  );
}

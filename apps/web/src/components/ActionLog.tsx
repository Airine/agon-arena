'use client';

import type { ActionEntry } from '../hooks/useArenaSocket';

const ACTION_COLORS: Record<string, string> = {
  fold: '#718096',
  check: '#68d391',
  call: '#63b3ed',
  raise: '#f6ad55',
  all_in: '#fc8181',
};

const ACTION_LABELS: Record<string, string> = {
  fold: 'Folded',
  check: 'Checked',
  call: 'Called',
  raise: 'Raised',
  all_in: 'All-In',
};

interface ActionLogProps {
  actions: ActionEntry[];
}

export default function ActionLog({ actions }: ActionLogProps) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: 'var(--card-bg)',
        borderRadius: '8px',
        border: '1px solid var(--border)',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          padding: '12px 16px',
          borderBottom: '1px solid var(--border)',
          fontWeight: 600,
          fontSize: '14px',
          color: 'var(--fg)',
          flexShrink: 0,
        }}
      >
        Action Log
      </div>

      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '8px',
        }}
      >
        {actions.length === 0 && (
          <div
            style={{
              textAlign: 'center',
              color: 'var(--muted)',
              fontSize: '13px',
              padding: '24px 0',
            }}
          >
            Waiting for game actions...
          </div>
        )}

        {actions.map((entry) => {
          if (entry.type === 'hand_start') {
            return (
              <div
                key={entry.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  margin: '8px 0',
                  padding: '6px 8px',
                  background: '#1a2332',
                  borderRadius: '4px',
                  borderLeft: '3px solid var(--accent)',
                }}
              >
                <span style={{ fontSize: '11px', color: 'var(--accent)', fontWeight: 600 }}>
                  HAND #{entry.handNumber}
                </span>
                <span style={{ fontSize: '11px', color: 'var(--muted)' }}>New hand started</span>
              </div>
            );
          }

          if (entry.type === 'hand_end') {
            const winnerSummary = entry.winners
              ?.map((w) => `${w.agentId.slice(0, 8)}… +$${w.amount}`)
              .join(', ');
            return (
              <div
                key={entry.id}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '2px',
                  margin: '8px 0',
                  padding: '6px 8px',
                  background: '#1a2b1a',
                  borderRadius: '4px',
                  borderLeft: '3px solid #68d391',
                }}
              >
                <span style={{ fontSize: '11px', color: '#68d391', fontWeight: 600 }}>
                  Hand #{entry.handNumber} ended
                </span>
                {winnerSummary && (
                  <span style={{ fontSize: '10px', color: 'var(--muted)' }}>
                    {winnerSummary}
                  </span>
                )}
              </div>
            );
          }

          // Regular action
          const actionType = entry.action?.type ?? 'fold';
          const color = ACTION_COLORS[actionType] ?? '#fff';
          const label = ACTION_LABELS[actionType] ?? actionType;
          const amount = entry.action?.amount;

          return (
            <div
              key={entry.id}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '8px',
                padding: '6px 8px',
                borderRadius: '4px',
                marginBottom: '2px',
              }}
            >
              {/* Agent thought bubble placeholder */}
              <div
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: '50%',
                  background: '#2d3748',
                  border: '1px solid var(--border)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '10px',
                  color: 'var(--muted)',
                  flexShrink: 0,
                  fontWeight: 600,
                }}
              >
                {(entry.agentName ?? 'A').slice(0, 1).toUpperCase()}
              </div>

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span
                    style={{
                      fontSize: '12px',
                      fontWeight: 600,
                      color: 'var(--fg)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      maxWidth: 120,
                    }}
                  >
                    {entry.agentName ?? entry.agentId}
                  </span>

                  <span
                    style={{
                      fontSize: '11px',
                      fontWeight: 600,
                      color,
                      padding: '1px 6px',
                      background: `${color}22`,
                      borderRadius: '4px',
                      border: `1px solid ${color}44`,
                    }}
                  >
                    {label}
                    {amount != null ? ` $${amount.toLocaleString()}` : ''}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

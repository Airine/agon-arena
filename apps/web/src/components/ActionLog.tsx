'use client';

import { useState, useRef, useEffect } from 'react';
import type { ActionEntry } from '../hooks/useArenaSocket';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

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

// Deterministic avatar hue from agent name
function agentHue(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return Math.abs(hash) % 360;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/** Coloured avatar circle with agent initial */
function AgentAvatar({ name }: { name: string }) {
  const hue = agentHue(name);
  return (
    <div
      style={{
        width: 30,
        height: 30,
        borderRadius: '50%',
        background: `hsl(${hue},55%,28%)`,
        border: `2px solid hsl(${hue},55%,45%)`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '11px',
        fontWeight: 700,
        color: `hsl(${hue},80%,85%)`,
        flexShrink: 0,
        userSelect: 'none',
      }}
    >
      {name.slice(0, 1).toUpperCase()}
    </div>
  );
}

/** Action badge pill */
function ActionBadge({ type, amount }: { type: string; amount?: number }) {
  const color = ACTION_COLORS[type] ?? '#a0aec0';
  const label = ACTION_LABELS[type] ?? type;
  return (
    <span
      style={{
        fontSize: '11px',
        fontWeight: 700,
        color,
        padding: '2px 7px',
        background: `${color}20`,
        borderRadius: '4px',
        border: `1px solid ${color}50`,
        letterSpacing: '0.03em',
        whiteSpace: 'nowrap',
      }}
    >
      {label}
      {amount != null ? ` $${amount.toLocaleString()}` : ''}
    </span>
  );
}

/** Thought-chain bubble that expands on click */
function ThoughtBubble({ entry }: { entry: ActionEntry }) {
  const [expanded, setExpanded] = useState(false);
  const actionType = entry.action?.type ?? 'fold';
  const color = ACTION_COLORS[actionType] ?? '#a0aec0';

  return (
    <div
      onClick={() => setExpanded((v) => !v)}
      style={{
        cursor: 'pointer',
        marginTop: 4,
        padding: '5px 8px',
        borderRadius: '6px',
        background: '#111827',
        border: `1px solid ${color}30`,
        fontSize: '11px',
        color: 'var(--muted)',
        lineHeight: 1.5,
        transition: 'background 0.15s',
      }}
      title="Click to expand thought chain"
    >
      {expanded ? (
        <div>
          <div style={{ color: `${color}`, fontWeight: 600, marginBottom: 3 }}>
            🧠 Decision context
          </div>
          <div>
            Action:{' '}
            <span style={{ color }}>{actionType}</span>
            {entry.action?.amount != null && (
              <span> · Amount: <span style={{ color: '#f6ad55' }}>${entry.action.amount.toLocaleString()}</span></span>
            )}
          </div>
          {entry.handNumber != null && (
            <div>Hand: <span style={{ color: 'var(--fg)' }}>#{entry.handNumber}</span></div>
          )}
          {entry.latencyMs != null && (
            <div>
              Server latency:{' '}
              <span style={{ color: entry.latencyMs < 50 ? '#68d391' : entry.latencyMs < 100 ? '#f6ad55' : '#fc8181' }}>
                {entry.latencyMs}ms
              </span>
            </div>
          )}
          <div style={{ color: '#4a5568', marginTop: 2 }}>{formatTime(entry.timestamp)}</div>
        </div>
      ) : (
        <span style={{ opacity: 0.7 }}>
          ···{' '}
          <span style={{ fontSize: '10px' }}>click for details</span>
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Entry renderers
// ---------------------------------------------------------------------------

function HandStartEntry({ entry }: { entry: ActionEntry }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        margin: '10px 0 4px',
        padding: '6px 10px',
        background: 'linear-gradient(90deg, #1a2332 0%, #111827 100%)',
        borderRadius: '4px',
        borderLeft: '3px solid var(--accent)',
      }}
    >
      <span style={{ fontSize: '11px', color: 'var(--accent)', fontWeight: 700 }}>
        HAND #{entry.handNumber}
      </span>
      <span style={{ fontSize: '11px', color: 'var(--muted)', flex: 1 }}>New hand dealt</span>
      <span style={{ fontSize: '10px', color: '#4a5568' }}>{formatTime(entry.timestamp)}</span>
    </div>
  );
}

function HandEndEntry({ entry }: { entry: ActionEntry }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div
      style={{
        margin: '4px 0 10px',
        padding: '6px 10px',
        background: 'linear-gradient(90deg, #0f2b1a 0%, #111827 100%)',
        borderRadius: '4px',
        borderLeft: '3px solid #68d391',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          cursor: entry.winners && entry.winners.length > 0 ? 'pointer' : 'default',
        }}
        onClick={() => entry.winners && setExpanded((v) => !v)}
      >
        <span style={{ fontSize: '11px', color: '#68d391', fontWeight: 700 }}>
          Hand #{entry.handNumber} ended
        </span>
        {entry.winners && entry.winners.length > 0 && (
          <span style={{ fontSize: '10px', color: '#4a5568' }}>
            {expanded ? '▲' : '▼'}
          </span>
        )}
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: '10px', color: '#4a5568' }}>{formatTime(entry.timestamp)}</span>
      </div>

      {expanded && entry.winners && (
        <div style={{ marginTop: 6 }}>
          {entry.winners.map((w, i) => (
            <div
              key={`${w.agentId}-${i}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '3px 0',
                fontSize: '11px',
              }}
            >
              <span style={{ color: '#fbd38d', fontWeight: 600 }}>🏆</span>
              <span style={{ color: 'var(--fg)', fontWeight: 600 }}>
                {w.agentId.length > 16 ? `${w.agentId.slice(0, 8)}…` : w.agentId}
              </span>
              <span style={{ color: '#68d391', fontWeight: 700 }}>+${w.amount.toLocaleString()}</span>
              {w.handDescription && (
                <span style={{ color: 'var(--muted)', fontStyle: 'italic' }}>
                  {w.handDescription}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ActionEntry_({ entry }: { entry: ActionEntry }) {
  const agentName = entry.agentName ?? entry.agentId ?? 'Agent';
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: '8px',
        padding: '5px 4px',
        borderRadius: '4px',
        marginBottom: '1px',
      }}
    >
      <AgentAvatar name={agentName} />

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
          <span
            style={{
              fontSize: '12px',
              fontWeight: 600,
              color: 'var(--fg)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              maxWidth: 110,
            }}
            title={agentName}
          >
            {agentName}
          </span>
          <ActionBadge type={entry.action?.type ?? 'fold'} amount={entry.action?.amount} />
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: '10px', color: '#4a5568', flexShrink: 0 }}>
            {formatTime(entry.timestamp)}
          </span>
        </div>
        <ThoughtBubble entry={entry} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface ActionLogProps {
  actions: ActionEntry[];
}

export default function ActionLog({ actions }: ActionLogProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  // Auto-scroll to top (newest actions are prepended)
  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
  }, [actions.length, autoScroll]);

  const handleScroll = () => {
    if (!scrollRef.current) return;
    // Re-enable auto-scroll only when user is near the top
    setAutoScroll(scrollRef.current.scrollTop < 40);
  };

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
      {/* Header */}
      <div
        style={{
          padding: '10px 14px',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          flexShrink: 0,
        }}
      >
        <span style={{ fontWeight: 700, fontSize: '13px', color: 'var(--fg)' }}>Action Log</span>
        {actions.length > 0 && (
          <span
            style={{
              fontSize: '10px',
              padding: '1px 6px',
              borderRadius: '10px',
              background: '#1a3a5c',
              color: '#63b3ed',
              border: '1px solid #2a5a8c',
            }}
          >
            {actions.length}
          </span>
        )}
        <span style={{ flex: 1 }} />
        {!autoScroll && (
          <button
            onClick={() => {
              setAutoScroll(true);
              if (scrollRef.current) scrollRef.current.scrollTop = 0;
            }}
            style={{
              fontSize: '10px',
              padding: '2px 8px',
              borderRadius: '4px',
              background: '#1a3a5c',
              color: '#63b3ed',
              border: '1px solid #2a5a8c',
              cursor: 'pointer',
            }}
          >
            ↑ Latest
          </button>
        )}
      </div>

      {/* Scrollable log */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '8px',
          scrollBehavior: 'smooth',
        }}
      >
        {actions.length === 0 && (
          <div
            style={{
              textAlign: 'center',
              color: 'var(--muted)',
              fontSize: '13px',
              padding: '32px 0',
            }}
          >
            <div style={{ fontSize: '24px', marginBottom: 8 }}>🃏</div>
            Waiting for game actions…
          </div>
        )}

        {actions.map((entry) => {
          if (entry.type === 'hand_start') return <HandStartEntry key={entry.id} entry={entry} />;
          if (entry.type === 'hand_end') return <HandEndEntry key={entry.id} entry={entry} />;
          if (entry.type === 'arena_finished') {
            return (
              <div
                key={entry.id}
                style={{
                  textAlign: 'center',
                  padding: '8px',
                  color: '#fc8181',
                  fontSize: '12px',
                  fontWeight: 600,
                }}
              >
                Arena finished
              </div>
            );
          }
          return <ActionEntry_ key={entry.id} entry={entry} />;
        })}
      </div>
    </div>
  );
}

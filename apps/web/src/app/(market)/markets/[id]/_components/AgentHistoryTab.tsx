'use client';

import { useEffect, useState, useCallback } from 'react';
import { buildApiUrl } from '@/lib/api';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TurnRow {
  id: string;
  agentId: string;
  turnId: string;
  turnNumber: number;
  state: unknown;
  action: unknown; // null if timed out
  latencyMs: number | null;
  createdAt: string;
}

interface TraceRow {
  id: string;
  agentId: string;
  turnId: string | null;
  errorType: 'timeout' | 'invalid_action' | 'connection_lost' | 'schema_error';
  details: unknown;
  createdAt: string;
}

interface AgentInfo {
  agentId: string;
  agentName: string;
}

interface AgentHistoryTabProps {
  arenaId: string;
  agents: AgentInfo[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatDateTimestamp(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('en-US', {
    hour12: false,
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function formatAction(action: unknown): string {
  if (action == null) return 'timeout';
  if (typeof action !== 'object') return String(action);
  const a = action as Record<string, unknown>;
  const type = a.type as string | undefined;
  if (!type) return '—';
  // Poker
  if (type === 'fold') return 'fold';
  if (type === 'check') return 'check';
  if (type === 'call') return a.amount != null ? `call ${a.amount}` : 'call';
  if (type === 'raise') return a.amount != null ? `raise ${a.amount}` : 'raise';
  if (type === 'all_in') return a.amount != null ? `all-in ${a.amount}` : 'all-in';
  // LOB
  if (type === 'bid') return a.price != null ? `bid @ ${a.price}` : 'bid';
  if (type === 'ask') return a.price != null ? `ask @ ${a.price}` : 'ask';
  if (type === 'pass') return 'pass';
  return type;
}

const ERROR_TYPE_STYLES: Record<string, { label: string; color: string; bg: string }> = {
  timeout: { label: 'TIMEOUT', color: '#F97316', bg: 'rgba(249,115,22,0.12)' },
  invalid_action: { label: 'INVALID', color: '#EF4444', bg: 'rgba(239,68,68,0.12)' },
  schema_error: { label: 'SCHEMA', color: '#9B7FFF', bg: 'rgba(155,127,255,0.12)' },
  connection_lost: { label: 'CONN LOST', color: '#6B7280', bg: 'rgba(107,114,128,0.12)' },
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function LatencyCell({ ms }: { ms: number | null }) {
  if (ms == null) {
    return (
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-faint)' }}>
        —
      </span>
    );
  }
  const isHigh = ms > 2000;
  return (
    <span
      style={{
        fontFamily: 'var(--font-mono)',
        fontSize: 11,
        color: isHigh ? '#EF4444' : 'var(--ink-soft)',
        fontWeight: isHigh ? 600 : 400,
      }}
    >
      {ms.toLocaleString()}ms
    </span>
  );
}

function ErrorBadge({ errorType }: { errorType: string }) {
  const style = ERROR_TYPE_STYLES[errorType] ?? { label: errorType.toUpperCase(), color: '#6B7280', bg: 'rgba(107,114,128,0.12)' };
  return (
    <span
      style={{
        fontFamily: 'var(--font-mono)',
        fontSize: 10,
        letterSpacing: '0.08em',
        color: style.color,
        background: style.bg,
        border: `0.5px solid ${style.color}`,
        borderRadius: 4,
        padding: '2px 6px',
        whiteSpace: 'nowrap',
      }}
    >
      {style.label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Error trace collapsible agent block
// ---------------------------------------------------------------------------

function AgentErrorBlock({
  agentName,
  traces,
}: {
  agentName: string;
  traces: TraceRow[];
}) {
  const [open, setOpen] = useState(false);

  return (
    <div
      style={{
        borderBottom: '0.5px solid var(--border)',
      }}
    >
      {/* Header */}
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          width: '100%',
          padding: '8px 14px',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            color: 'var(--ink-faint)',
            transition: 'transform 0.15s',
            transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
            display: 'inline-block',
          }}
        >
          ▶
        </span>
        <span
          style={{
            fontFamily: 'var(--font-serif)',
            fontSize: 12,
            fontWeight: 700,
            color: 'var(--ink)',
            flex: 1,
          }}
        >
          {agentName}
        </span>
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            color: '#EF4444',
            letterSpacing: '0.05em',
          }}
        >
          {traces.length} error{traces.length !== 1 ? 's' : ''}
        </span>
      </button>

      {/* Rows */}
      {open && (
        <div style={{ paddingBottom: 4 }}>
          {traces.map((trace) => {
            const detailStr =
              trace.details != null
                ? typeof trace.details === 'string'
                  ? trace.details
                  : JSON.stringify(trace.details)
                : null;

            return (
              <div
                key={trace.id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '120px 100px 1fr',
                  gap: 8,
                  padding: '5px 14px 5px 32px',
                  alignItems: 'start',
                  borderTop: '0.5px solid var(--border)',
                }}
              >
                <span
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 10,
                    color: 'var(--ink-faint)',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {formatDateTimestamp(trace.createdAt)}
                </span>
                <ErrorBadge errorType={trace.errorType} />
                {detailStr && (
                  <span
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 10,
                      color: 'var(--ink-soft)',
                      wordBreak: 'break-all',
                      lineHeight: 1.5,
                    }}
                  >
                    {detailStr.length > 120 ? detailStr.slice(0, 120) + '…' : detailStr}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function AgentHistoryTab({ arenaId, agents }: AgentHistoryTabProps) {
  const [turns, setTurns] = useState<TurnRow[]>([]);
  const [traces, setTraces] = useState<TraceRow[]>([]);
  const [turnsLoading, setTurnsLoading] = useState(true);
  const [tracesLoading, setTracesLoading] = useState(true);

  // Build name lookup from arena seats
  const nameMap = new Map(agents.map((a) => [a.agentId, a.agentName]));

  const fetchTurns = useCallback(() => {
    fetch(buildApiUrl(`/arenas/${arenaId}/turns?limit=200`))
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data: { turns: TurnRow[]; total: number }) => {
        setTurns(
          [...(data.turns ?? [])].sort((a, b) => b.turnNumber - a.turnNumber),
        );
      })
      .catch(() => {
        // silently keep stale data
      })
      .finally(() => setTurnsLoading(false));
  }, [arenaId]);

  const fetchTraces = useCallback(() => {
    // Fetch traces for every agent in the arena in parallel
    const agentIds = agents.map((a) => a.agentId);
    if (agentIds.length === 0) {
      setTracesLoading(false);
      return;
    }
    Promise.all(
      agentIds.map((agentId) =>
        fetch(buildApiUrl(`/arenas/${arenaId}/agents/${agentId}/traces?limit=50`))
          .then((r) => (r.ok ? r.json() : { traces: [] }))
          .then((data: { traces: TraceRow[] }) => data.traces ?? [])
          .catch(() => [] as TraceRow[]),
      ),
    )
      .then((results) => {
        const all = results.flat().sort(
          (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        );
        setTraces(all);
      })
      .finally(() => setTracesLoading(false));
  }, [arenaId, agents]);

  // Initial fetch + polling
  useEffect(() => {
    fetchTurns();
    fetchTraces();

    const turnsTimer = setInterval(fetchTurns, 10_000);
    const tracesTimer = setInterval(fetchTraces, 30_000);
    return () => {
      clearInterval(turnsTimer);
      clearInterval(tracesTimer);
    };
  }, [fetchTurns, fetchTraces]);

  // Group traces by agentId
  const tracesByAgent = new Map<string, TraceRow[]>();
  for (const trace of traces) {
    const list = tracesByAgent.get(trace.agentId) ?? [];
    list.push(trace);
    tracesByAgent.set(trace.agentId, list);
  }

  const hasErrors = traces.length > 0;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
        padding: '16px 0',
      }}
    >
      {/* ------------------------------------------------------------------ */}
      {/* Turn History Table                                                   */}
      {/* ------------------------------------------------------------------ */}
      <div
        style={{
          border: '0.5px solid var(--border)',
          borderRadius: 8,
          overflow: 'hidden',
        }}
      >
        {/* Section header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '10px 14px',
            borderBottom: '0.5px solid var(--border)',
            background: 'var(--bg2)',
          }}
        >
          <span
            style={{
              fontFamily: 'var(--font-serif)',
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: '0.10em',
              textTransform: 'uppercase',
              color: 'var(--ink-soft)',
            }}
          >
            Turn History
          </span>
          {!turnsLoading && (
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                color: 'var(--ink-faint)',
                letterSpacing: '0.06em',
              }}
            >
              {turns.length} turns
            </span>
          )}
        </div>

        {turnsLoading ? (
          <div
            style={{
              padding: '20px 14px',
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              color: 'var(--ink-faint)',
            }}
          >
            Loading…
          </div>
        ) : turns.length === 0 ? (
          <div
            style={{
              padding: '20px 14px',
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              color: 'var(--ink-faint)',
            }}
          >
            No turns recorded yet.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table
              style={{
                width: '100%',
                borderCollapse: 'collapse',
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
              }}
            >
              <thead>
                <tr
                  style={{
                    background: 'var(--bg3)',
                    borderBottom: '0.5px solid var(--border)',
                  }}
                >
                  {(['Turn #', 'Agent', 'Action', 'Latency', 'Time'] as const).map((col) => (
                    <th
                      key={col}
                      style={{
                        padding: '7px 12px',
                        textAlign: 'left',
                        fontFamily: 'var(--font-mono)',
                        fontSize: 10,
                        fontWeight: 600,
                        letterSpacing: '0.10em',
                        textTransform: 'uppercase',
                        color: 'var(--ink-faint)',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {turns.map((turn, i) => {
                  const agentName = nameMap.get(turn.agentId) ?? turn.agentId.slice(0, 8);
                  const isTimedOut = turn.action == null;
                  return (
                    <tr
                      key={turn.id}
                      style={{
                        borderBottom: '0.5px solid var(--border)',
                        background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.012)',
                      }}
                    >
                      {/* Turn # */}
                      <td
                        style={{
                          padding: '7px 12px',
                          fontFamily: 'var(--font-mono)',
                          fontSize: 11,
                          color: 'var(--gold)',
                          letterSpacing: '0.06em',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {turn.turnNumber}
                      </td>

                      {/* Agent */}
                      <td
                        style={{
                          padding: '7px 12px',
                          color: 'var(--ink)',
                          fontFamily: 'var(--font-mono)',
                          fontSize: 11,
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {agentName}
                      </td>

                      {/* Action */}
                      <td
                        style={{
                          padding: '7px 12px',
                          fontFamily: 'var(--font-mono)',
                          fontSize: 11,
                          color: isTimedOut ? '#F97316' : 'var(--ink-soft)',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {formatAction(turn.action)}
                      </td>

                      {/* Latency */}
                      <td style={{ padding: '7px 12px', whiteSpace: 'nowrap' }}>
                        <LatencyCell ms={turn.latencyMs} />
                      </td>

                      {/* Time */}
                      <td
                        style={{
                          padding: '7px 12px',
                          fontFamily: 'var(--font-mono)',
                          fontSize: 10,
                          color: 'var(--ink-faint)',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {formatTimestamp(turn.createdAt)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Error Trace Panel                                                    */}
      {/* ------------------------------------------------------------------ */}
      <div
        style={{
          border: '0.5px solid var(--border)',
          borderRadius: 8,
          overflow: 'hidden',
        }}
      >
        {/* Section header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '10px 14px',
            borderBottom: '0.5px solid var(--border)',
            background: 'var(--bg2)',
          }}
        >
          <span
            style={{
              fontFamily: 'var(--font-serif)',
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: '0.10em',
              textTransform: 'uppercase',
              color: 'var(--ink-soft)',
            }}
          >
            Error Traces
          </span>
          {hasErrors && !tracesLoading && (
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                color: '#EF4444',
                letterSpacing: '0.06em',
              }}
            >
              {traces.length} total
            </span>
          )}
        </div>

        {tracesLoading ? (
          <div
            style={{
              padding: '20px 14px',
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              color: 'var(--ink-faint)',
            }}
          >
            Loading…
          </div>
        ) : !hasErrors ? (
          <div
            style={{
              padding: '20px 14px',
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              color: 'var(--ink-faint)',
              letterSpacing: '0.06em',
            }}
          >
            No errors recorded
          </div>
        ) : (
          <div>
            {agents
              .filter((a) => tracesByAgent.has(a.agentId))
              .map((a) => (
                <AgentErrorBlock
                  key={a.agentId}
                  agentName={a.agentName}
                  traces={tracesByAgent.get(a.agentId) ?? []}
                />
              ))}
          </div>
        )}
      </div>
    </div>
  );
}

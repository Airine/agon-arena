'use client';

import { useEffect, useState, useCallback } from 'react';
import { buildApiUrl } from '@/lib/api';
import { fetchAgentTraces, type TraceRow } from './traceAggregation';

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

interface AgentInfo {
  agentId: string;
  agentName: string;
}

interface AgentHistoryTabProps {
  arenaId: string;
  agents: AgentInfo[];
  focusedAgentId?: string | null;
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

// Design-token-aligned error type styles
const ERROR_TYPE_STYLES: Record<string, { label: string; color: string }> = {
  timeout:         { label: 'TIMEOUT',   color: 'var(--gold)' },
  invalid_action:  { label: 'INVALID',   color: 'var(--red)' },
  schema_error:    { label: 'SCHEMA',    color: 'var(--purple)' },
  connection_lost: { label: 'CONN LOST', color: 'var(--ink-faint)' },
};

// ---------------------------------------------------------------------------
// Stack delta helpers
// ---------------------------------------------------------------------------

function getAgentStack(state: unknown, agentId: string): number | null {
  if (!state || typeof state !== 'object') return null;
  const s = state as { players?: Array<{ agentId?: string; stack?: number }> };
  const player = s.players?.find((p) => p.agentId === agentId);
  return typeof player?.stack === 'number' ? player.stack : null;
}

/** Returns a map from turn.id → chip delta vs the previous turn for that agent. */
function buildStackDeltas(turns: TurnRow[]): Map<string, number | null> {
  const byAgent = new Map<string, TurnRow[]>();
  for (const t of turns) {
    const list = byAgent.get(t.agentId) ?? [];
    list.push(t);
    byAgent.set(t.agentId, list);
  }
  const deltas = new Map<string, number | null>();
  for (const agentTurns of byAgent.values()) {
    const sorted = [...agentTurns].sort((a, b) => a.turnNumber - b.turnNumber);
    for (let i = 0; i < sorted.length; i++) {
      const cur = sorted[i]!;
      if (i === 0) {
        deltas.set(cur.id, null);
      } else {
        const prev = sorted[i - 1]!;
        const curStack = getAgentStack(cur.state, cur.agentId);
        const prevStack = getAgentStack(prev.state, prev.agentId);
        deltas.set(
          cur.id,
          curStack !== null && prevStack !== null ? curStack - prevStack : null,
        );
      }
    }
  }
  return deltas;
}

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
        color: isHigh ? 'var(--red)' : 'var(--ink-soft)',
        fontWeight: isHigh ? 600 : 400,
      }}
    >
      {ms.toLocaleString()}ms
    </span>
  );
}

function ErrorBadge({ errorType }: { errorType: string }) {
  const style = ERROR_TYPE_STYLES[errorType] ?? { label: errorType.toUpperCase(), color: 'var(--ink-faint)' };
  return (
    <span
      style={{
        fontFamily: 'var(--font-mono)',
        fontSize: 10,
        letterSpacing: '0.08em',
        color: style.color,
        background: `color-mix(in srgb, ${style.color} 12%, transparent)`,
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
        aria-expanded={open}
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
            color: 'var(--red)',
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
// Inline error + retry widget
// ---------------------------------------------------------------------------

function FetchError({ onRetry }: { onRetry: () => void }) {
  return (
    <div
      style={{
        padding: '16px 14px',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
      }}
    >
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 11,
          color: 'var(--red)',
        }}
      >
        Failed to load data.
      </span>
      <button
        onClick={onRetry}
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 10,
          letterSpacing: '0.08em',
          color: 'var(--gold)',
          background: 'none',
          border: '0.5px solid var(--gold)',
          borderRadius: 4,
          padding: '3px 8px',
          cursor: 'pointer',
        }}
      >
        RETRY
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function AgentHistoryTab({ arenaId, agents, focusedAgentId }: AgentHistoryTabProps) {
  const [turns, setTurns] = useState<TurnRow[]>([]);
  const [traces, setTraces] = useState<TraceRow[]>([]);
  const [turnsLoading, setTurnsLoading] = useState(true);
  const [tracesLoading, setTracesLoading] = useState(true);
  const [turnsError, setTurnsError] = useState(false);
  const [tracesError, setTracesError] = useState(false);

  // Build name lookup from arena seats
  const nameMap = new Map(agents.map((a) => [a.agentId, a.agentName]));

  const fetchTurns = useCallback(() => {
    setTurnsError(false);
    fetch(buildApiUrl(`/arenas/${arenaId}/turns?limit=200`))
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status}`))))
      .then((data: { turns: TurnRow[]; total: number }) => {
        setTurns(
          [...(data.turns ?? [])].sort((a, b) => b.turnNumber - a.turnNumber),
        );
      })
      .catch(() => {
        setTurnsError(true);
      })
      .finally(() => setTurnsLoading(false));
  }, [arenaId]);

  const fetchTraces = useCallback(() => {
    setTracesError(false);
    const agentIds = agents.map((a) => a.agentId);
    if (agentIds.length === 0) {
      setTraces([]);
      setTracesLoading(false);
      return;
    }
    fetchAgentTraces({ arenaId, agentIds })
      .then(({ traces: nextTraces, hasFailures }) => {
        setTraces(nextTraces);
        setTracesError(hasFailures && nextTraces.length === 0);
      })
      .catch(() => {
        setTraces([]);
        setTracesError(true);
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

  // Precompute stack deltas for the P&L column
  const stackDeltas = buildStackDeltas(turns);

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
          {!turnsLoading && !turnsError && (
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
        ) : turnsError ? (
          <FetchError onRetry={fetchTurns} />
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
                  {(['Turn #', 'Agent', 'Action', 'Stack Δ', 'Latency', 'Time'] as const).map((col) => (
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
                  const delta = stackDeltas.get(turn.id) ?? null;
                  const isFocused = focusedAgentId === turn.agentId;
                  return (
                    <tr
                      key={turn.id}
                      style={{
                        borderBottom: '0.5px solid var(--border)',
                        background: isFocused
                          ? 'rgba(232,160,32,0.08)'
                          : i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.012)',
                        boxShadow: isFocused ? 'inset 2px 0 0 var(--gold)' : undefined,
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
                          color: isFocused ? 'var(--gold)' : 'var(--ink)',
                          fontFamily: 'var(--font-mono)',
                          fontSize: 11,
                          fontWeight: isFocused ? 700 : 400,
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
                          color: isTimedOut ? 'var(--gold)' : 'var(--ink-soft)',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {formatAction(turn.action)}
                      </td>

                      {/* Stack Δ */}
                      <td style={{ padding: '7px 12px', whiteSpace: 'nowrap' }}>
                        {delta == null ? (
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-faint)' }}>
                            —
                          </span>
                        ) : (
                          <span
                            style={{
                              fontFamily: 'var(--font-mono)',
                              fontSize: 11,
                              color: delta > 0 ? 'var(--gold)' : delta < 0 ? 'var(--red)' : 'var(--ink-faint)',
                              fontWeight: delta !== 0 ? 600 : 400,
                            }}
                          >
                            {delta > 0 ? '+' : ''}{delta.toLocaleString()}
                          </span>
                        )}
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
          {hasErrors && !tracesLoading && !tracesError && (
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                color: 'var(--red)',
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
        ) : tracesError ? (
          <FetchError onRetry={fetchTraces} />
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
              .sort((a, b) => (a.agentId === focusedAgentId ? -1 : b.agentId === focusedAgentId ? 1 : 0))
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

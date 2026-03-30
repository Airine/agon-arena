'use client';

import { useEffect, useRef, useState } from 'react';
import { buildApiUrl, getAccessToken } from '@/lib/api';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BettingPanelProps {
  arenaId: string;
  seatedAgents: Array<{ id: string; name: string }>;
  isLive: boolean;
  isFinished: boolean;
}

interface AgentOdds {
  agentId: string;
  /** Fraction of total betting pool wagered on this agent (0–1) */
  fraction: number;
  /** Multiplier: 1 / fraction */
  multiplier: number;
}

interface OddsResponse {
  odds: Array<{ agentId: string; fraction: number }>;
}

type SubmitState =
  | { type: 'idle' }
  | { type: 'loading' }
  | { type: 'success'; agentName: string; amountChips: number }
  | { type: 'error'; message: string; retryable: boolean };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatMultiplier(m: number): string {
  return `${m.toFixed(1)}×`;
}

function formatChips(n: number): string {
  return n.toLocaleString();
}

// ---------------------------------------------------------------------------
// BettingPanel
// ---------------------------------------------------------------------------

export function BettingPanel({
  arenaId,
  seatedAgents,
  isLive,
  isFinished,
}: BettingPanelProps) {
  return (
    <BettingPanelInner
      arenaId={arenaId}
      seatedAgents={seatedAgents}
      isLive={isLive}
      isFinished={isFinished}
    />
  );
}

// Inner component — only rendered when env flag is set, so we can use hooks freely
function BettingPanelInner({
  arenaId,
  seatedAgents,
  isLive,
  isFinished,
}: BettingPanelProps) {
  const [oddsMap, setOddsMap] = useState<Map<string, AgentOdds>>(new Map());
  const [oddsLoading, setOddsLoading] = useState(true);

  const [selectedAgentId, setSelectedAgentId] = useState<string>(
    seatedAgents[0]?.id ?? '',
  );
  const [amountChips, setAmountChips] = useState(500);
  const [submitState, setSubmitState] = useState<SubmitState>({ type: 'idle' });

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Fetch odds, then set up polling while live
  const fetchOdds = () => {
    fetch(buildApiUrl(`/arenas/${arenaId}/odds`))
      .then((r) => (r.ok ? r.json() : null))
      .then((data: OddsResponse | null) => {
        if (!data?.odds) return;
        const map = new Map<string, AgentOdds>();
        for (const o of data.odds) {
          const fraction = Math.max(o.fraction, 0.0001); // avoid /0
          map.set(o.agentId, {
            agentId: o.agentId,
            fraction,
            multiplier: 1 / fraction,
          });
        }
        setOddsMap(map);
      })
      .catch(() => {})
      .finally(() => setOddsLoading(false));
  };

  useEffect(() => {
    fetchOdds();

    if (isLive) {
      intervalRef.current = setInterval(fetchOdds, 10_000);
    }

    return () => {
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arenaId, isLive]);

  // Payout preview
  const selectedOdds = oddsMap.get(selectedAgentId);
  const payoutPreview = selectedOdds
    ? Math.round(amountChips * selectedOdds.multiplier)
    : null;

  // Leading agent for bar colouring
  const leadingAgentId = [...oddsMap.values()].sort(
    (a, b) => b.fraction - a.fraction,
  )[0]?.agentId;

  // Submit handler
  const handleSubmit = async () => {
    if (!selectedAgentId || submitState.type === 'loading') return;
    setSubmitState({ type: 'loading' });

    const token = getAccessToken();
    try {
      const res = await fetch(buildApiUrl(`/arenas/${arenaId}/bets`), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ agentId: selectedAgentId, amountChips }),
      });

      if (res.ok) {
        const agentName =
          seatedAgents.find((a) => a.id === selectedAgentId)?.name ??
          selectedAgentId;
        setSubmitState({ type: 'success', agentName, amountChips });
        return;
      }

      let errorMsg = 'Something went wrong. Please try again.';
      let retryable = true;

      try {
        const body = await res.json();
        const raw: string = body?.error ?? body?.message ?? '';
        if (res.status === 403) {
          errorMsg = 'You cannot bet on this arena.';
          retryable = false;
        } else if (
          res.status === 400 ||
          res.status === 422
        ) {
          errorMsg = raw || 'Invalid bet — check your amount and try again.';
          retryable = true;
        } else if (
          raw.toLowerCase().includes('insufficient') ||
          raw.toLowerCase().includes('balance')
        ) {
          errorMsg = 'Insufficient chip balance.';
          retryable = true;
        } else if (raw) {
          errorMsg = raw;
        }
      } catch {
        // JSON parse failed — keep default message
      }

      setSubmitState({ type: 'error', message: errorMsg, retryable });
    } catch {
      setSubmitState({
        type: 'error',
        message: 'Network error — please try again.',
        retryable: true,
      });
    }
  };

  // ------------------------------------------------------------------
  // Render: finished state
  // ------------------------------------------------------------------
  if (isFinished) {
    return (
      <div className="betting-panel betting-panel--closed">
        <span className="betting-panel__closed-msg">
          Betting closed — arena has ended
        </span>
      </div>
    );
  }

  // ------------------------------------------------------------------
  // Render: loading skeleton
  // ------------------------------------------------------------------
  if (oddsLoading) {
    return (
      <div className="betting-panel betting-panel--skeleton">
        <div className="betting-panel__skeleton-row" style={{ width: '40%' }} />
        <div className="betting-panel__skeleton-row" style={{ width: '100%', height: 40 }} />
        <div className="betting-panel__skeleton-row" style={{ width: '100%', height: 40 }} />
        <div className="betting-panel__skeleton-row" style={{ width: '60%' }} />
      </div>
    );
  }

  // ------------------------------------------------------------------
  // Render: main betting UI
  // ------------------------------------------------------------------
  return (
    <div className="betting-panel">
      {/* Header */}
      <div className="betting-panel__header">
        <span className="betting-panel__title">PLACE A BET</span>
        {isLive && (
          <span className="betting-panel__live-badge">
            <span className="betting-panel__live-dot" aria-hidden="true" />
            LIVE
          </span>
        )}
      </div>

      {/* Agent odds rows */}
      <div className="betting-panel__odds-list">
        {seatedAgents.map((agent) => {
          const odds = oddsMap.get(agent.id);
          const fraction = odds?.fraction ?? 1 / seatedAgents.length;
          const multiplier = odds?.multiplier ?? seatedAgents.length;
          const isLeading = agent.id === leadingAgentId;

          return (
            <div key={agent.id} className="betting-panel__odds-row">
              <span className="betting-panel__odds-name">{agent.name}</span>
              <span className="betting-panel__odds-multiplier">
                {formatMultiplier(multiplier)}
              </span>
              <div className="betting-panel__odds-bar-track">
                <div
                  className={`betting-panel__odds-bar${isLeading ? ' betting-panel__odds-bar--lead' : ''}`}
                  style={{ width: `${Math.round(fraction * 100)}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* Divider */}
      <div className="betting-panel__divider" />

      {/* Form */}
      <div className="betting-panel__form">
        {/* Agent selector */}
        <div className="betting-panel__form-row">
          <label className="betting-panel__label" htmlFor="bet-agent-select">
            Bet on
          </label>
          <select
            id="bet-agent-select"
            className="betting-panel__select"
            value={selectedAgentId}
            onChange={(e) => {
              setSelectedAgentId(e.target.value);
              if (submitState.type !== 'idle') setSubmitState({ type: 'idle' });
            }}
            disabled={submitState.type === 'loading'}
          >
            {seatedAgents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name}
              </option>
            ))}
          </select>
        </div>

        {/* Amount input */}
        <div className="betting-panel__form-row">
          <label className="betting-panel__label" htmlFor="bet-amount-input">
            Amount
          </label>
          <div className="betting-panel__input-wrap">
            <input
              id="bet-amount-input"
              type="number"
              className="betting-panel__input"
              min={10}
              max={10000}
              step={10}
              value={amountChips}
              onChange={(e) => {
                setAmountChips(Number(e.target.value));
                if (submitState.type !== 'idle') setSubmitState({ type: 'idle' });
              }}
              disabled={submitState.type === 'loading'}
            />
            <span className="betting-panel__input-unit">CHIPS</span>
          </div>
        </div>

        {/* Payout preview */}
        {payoutPreview !== null && (
          <div className="betting-panel__payout">
            Payout:&nbsp;
            <span className="betting-panel__payout-value">
              ~{formatChips(payoutPreview)} CHIPS
            </span>
          </div>
        )}

        {/* Submit button */}
        <button
          className="betting-panel__cta"
          onClick={handleSubmit}
          disabled={
            submitState.type === 'loading' ||
            submitState.type === 'success' ||
            (submitState.type === 'error' && !submitState.retryable)
          }
        >
          {submitState.type === 'loading' ? 'Placing...' : 'Place Bet →'}
        </button>

        {/* Post-submit feedback */}
        {submitState.type === 'success' && (
          <div className="betting-panel__feedback betting-panel__feedback--success">
            Bet placed! ✓&nbsp;{formatChips(submitState.amountChips)} chips on{' '}
            <strong>{submitState.agentName}</strong>
          </div>
        )}
        {submitState.type === 'error' && (
          <div className="betting-panel__feedback betting-panel__feedback--error">
            {submitState.message}
          </div>
        )}
      </div>
    </div>
  );
}

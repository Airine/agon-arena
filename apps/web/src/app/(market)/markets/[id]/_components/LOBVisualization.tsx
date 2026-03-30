'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import type { LOBState as SocketLOBState } from '@agon/types';
import { registerVisualization, type ArenaVisualizationProps } from './arenaTypes';

// ---------------------------------------------------------------------------
// Local (mock-friendly) types
// ---------------------------------------------------------------------------

interface OrderLevel {
  price: number;
  size: number;
  cumulative: number;
}

interface TradeEntry {
  id: string;
  agentName: string;
  side: 'BUY' | 'SELL' | 'CANCEL';
  orderType: 'LIMIT' | 'MARKET' | 'CANCEL';
  size: number;
  price: number;
  timestamp: number;
}

interface LocalLOBState {
  asks: OrderLevel[];
  bids: OrderLevel[];
  lastPrice: number;
  lastDirection: 'up' | 'down' | 'flat';
  spread: number;
  spreadBps: number;
  midPriceHistory: number[];
  trades: TradeEntry[];
  /** Agent P&L data: agentId → { name, pnl } */
  agentPnl: { agentId: string; agentName: string; pnl: number }[];
}

// ---------------------------------------------------------------------------
// Socket LOBState → LocalLOBState adapter
// ---------------------------------------------------------------------------

function adaptSocketLOBState(
  incoming: SocketLOBState,
  prev: LocalLOBState | null,
): LocalLOBState {
  // Aggregate orders at the same price level
  function aggregateLevels(
    orders: SocketLOBState['bids'] | SocketLOBState['asks'],
  ): OrderLevel[] {
    const map = new Map<number, number>();
    for (const o of orders) {
      map.set(o.price, (map.get(o.price) ?? 0) + o.qty);
    }
    // Sort: asks ascending, bids descending — handled by caller
    const sorted = [...map.entries()];
    let cum = 0;
    return sorted.map(([price, size]) => {
      cum += size;
      return { price, size, cumulative: cum };
    });
  }

  const rawBids = aggregateLevels(incoming.bids).sort((a, b) => b.price - a.price).slice(0, 10);
  const rawAsks = aggregateLevels(incoming.asks).sort((a, b) => a.price - b.price).slice(0, 10);

  // Recompute cumulatives after sort/slice
  let cumBid = 0;
  const bids = rawBids.map((l) => { cumBid += l.size; return { ...l, cumulative: cumBid }; });
  let cumAsk = 0;
  const asks = rawAsks.map((l) => { cumAsk += l.size; return { ...l, cumulative: cumAsk }; });

  const mid = incoming.midPrice;
  const spread = incoming.spread;
  const spreadBps = mid > 0 ? parseFloat(((spread / mid) * 10000).toFixed(1)) : 0;

  const lastPrice = parseFloat(mid.toFixed(2));
  const prevLastPrice = prev?.lastPrice ?? mid;
  const lastDirection: 'up' | 'down' | 'flat' =
    lastPrice > prevLastPrice ? 'up' : lastPrice < prevLastPrice ? 'down' : 'flat';

  const history = [...(prev?.midPriceHistory ?? []).slice(-29), mid];

  // Convert recentTrades to TradeEntry
  const trades: TradeEntry[] = incoming.recentTrades.map((t) => ({
    id: `trade-${t.ts}-${t.buyerId}-${t.sellerId}`,
    agentName: t.buyerId.slice(0, 12),
    side: 'BUY',
    orderType: 'LIMIT',
    size: t.qty,
    price: t.price,
    timestamp: t.ts,
  }));

  // Derive agent P&L list
  const agentPnl = Object.entries(incoming.agentStats).map(([agentId, stats]) => ({
    agentId,
    agentName: agentId.slice(0, 12),
    pnl: stats.pnl,
  }));

  return {
    asks,
    bids,
    lastPrice,
    lastDirection,
    spread,
    spreadBps,
    midPriceHistory: history,
    trades,
    agentPnl,
  };
}

// ---------------------------------------------------------------------------
// Mock data helpers
// ---------------------------------------------------------------------------

function generateInitialLOBState(): LocalLOBState {
  const mid = 100.32;
  const tickSize = 0.01;

  const asks: OrderLevel[] = [];
  let cumAsk = 0;
  for (let i = 1; i <= 10; i++) {
    const price = parseFloat((mid + i * tickSize).toFixed(2));
    const size = Math.floor(Math.random() * 800 + 200);
    cumAsk += size;
    asks.push({ price, size, cumulative: cumAsk });
  }

  const bids: OrderLevel[] = [];
  let cumBid = 0;
  for (let i = 1; i <= 10; i++) {
    const price = parseFloat((mid - i * tickSize).toFixed(2));
    const size = Math.floor(Math.random() * 800 + 200);
    cumBid += size;
    bids.push({ price, size, cumulative: cumBid });
  }

  const history: number[] = [];
  let p = mid;
  for (let i = 0; i < 30; i++) {
    p += (Math.random() - 0.5) * 0.04;
    history.push(parseFloat(p.toFixed(4)));
  }

  const mockAgents = ['AGENT_0x7f4a', 'AGENT_0x2bc1', 'AGENT_0x9de3', 'AGENT_0x5aa0', 'AGENT_0x1f72'];
  const sides: ('BUY' | 'SELL')[] = ['BUY', 'SELL'];
  const trades: TradeEntry[] = Array.from({ length: 8 }, (_, i) => ({
    id: `mock-${i}`,
    agentName: mockAgents[i % mockAgents.length],
    side: sides[i % 2],
    orderType: 'LIMIT',
    size: Math.floor(Math.random() * 900 + 100),
    price: parseFloat((mid + (Math.random() - 0.5) * 0.1).toFixed(2)),
    timestamp: Date.now() - (8 - i) * 4000,
  }));

  const spread = parseFloat((asks[0].price - bids[0].price).toFixed(4));
  const spreadBps = parseFloat(((spread / mid) * 10000).toFixed(1));

  return {
    asks,
    bids,
    lastPrice: mid,
    lastDirection: 'flat',
    spread,
    spreadBps,
    midPriceHistory: history,
    trades,
    agentPnl: mockAgents.map((name) => ({
      agentId: name,
      agentName: name,
      pnl: parseFloat(((Math.random() - 0.5) * 400).toFixed(0)),
    })),
  };
}

function perturbLOBState(prev: LocalLOBState): LocalLOBState {
  const tickSize = 0.01;
  const direction = Math.random() > 0.5 ? 1 : -1;
  const move = direction * (Math.random() < 0.3 ? tickSize : 0);

  const newAsks: OrderLevel[] = prev.asks.map((lvl) => {
    const size = Math.max(50, lvl.size + Math.floor((Math.random() - 0.5) * 200));
    return { ...lvl, price: parseFloat((lvl.price + move).toFixed(2)), size };
  });
  let cumAsk = 0;
  newAsks.forEach((lvl) => { cumAsk += lvl.size; lvl.cumulative = cumAsk; });

  const newBids: OrderLevel[] = prev.bids.map((lvl) => {
    const size = Math.max(50, lvl.size + Math.floor((Math.random() - 0.5) * 200));
    return { ...lvl, price: parseFloat((lvl.price + move).toFixed(2)), size };
  });
  let cumBid = 0;
  newBids.forEach((lvl) => { cumBid += lvl.size; lvl.cumulative = cumBid; });

  const bestAsk = newAsks[0].price;
  const bestBid = newBids[0].price;
  const mid = (bestAsk + bestBid) / 2;
  const spread = parseFloat((bestAsk - bestBid).toFixed(4));
  const spreadBps = parseFloat(((spread / mid) * 10000).toFixed(1));

  const newLastPrice = parseFloat(mid.toFixed(2));
  const lastDirection: 'up' | 'down' | 'flat' =
    newLastPrice > prev.lastPrice ? 'up' :
    newLastPrice < prev.lastPrice ? 'down' : 'flat';

  const history = [...prev.midPriceHistory.slice(-29), mid];

  // Occasionally add a new trade entry
  const mockAgents = ['AGENT_0x7f4a', 'AGENT_0x2bc1', 'AGENT_0x9de3', 'AGENT_0x5aa0', 'AGENT_0x1f72'];
  const sides: ('BUY' | 'SELL')[] = ['BUY', 'SELL'];
  const newTrade: TradeEntry = {
    id: `live-${Date.now()}`,
    agentName: mockAgents[Math.floor(Math.random() * mockAgents.length)],
    side: sides[Math.floor(Math.random() * 2)],
    orderType: Math.random() > 0.2 ? 'LIMIT' : 'MARKET',
    size: Math.floor(Math.random() * 900 + 100),
    price: parseFloat((mid + (Math.random() - 0.5) * 0.05).toFixed(2)),
    timestamp: Date.now(),
  };

  // Perturb mock P&L slightly
  const agentPnl = prev.agentPnl.map((a) => ({
    ...a,
    pnl: parseFloat((a.pnl + (Math.random() - 0.5) * 20).toFixed(0)),
  }));

  return {
    asks: newAsks,
    bids: newBids,
    lastPrice: newLastPrice,
    lastDirection,
    spread,
    spreadBps,
    midPriceHistory: history,
    trades: [newTrade, ...prev.trades].slice(0, 40),
    agentPnl,
  };
}

// ---------------------------------------------------------------------------
// Subcomponents
// ---------------------------------------------------------------------------

function DepthBar({ fraction, side }: { fraction: number; side: 'ask' | 'bid' }) {
  const color = side === 'ask' ? 'rgba(255,68,85,0.18)' : 'rgba(34,221,136,0.15)';
  return (
    <span
      className="lob-viz__depth-bar-wrap"
      aria-hidden="true"
    >
      <span
        className="lob-viz__depth-bar-fill"
        style={{ width: `${Math.min(100, fraction * 100).toFixed(1)}%`, background: color }}
      />
    </span>
  );
}

function OrderBook({
  asks,
  bids,
  spread,
  spreadBps,
  isPausedRef,
}: {
  asks: OrderLevel[];
  bids: OrderLevel[];
  spread: number;
  spreadBps: number;
  isPausedRef: React.RefObject<boolean>;
}) {
  const maxCum = Math.max(
    asks.length ? asks[asks.length - 1].cumulative : 1,
    bids.length ? bids[bids.length - 1].cumulative : 1,
  );

  return (
    <div
      className="lob-viz__book"
      onMouseEnter={() => { isPausedRef.current = true; }}
      onMouseLeave={() => { isPausedRef.current = false; }}
    >
      {/* Column headers */}
      <div className="lob-viz__book-header">
        <span>PRICE</span>
        <span>SIZE</span>
        <span>DEPTH</span>
      </div>

      {/* Ask side — displayed top (highest ask first, reversed for visual) */}
      <div className="lob-viz__ask-levels">
        {[...asks].reverse().map((lvl, i) => (
          <div
            key={`ask-${lvl.price}`}
            className={`lob-viz__level lob-viz__level--ask${i === asks.length - 1 ? ' lob-viz__level--best' : ''}`}
          >
            <DepthBar fraction={lvl.cumulative / maxCum} side="ask" />
            <span className="lob-viz__level-price lob-viz__level-price--ask">
              {lvl.price.toFixed(2)}
            </span>
            <span className="lob-viz__level-size">{lvl.size.toLocaleString()}</span>
            <span className="lob-viz__level-cum">{lvl.cumulative.toLocaleString()}</span>
          </div>
        ))}
      </div>

      {/* Spread row */}
      <div className="lob-viz__spread-row">
        <span className="lob-viz__spread-label">SPREAD</span>
        <span className="lob-viz__spread-value">
          {spread.toFixed(4)} <span className="lob-viz__spread-bps">({spreadBps} bps)</span>
        </span>
      </div>

      {/* Bid side */}
      <div className="lob-viz__bid-levels">
        {bids.map((lvl, i) => (
          <div
            key={`bid-${lvl.price}`}
            className={`lob-viz__level lob-viz__level--bid${i === 0 ? ' lob-viz__level--best' : ''}`}
          >
            <DepthBar fraction={lvl.cumulative / maxCum} side="bid" />
            <span className="lob-viz__level-price lob-viz__level-price--bid">
              {lvl.price.toFixed(2)}
            </span>
            <span className="lob-viz__level-size">{lvl.size.toLocaleString()}</span>
            <span className="lob-viz__level-cum">{lvl.cumulative.toLocaleString()}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function timeAgo(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 5) return 'just now';
  if (diff < 60) return `${diff}s ago`;
  return `${Math.floor(diff / 60)}m ago`;
}

function AgentFeed({ trades }: { trades: TradeEntry[] }) {
  return (
    <div className="lob-viz__feed">
      <div className="lob-viz__feed-header">AGENT ACTIVITY</div>
      <div className="lob-viz__feed-scroll">
        {trades.map((t) => (
          <div key={t.id} className="lob-viz__feed-entry">
            <div className="lob-viz__feed-entry-top">
              <span className="lob-viz__feed-agent">{t.agentName}</span>
              <span className={`lob-viz__feed-chip lob-viz__feed-chip--${t.side.toLowerCase()}`}>
                {t.side}
              </span>
              <span className="lob-viz__feed-time">{timeAgo(t.timestamp)}</span>
            </div>
            <div className="lob-viz__feed-entry-bottom">
              <span className="lob-viz__feed-order">
                {t.orderType} {t.side === 'CANCEL' ? 'CANCEL' : `${t.size.toLocaleString()} @ ${t.price.toFixed(2)}`}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Sparkline({ history, direction }: { history: number[]; direction: 'up' | 'down' | 'flat' }) {
  const W = 400;
  const H = 56;
  const PAD = 4;

  if (history.length < 2) {
    return <svg className="lob-viz__sparkline" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" />;
  }

  const min = Math.min(...history);
  const max = Math.max(...history);
  const range = max - min || 0.001;

  const pts = history.map((v, i) => {
    const x = PAD + (i / (history.length - 1)) * (W - PAD * 2);
    const y = H - PAD - ((v - min) / range) * (H - PAD * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const strokeColor =
    direction === 'up' ? 'var(--green)' :
    direction === 'down' ? 'var(--red)' :
    'var(--ink-soft)';

  // Area fill: build a closed polygon
  const firstX = parseFloat(pts[0].split(',')[0]);
  const lastX = parseFloat(pts[pts.length - 1].split(',')[0]);
  const areaPoints = `${firstX},${H - PAD} ${pts.join(' ')} ${lastX},${H - PAD}`;

  const areaFill =
    direction === 'up' ? 'rgba(34,221,136,0.08)' :
    direction === 'down' ? 'rgba(255,68,85,0.08)' :
    'rgba(136,136,170,0.06)';

  return (
    <svg
      className="lob-viz__sparkline"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <polygon points={areaPoints} fill={areaFill} />
      <polyline
        points={pts.join(' ')}
        fill="none"
        stroke={strokeColor}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {/* Current price dot */}
      <circle
        cx={parseFloat(pts[pts.length - 1].split(',')[0])}
        cy={parseFloat(pts[pts.length - 1].split(',')[1])}
        r="3"
        fill={strokeColor}
      />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// P&L strip
// ---------------------------------------------------------------------------

function PnLStrip({ agentPnl }: { agentPnl: LocalLOBState['agentPnl'] }) {
  if (agentPnl.length === 0) return null;
  return (
    <div className="lob-viz__pnl-strip">
      {agentPnl.map(({ agentId, agentName, pnl }) => {
        const pnlClass =
          pnl > 0 ? 'lob-viz__pnl-chip--up' :
          pnl < 0 ? 'lob-viz__pnl-chip--down' :
          'lob-viz__pnl-chip--flat';
        return (
          <span key={agentId} className={`lob-viz__pnl-chip ${pnlClass}`}>
            {agentName.slice(0, 12)} {pnl >= 0 ? '+' : ''}{pnl}
          </span>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function LOBSkeleton() {
  return (
    <div className="lob-viz__skeleton">
      <div className="lob-viz__skeleton-bar" style={{ width: '40%', height: 32 }} />
      <div style={{ display: 'flex', gap: 16, marginTop: 16 }}>
        <div className="lob-viz__skeleton-block" style={{ flex: 1, height: 280 }} />
        <div className="lob-viz__skeleton-block" style={{ flex: 1, height: 280 }} />
      </div>
      <div className="lob-viz__skeleton-block" style={{ height: 64, marginTop: 16 }} />
      <div className="lob-viz__skeleton-label">Awaiting market data...</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

function LOBVisualization({
  arenaId: _arenaId,
  isLive,
  isFinished,
  lobState: socketLobState,
}: ArenaVisualizationProps) {
  const [lobState, setLobState] = useState<LocalLOBState | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isPaused = useRef(false);
  // Track previous local state for direction/history computation when adapting socket data
  const prevLocalRef = useRef<LocalLOBState | null>(null);

  const useMock = !isLive || socketLobState == null;

  // Initialize local state when mode switches (mock ↔ live)
  const useMockRef = useRef(useMock);
  useEffect(() => {
    if (useMockRef.current === useMock) return; // no mode change
    useMockRef.current = useMock;
    if (!useMock && socketLobState != null) {
      const adapted = adaptSocketLOBState(socketLobState, prevLocalRef.current);
      prevLocalRef.current = adapted;
      setLobState(adapted);
    } else {
      // Switching to mock — keep existing state if any, generate if missing
      setLobState((prev) => prev ?? generateInitialLOBState());
    }
  }, [useMock, socketLobState]);

  // When socket data arrives (live mode), update local state — but respect isPaused
  useEffect(() => {
    if (!useMock && socketLobState != null) {
      if (!isPaused.current) {
        const adapted = adaptSocketLOBState(socketLobState, prevLocalRef.current);
        prevLocalRef.current = adapted;
        setLobState(adapted);
      }
    }
  }, [socketLobState, useMock]);

  // Mock animation — only when not live or no socket data
  const tickCallback = useCallback(() => {
    if (isPaused.current) return;
    setLobState((prev) => prev ? perturbLOBState(prev) : generateInitialLOBState());
  }, []);

  useEffect(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (useMock) {
      intervalRef.current = setInterval(tickCallback, 800);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [useMock, tickCallback]);

  if (!lobState) {
    return (
      <div className="lob-viz__root">
        <LOBSkeleton />
      </div>
    );
  }

  const directionArrow = lobState.lastDirection === 'up' ? '↑' : lobState.lastDirection === 'down' ? '↓' : '→';
  const directionClass =
    lobState.lastDirection === 'up' ? 'lob-viz__price--up' :
    lobState.lastDirection === 'down' ? 'lob-viz__price--down' :
    'lob-viz__price--flat';

  return (
    <div className="lob-viz__root">
      {/* Top bar: mid-price + status */}
      <div className="lob-viz__topbar">
        <div className="lob-viz__topbar-left">
          <span className="lob-viz__label">LAST PRICE</span>
          <span className={`lob-viz__mid-price ${directionClass}`}>
            {lobState.lastPrice.toFixed(2)}
            <span className="lob-viz__direction-arrow">{directionArrow}</span>
          </span>
        </div>
        <div className="lob-viz__topbar-right">
          <PnLStrip agentPnl={lobState.agentPnl} />
          {isFinished ? (
            <span className="lob-viz__status-badge lob-viz__status-badge--finished">CLOSED</span>
          ) : isLive ? (
            <span className="lob-viz__status-badge lob-viz__status-badge--live">
              <span className="lob-viz__live-dot" />
              LIVE
            </span>
          ) : (
            <span className="lob-viz__status-badge lob-viz__status-badge--waiting">SIMULATED</span>
          )}
        </div>
      </div>

      {/* Two-column body */}
      <div className="lob-viz__body">
        {/* Left: Order Book */}
        <div className="lob-viz__col-book">
          <div className="lob-viz__col-title">ORDER BOOK</div>
          <OrderBook
            asks={lobState.asks}
            bids={lobState.bids}
            spread={lobState.spread}
            spreadBps={lobState.spreadBps}
            isPausedRef={isPaused}
          />
        </div>

        {/* Right: Agent Feed */}
        <div className="lob-viz__col-feed">
          <AgentFeed trades={lobState.trades} />
        </div>
      </div>

      {/* Bottom: Sparkline */}
      <div className="lob-viz__chart-row">
        <div className="lob-viz__chart-label">MID-PRICE · 30 TICKS</div>
        <Sparkline history={lobState.midPriceHistory} direction={lobState.lastDirection} />
      </div>
    </div>
  );
}

registerVisualization('lob', LOBVisualization);

export { LOBVisualization };

'use client';

import { registerVisualization, type ArenaVisualizationProps } from './arenaTypes';

function LOBVisualization({ arenaId: _arenaId }: ArenaVisualizationProps) {
  return (
    <div className="arena-viz__game-info">
      <div>
        <div className="arena-viz__game-title">LOB Market</div>
        <div className="arena-viz__game-desc">
          Agents trade on a limit order book, competing for best price discovery.
        </div>
      </div>

      <div className="arena-viz__coming-soon-badge">
        <span>◎</span>
        <span>Visualization Coming Soon</span>
      </div>

      <div className="arena-viz__status-line">
        LOB ORDER BOOK REPLAY UNDER DEVELOPMENT
      </div>
    </div>
  );
}

registerVisualization('lob', LOBVisualization);

export { LOBVisualization };

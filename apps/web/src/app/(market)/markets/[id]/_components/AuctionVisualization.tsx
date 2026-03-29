'use client';

import { registerVisualization, type ArenaVisualizationProps } from './arenaTypes';

function AuctionVisualization({ agents, gameState, isFinished }: ArenaVisualizationProps) {
  const sorted = [...agents].sort((a, b) => b.currentStack - a.currentStack);

  return (
    <div className="arena-viz__game-info">
      <div>
        <div className="arena-viz__game-title">Auction</div>
        <div className="arena-viz__game-desc">
          Agents bid on items using their chip stack.
        </div>
      </div>

      {gameState && !isFinished ? (
        <div className="arena-viz__status-line">AUCTION IN PROGRESS</div>
      ) : (
        <div className="arena-viz__status-line">
          {isFinished ? 'AUCTION ENDED' : 'WAITING FOR AUCTION TO START...'}
        </div>
      )}

      <div className="arena-viz__agent-grid">
        {sorted.map((agent, i) => (
          <div key={agent.agentId} className="arena-viz__agent-card">
            <div className="arena-viz__agent-name">
              {i === 0 && agents.length > 1 ? '▲ ' : ''}{agent.agentName}
            </div>
            <div className="arena-viz__agent-stack">
              {agent.currentStack.toLocaleString()} chips
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

registerVisualization('auction', AuctionVisualization);

export { AuctionVisualization };

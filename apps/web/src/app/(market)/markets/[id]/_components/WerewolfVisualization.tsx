'use client';

import { registerVisualization, type ArenaVisualizationProps } from './arenaTypes';

function WerewolfVisualization({ agents, gameState, isFinished }: ArenaVisualizationProps) {
  const sorted = [...agents].sort((a, b) => b.currentStack - a.currentStack);

  return (
    <div className="arena-viz__game-info">
      <div>
        <div className="arena-viz__game-title">Werewolf</div>
        <div className="arena-viz__game-desc">
          Social deduction. Agents vote to eliminate each other.
        </div>
      </div>

      {gameState && !isFinished ? (
        <div className="arena-viz__status-line">
          GAME IN PROGRESS &mdash; {agents.length} agents active
        </div>
      ) : (
        <div className="arena-viz__status-line">
          {isFinished ? 'MATCH ENDED' : 'WAITING FOR GAME TO START...'}
        </div>
      )}

      <div className="arena-viz__agent-grid">
        {sorted.map((agent) => (
          <div key={agent.agentId} className="arena-viz__agent-card">
            <div className="arena-viz__agent-name">{agent.agentName}</div>
            <div className="arena-viz__agent-stack">
              {agent.currentStack.toLocaleString()} chips
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

registerVisualization('werewolf', WerewolfVisualization);

export { WerewolfVisualization };

'use client';

import { registerVisualization, type ArenaVisualizationProps } from './arenaTypes';

function DebateVisualization({ agents, gameState, isFinished }: ArenaVisualizationProps) {
  const sorted = [...agents].sort((a, b) => b.currentStack - a.currentStack);
  const isTwoAgent = sorted.length === 2;

  return (
    <div className="arena-viz__game-info">
      <div>
        <div className="arena-viz__game-title">Debate</div>
        <div className="arena-viz__game-desc">
          Agents argue positions on a topic. Audience votes on persuasiveness.
        </div>
      </div>

      {gameState && !isFinished ? (
        <div className="arena-viz__status-line">DEBATE IN PROGRESS</div>
      ) : (
        <div className="arena-viz__status-line">
          {isFinished ? 'DEBATE ENDED' : 'WAITING FOR DEBATE TO START...'}
        </div>
      )}

      <div
        className="arena-viz__agent-grid"
        style={isTwoAgent ? { gridTemplateColumns: '1fr 1fr' } : undefined}
      >
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

registerVisualization('debate', DebateVisualization);

export { DebateVisualization };

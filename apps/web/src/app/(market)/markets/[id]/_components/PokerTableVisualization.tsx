'use client';

import PokerTable from '@/components/PokerTable';
import { registerVisualization, type ArenaVisualizationProps } from './arenaTypes';

function PokerTableVisualization({ gameState, isFinished }: ArenaVisualizationProps) {
  return (
    <div className="arena-viz__poker">
      <PokerTable
        gameState={gameState}
        width={600}
        height={420}
        emptyLabel={isFinished ? 'Match ended' : 'Waiting for game to start...'}
        isTerminalEmptyState={isFinished}
      />
    </div>
  );
}

registerVisualization('texas_holdem', PokerTableVisualization);

export { PokerTableVisualization };

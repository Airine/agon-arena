'use client';

import { registerVisualization, type ArenaVisualizationProps } from './arenaTypes';

function TerritoryVisualization({ arenaId: _arenaId }: ArenaVisualizationProps) {
  return (
    <div className="arena-viz__game-info">
      <div>
        <div className="arena-viz__game-title">Territory</div>
        <div className="arena-viz__game-desc">
          Agents claim and defend regions on a shared map.
        </div>
      </div>

      <div className="arena-viz__coming-soon-badge">
        <span>◎</span>
        <span>Visualization Coming Soon</span>
      </div>

      <div className="arena-viz__status-line">
        MAP RENDERER UNDER DEVELOPMENT
      </div>
    </div>
  );
}

registerVisualization('territory', TerritoryVisualization);

export { TerritoryVisualization };

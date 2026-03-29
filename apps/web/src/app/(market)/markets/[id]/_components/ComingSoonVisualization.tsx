import type { ArenaVisualizationProps } from './arenaTypes';

export function ComingSoonVisualization({ arenaId: _arenaId }: ArenaVisualizationProps) {
  return (
    <div className="arena-viz__coming-soon">
      <div className="arena-viz__coming-soon-mark">◎</div>
      <div className="arena-viz__coming-soon-title">Visualization Coming Soon</div>
      <div className="arena-viz__coming-soon-body">
        Live visualization for this arena type is under development.
      </div>
    </div>
  );
}

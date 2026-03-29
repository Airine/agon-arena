// Import visualizations to trigger self-registration side effects
import './PokerTableVisualization';
import './WerewolfVisualization';
import './DebateVisualization';
import './AuctionVisualization';
import './LOBVisualization';
import './TerritoryVisualization';

export { getVisualization, registerVisualization } from './arenaTypes';
export type { ArenaVisualizationProps, AgentSummary } from './arenaTypes';
export { ComingSoonVisualization } from './ComingSoonVisualization';

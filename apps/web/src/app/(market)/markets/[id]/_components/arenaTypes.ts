import type { ComponentType } from 'react';
import type { GameState, LOBState } from '@agon/types';

export interface AgentSummary {
  agentId: string;
  agentName: string;
  seatIndex: number;
  currentStack: number;
  eloRating?: number;
  isActive: boolean;
}

export interface ArenaVisualizationProps {
  arenaId: string;
  gameState: GameState | null;
  lobState?: LOBState | null;
  agents: AgentSummary[];
  focusedAgentId?: string | null;
  isLive: boolean;
  isFinished: boolean;
}

const registry = new Map<string, ComponentType<ArenaVisualizationProps>>();

export function registerVisualization(
  gameType: string,
  component: ComponentType<ArenaVisualizationProps>,
) {
  registry.set(gameType, component);
}

export function getVisualization(
  gameType: string,
): ComponentType<ArenaVisualizationProps> | null {
  return registry.get(gameType) ?? null;
}

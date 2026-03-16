/**
 * ElizaOS providers for Agon Arena integration.
 *
 * Providers supply context/data to the agent's reasoning:
 * - arenaListProvider: Current state of available arenas
 * - gameStateProvider: Active game state if the agent is in a match
 * - agentStatsProvider: The agent's performance statistics
 */

import type { Socket } from 'socket.io-client';
import type {
  AgentTurnRequest,
  ElizaProvider,
  IAgentRuntime,
  GameState,
} from './types.js';
import { AgonClient } from './client.js';

/** Shared mutable store for the plugin's runtime state. */
export interface PluginStore {
  lastGameState?: GameState;
  handsPlayed: number;
  agentId?: string;
  arenaId?: string;
  currentTurn?: AgentTurnRequest;
  client?: AgonClient;
  socket?: Socket;
}

export const pluginStore: PluginStore = {
  handsPlayed: 0,
};

function getClient(runtime: IAgentRuntime): AgonClient {
  if (pluginStore.client) {
    return pluginStore.client;
  }
  const apiUrl = runtime.getSetting('AGON_API_URL') ?? 'https://api.agon.win';
  const token = runtime.getSetting('AGON_TOKEN');
  return new AgonClient(apiUrl, token);
}

/** Provider: Available arenas on Agon Arena. */
export const arenaListProvider: ElizaProvider = {
  name: 'agonArenaList',
  description: 'Lists currently available poker arenas on Agon Arena',

  get: async (runtime) => {
    try {
      const client = getClient(runtime);
      const { arenas } = await client.listArenas();

      if (arenas.length === 0) return 'No arenas currently available on Agon Arena.';

      const lines = arenas.map((a: Record<string, unknown>) => {
        return `${a.name}: ${a.status}, ${a.playerCount}/${a.maxPlayers} players, blinds ${a.smallBlind}/${a.bigBlind}`;
      });

      return `Agon Arena tables:\n${lines.join('\n')}`;
    } catch (e) {
      return `Agon Arena unavailable: ${(e as Error).message}`;
    }
  },
};

/** Provider: Current game state (if in a match). */
export const gameStateProvider: ElizaProvider = {
  name: 'agonGameState',
  description: 'Current poker game state if the agent is playing on Agon Arena',

  get: async () => {
    const gs = pluginStore.lastGameState;
    if (!gs) return 'Not currently in an Agon Arena game.';

    const me = gs.players.find((p) => p.agentId === pluginStore.agentId);
    const totalPot = gs.pots.reduce((sum, p) => sum + p.amount, 0);
    const activePlayers = gs.players.filter((p) => !p.isFolded).length;

    let summary = `Agon Arena game (hand #${gs.handNumber}, stage: ${gs.stage}):\n`;
    summary += `- Pot: ${totalPot} chips, ${activePlayers} active players\n`;
    summary += `- Community cards: ${gs.communityCards.map((c) => `${c.rank}${c.suit[0]}`).join(' ') || 'none'}\n`;

    if (me) {
      summary += `- Your cards: ${me.cards.map((c) => `${c.rank}${c.suit[0]}`).join(' ')}\n`;
      summary += `- Your stack: ${me.stack} chips, current bet: ${me.bet}\n`;
    }

    summary += `- Hands played this session: ${pluginStore.handsPlayed}`;
    return summary;
  },
};

/** Provider: Agent performance statistics. */
export const agentStatsProvider: ElizaProvider = {
  name: 'agonAgentStats',
  description: 'Performance statistics for the Agon Arena agent',

  get: async (runtime) => {
    const agentId = runtime.getSetting('AGON_AGENT_ID') ?? pluginStore.agentId;
    if (!agentId) return 'No Agon Arena agent configured.';

    try {
      const client = getClient(runtime);
      const agent = await client.getAgent(agentId);

      return [
        `Agon Arena agent "${agent.name}":`,
        `- Elo Rating: ${agent.eloRating}`,
        `- Hands played: ${agent.handsPlayed}`,
        `- Hands won: ${agent.handsWon}`,
        `- Total chips won: ${agent.totalChipsWon}`,
        `- Session hands: ${pluginStore.handsPlayed}`,
      ].join('\n');
    } catch (e) {
      return `Could not fetch agent stats: ${(e as Error).message}`;
    }
  },
};

export const allProviders = [arenaListProvider, gameStateProvider, agentStatsProvider];

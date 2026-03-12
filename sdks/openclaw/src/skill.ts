/**
 * OpenClaw Skill definition for Agon Arena poker integration.
 *
 * This module exports a skill factory that wraps the Agon Arena AAP protocol
 * into the OpenClaw skill interface (actions, conditions, lifecycle hooks).
 *
 * Usage:
 *   import { createAgonSkill } from '@agon/openclaw-skill';
 *
 *   const skill = createAgonSkill({
 *     apiUrl: 'https://api.agon.win',
 *     decide: (request) => {
 *       // your poker strategy
 *       return { action: 'call' };
 *     },
 *   });
 */

import type {
  AgonSkillConfig,
  AAPActionRequest,
  AAPActionResponse,
  DecideFunction,
  ActionType,
  GameState,
  Card,
} from './types.js';
import { AgonClient } from './client.js';
import { createWebhookServer } from './server.js';

/** Skill state maintained across the skill lifecycle. */
export interface AgonSkillState {
  client: AgonClient;
  agentId?: string;
  isRunning: boolean;
  handsPlayed: number;
  lastGameState?: GameState;
}

/** Full config for creating an Agon OpenClaw skill. */
export interface CreateAgonSkillOptions extends AgonSkillConfig {
  /** Strategy function for making poker decisions. */
  decide: DecideFunction;
  /** Agent name for registration. */
  agentName?: string;
}

/** OpenClaw skill action descriptor. */
export interface SkillAction {
  name: string;
  description: string;
  execute: (params: Record<string, unknown>) => Promise<Record<string, unknown>>;
}

/** OpenClaw skill definition. */
export interface AgonSkill {
  name: string;
  description: string;
  version: string;

  /** Skill actions that the agent can invoke. */
  actions: Record<string, SkillAction>;

  /** Start the webhook server and prepare for games. */
  start: () => Promise<void>;

  /** Stop the webhook server. */
  stop: () => Promise<void>;

  /** Current skill state. */
  state: AgonSkillState;
}

/**
 * Create an Agon Arena skill for OpenClaw agents.
 *
 * The skill exposes the following actions:
 * - `listArenas`: Browse available poker arenas
 * - `joinArena`: Join an arena with the registered agent
 * - `getGameState`: Get the latest game state from the last webhook
 * - `getStats`: Get the agent's performance statistics
 *
 * The webhook server runs in the background, automatically responding to
 * action requests from the Agon platform using the provided `decide` function.
 */
export function createAgonSkill(options: CreateAgonSkillOptions): AgonSkill {
  const {
    apiUrl,
    port = 8080,
    host = '0.0.0.0',
    platformPublicKey,
    verifySignatures = true,
    decide,
    agentName = 'OpenClawAgent',
  } = options;

  const client = new AgonClient({ baseUrl: apiUrl });

  const state: AgonSkillState = {
    client,
    isRunning: false,
    handsPlayed: 0,
  };

  // Wrap decide to track state
  const wrappedDecide: DecideFunction = async (request: AAPActionRequest) => {
    state.lastGameState = request.state;
    state.handsPlayed++;
    return decide(request);
  };

  const server = createWebhookServer({
    decide: wrappedDecide,
    platformPublicKey,
    verifySignatures,
    name: agentName,
  });

  const skill: AgonSkill = {
    name: 'agon-arena',
    description: 'Compete in Texas Hold\'em poker on Agon Arena against other AI agents',
    version: '0.1.0',

    state,

    actions: {
      listArenas: {
        name: 'listArenas',
        description: 'List available poker arenas on Agon Arena',
        execute: async (params) => {
          const status = params.status as string | undefined;
          const result = await client.listArenas(status);
          return { arenas: result.arenas };
        },
      },

      joinArena: {
        name: 'joinArena',
        description: 'Join a poker arena with the registered agent',
        execute: async (params) => {
          const arenaId = params.arenaId as string;
          if (!state.agentId) throw new Error('Agent not registered. Call start() first.');
          const result = await client.joinArena(arenaId, state.agentId);
          return result;
        },
      },

      getGameState: {
        name: 'getGameState',
        description: 'Get the latest game state from the most recent action request',
        execute: async () => {
          return {
            hasState: !!state.lastGameState,
            state: state.lastGameState ?? null,
            handsPlayed: state.handsPlayed,
          };
        },
      },

      getStats: {
        name: 'getStats',
        description: 'Get the registered agent\'s performance statistics',
        execute: async () => {
          if (!state.agentId) throw new Error('Agent not registered. Call start() first.');
          const agent = await client.getAgent(state.agentId);
          return agent;
        },
      },
    },

    start: async () => {
      await server.listen({ port, host });
      state.isRunning = true;
      server.log.info(`Agon Arena skill started — webhook listening on ${host}:${port}`);
    },

    stop: async () => {
      await server.close();
      state.isRunning = false;
    },
  };

  return skill;
}

// --- Utility exports for strategy development ---

/** Check if the agent has a pocket pair. */
export function hasPocketPair(cards: Card[]): boolean {
  return cards.length === 2 && cards[0]!.rank === cards[1]!.rank;
}

/** Check if the agent has suited hole cards. */
export function isSuited(cards: Card[]): boolean {
  return cards.length === 2 && cards[0]!.suit === cards[1]!.suit;
}

/** Get the highest card rank value (2=2, ..., A=14). */
export function rankValue(rank: string): number {
  const values: Record<string, number> = {
    '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9,
    '10': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14,
  };
  return values[rank] ?? 0;
}

/** Simple preflop hand strength heuristic (0.0 to 1.0). */
export function preflopStrength(cards: Card[]): number {
  if (cards.length !== 2) return 0;
  const r1 = rankValue(cards[0]!.rank);
  const r2 = rankValue(cards[1]!.rank);
  const high = Math.max(r1, r2);
  const low = Math.min(r1, r2);

  let score = (high + low) / 28; // base score
  if (r1 === r2) score += 0.3;   // pair bonus
  if (isSuited(cards)) score += 0.05; // suited bonus
  if (high - low <= 2 && high - low > 0) score += 0.05; // connector bonus

  return Math.min(score, 1.0);
}

/** Suggest a reasonable action based on simple preflop heuristics. */
export function suggestAction(
  cards: Card[],
  validActions: ActionType[],
  potOdds = 0.5,
): AAPActionResponse {
  const strength = preflopStrength(cards);

  if (strength > 0.8 && validActions.includes('raise')) {
    return { action: 'raise' };
  }
  if (strength > 0.5 && validActions.includes('call')) {
    return { action: 'call' };
  }
  if (validActions.includes('check')) {
    return { action: 'check' };
  }
  if (strength > potOdds && validActions.includes('call')) {
    return { action: 'call' };
  }
  return { action: 'fold' };
}

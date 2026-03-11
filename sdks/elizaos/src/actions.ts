/**
 * ElizaOS actions for Agon Arena integration.
 *
 * Actions define things the agent can DO:
 * - browseArenas: List available poker arenas
 * - joinArena: Join a specific arena
 * - playPoker: Make a poker decision during a game
 */

import type { ElizaAction, IAgentRuntime, AAPActionRequest, AAPActionResponse, Card } from './types.js';
import { AgonClient } from './client.js';

function getClient(runtime: IAgentRuntime): AgonClient {
  const apiUrl = runtime.getSetting('AGON_API_URL') ?? 'https://api.agon.win';
  const token = runtime.getSetting('AGON_TOKEN');
  return new AgonClient(apiUrl, token);
}

/** Action: Browse available poker arenas. */
export const browseArenasAction: ElizaAction = {
  name: 'BROWSE_ARENAS',
  description: 'Browse available poker arenas on Agon Arena platform',
  similes: ['LIST_ARENAS', 'FIND_GAMES', 'SHOW_TABLES', 'LOOK_FOR_GAMES'],
  examples: [
    [
      { user: '{{user1}}', content: { text: 'Show me the available poker games' } },
      { user: '{{agent}}', content: { text: 'Let me check the available arenas on Agon...' } },
    ],
    [
      { user: '{{user1}}', content: { text: 'Are there any poker tables I can join?' } },
      { user: '{{agent}}', content: { text: 'I\'ll look for open arenas on Agon Arena.' } },
    ],
  ],

  validate: async (runtime) => {
    return !!runtime.getSetting('AGON_API_URL') || !!runtime.getSetting('AGON_TOKEN');
  },

  handler: async (runtime, _message, _state, _options, callback) => {
    try {
      const client = getClient(runtime);
      const { arenas } = await client.listArenas('waiting');

      if (arenas.length === 0) {
        callback({ text: 'No open arenas found. All tables are currently full or in progress.' });
        return;
      }

      const lines = arenas.map((a: Record<string, unknown>) =>
        `- **${a.name}** (${a.playerCount}/${a.maxPlayers} players, blinds ${a.smallBlind}/${a.bigBlind}, stack ${a.startingStack})`,
      );

      callback({
        text: `Found ${arenas.length} open arena(s):\n${lines.join('\n')}`,
        action: 'BROWSE_ARENAS',
      });
    } catch (e) {
      callback({ text: `Failed to fetch arenas: ${(e as Error).message}` });
    }
  },
};

/** Action: Join a specific poker arena. */
export const joinArenaAction: ElizaAction = {
  name: 'JOIN_ARENA',
  description: 'Join a poker arena on Agon Arena with a registered agent',
  similes: ['SIT_DOWN', 'ENTER_GAME', 'JOIN_TABLE', 'JOIN_GAME'],
  examples: [
    [
      { user: '{{user1}}', content: { text: 'Join the arena abc-123 with my agent' } },
      { user: '{{agent}}', content: { text: 'Joining arena abc-123...' } },
    ],
  ],

  validate: async (runtime) => {
    return !!runtime.getSetting('AGON_TOKEN') && !!runtime.getSetting('AGON_AGENT_ID');
  },

  handler: async (runtime, message, _state, options, callback) => {
    try {
      const client = getClient(runtime);
      const agentId = runtime.getSetting('AGON_AGENT_ID');
      if (!agentId) {
        callback({ text: 'No AGON_AGENT_ID configured. Register an agent first.' });
        return;
      }

      const arenaId = (options.arenaId as string) ?? extractArenaId(message);
      if (!arenaId) {
        callback({ text: 'Please specify an arena ID to join.' });
        return;
      }

      await client.joinArena(arenaId, agentId);
      callback({
        text: `Successfully joined arena ${arenaId}. Waiting for the game to start...`,
        action: 'JOIN_ARENA',
      });
    } catch (e) {
      callback({ text: `Failed to join arena: ${(e as Error).message}` });
    }
  },
};

/** Action: Make a poker decision (used by the webhook handler). */
export const playPokerAction: ElizaAction = {
  name: 'PLAY_POKER',
  description: 'Make a poker decision during an active Agon Arena game',
  similes: ['POKER_DECISION', 'MAKE_MOVE', 'BET', 'RAISE', 'FOLD', 'CALL', 'CHECK'],
  examples: [
    [
      { user: '{{user1}}', content: { text: 'What should I do with pocket aces?' } },
      { user: '{{agent}}', content: { text: 'With pocket aces, you should raise aggressively.' } },
    ],
  ],

  validate: async () => true,

  handler: async (_runtime, _message, state, _options, callback) => {
    const request = state.agonActionRequest as AAPActionRequest | undefined;
    if (!request) {
      callback({ text: 'No active poker game state. This action is triggered automatically during games.' });
      return;
    }

    const response = makeDecision(request);
    callback({
      text: `Decision: ${response.action}${response.amount ? ` (${response.amount})` : ''}`,
      action: 'PLAY_POKER',
    });
  },
};

/** Simple poker decision logic. */
export function makeDecision(request: AAPActionRequest): AAPActionResponse {
  const { state, validActions, agentId } = request;
  const me = state.players.find((p) => p.agentId === agentId);
  if (!me || !me.cards.length) {
    return validActions.includes('check') ? { action: 'check' } : { action: 'fold' };
  }

  const strength = estimateHandStrength(me.cards, state.communityCards);

  if (strength > 0.8 && validActions.includes('raise')) {
    return { action: 'raise', amount: state.bigBlindAmount * 3 };
  }
  if (strength > 0.8 && validActions.includes('all_in')) {
    return { action: 'all_in' };
  }
  if (strength > 0.5 && validActions.includes('call')) {
    return { action: 'call' };
  }
  if (validActions.includes('check')) {
    return { action: 'check' };
  }
  if (strength > 0.35 && validActions.includes('call')) {
    return { action: 'call' };
  }
  return { action: 'fold' };
}

function rankValue(rank: string): number {
  const values: Record<string, number> = {
    '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9,
    '10': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14,
  };
  return values[rank] ?? 0;
}

function estimateHandStrength(holeCards: Card[], communityCards: Card[]): number {
  if (holeCards.length !== 2) return 0.3;
  const r1 = rankValue(holeCards[0].rank);
  const r2 = rankValue(holeCards[1].rank);
  const high = Math.max(r1, r2);
  const low = Math.min(r1, r2);
  const paired = r1 === r2;
  const suited = holeCards[0].suit === holeCards[1].suit;

  let score = (high + low) / 28;
  if (paired) score += 0.3;
  if (suited) score += 0.05;
  if (high - low <= 2 && !paired) score += 0.05;

  // Boost if community cards help
  if (communityCards.length > 0) {
    const allRanks = [...holeCards, ...communityCards].map((c) => rankValue(c.rank));
    const rankCounts = new Map<number, number>();
    for (const r of allRanks) {
      rankCounts.set(r, (rankCounts.get(r) ?? 0) + 1);
    }
    const maxCount = Math.max(...rankCounts.values());
    if (maxCount >= 4) score = 0.95;
    else if (maxCount === 3) score = Math.max(score, 0.75);
    else if (maxCount === 2) score = Math.max(score, 0.55);
  }

  return Math.min(score, 1.0);
}

function extractArenaId(message: unknown): string | undefined {
  const text = (message as { content?: { text?: string } })?.content?.text ?? '';
  const match = text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  return match?.[0];
}

export const allActions = [browseArenasAction, joinArenaAction, playPokerAction];

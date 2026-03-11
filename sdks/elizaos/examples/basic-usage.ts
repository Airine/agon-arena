/**
 * Example: Using the Agon Arena ElizaOS plugin.
 *
 * This shows how to integrate the plugin into an ElizaOS agent.
 *
 * Prerequisites:
 * - Register on Agon Arena and create an agent
 * - Set environment variables: AGON_API_URL, AGON_TOKEN, AGON_AGENT_ID
 *
 * Usage:
 *   export AGON_API_URL=https://api.agon.win
 *   export AGON_TOKEN=<your-jwt-token>
 *   export AGON_AGENT_ID=<your-agent-uuid>
 *   export AGON_PLATFORM_PUBLIC_KEY=<hex-public-key>
 *   npx tsx examples/basic-usage.ts
 */

import { agonPlugin, makeDecision, type AAPActionRequest, type AAPActionResponse } from '../src/index.js';

// Example: Override the default decision logic
function customDecide(request: AAPActionRequest): AAPActionResponse {
  const { state, validActions, agentId } = request;
  const me = state.players.find((p) => p.agentId === agentId);

  // Premium pairs — go all-in
  if (me?.cards.length === 2) {
    const r1 = me.cards[0].rank;
    const r2 = me.cards[1].rank;
    if (r1 === r2 && ['A', 'K', 'Q'].includes(r1)) {
      if (validActions.includes('all_in')) return { action: 'all_in' };
      if (validActions.includes('raise')) return { action: 'raise', amount: state.bigBlindAmount * 5 };
    }
  }

  // Fall back to the built-in strategy for everything else
  return makeDecision(request);
}

// The plugin integrates into ElizaOS like this:
// const agent = new AgentRuntime({
//   plugins: [agonPlugin],
//   settings: {
//     AGON_API_URL: process.env.AGON_API_URL,
//     AGON_TOKEN: process.env.AGON_TOKEN,
//     AGON_AGENT_ID: process.env.AGON_AGENT_ID,
//     AGON_PLATFORM_PUBLIC_KEY: process.env.AGON_PLATFORM_PUBLIC_KEY,
//   },
// });

console.log('Agon Arena ElizaOS Plugin');
console.log('Plugin name:', agonPlugin.name);
console.log('Actions:', agonPlugin.actions.map((a) => a.name).join(', '));
console.log('Providers:', agonPlugin.providers.map((p) => p.name).join(', '));

// Demonstrate custom decision logic
const mockRequest: AAPActionRequest = {
  gameId: 'test-game',
  handId: 'test-hand',
  agentId: 'test-agent',
  state: {
    arenaId: 'test-arena',
    handId: 'test-hand',
    handNumber: 1,
    stage: 'pre_flop',
    players: [
      {
        agentId: 'test-agent',
        agentName: 'TestBot',
        position: 0,
        stack: 1000,
        bet: 10,
        totalBet: 10,
        cards: [
          { suit: 'spades', rank: 'A' },
          { suit: 'hearts', rank: 'A' },
        ],
        isActive: true,
        isFolded: false,
        isAllIn: false,
        hasActed: false,
      },
    ],
    communityCards: [],
    pots: [{ amount: 15, eligiblePlayers: ['test-agent'] }],
    currentActorIndex: 0,
    dealerIndex: 0,
    smallBlindIndex: 0,
    bigBlindIndex: 1,
    smallBlindAmount: 5,
    bigBlindAmount: 10,
    minRaise: 20,
  },
  validActions: ['fold', 'call', 'raise', 'all_in'],
  timeoutMs: 5000,
};

const decision = customDecide(mockRequest);
console.log('\nTest decision with pocket Aces:', decision);
// Expected: { action: 'all_in' }

/**
 * Simple OpenClaw agent that plays Agon Arena poker.
 *
 * This example creates an Agon skill with a basic strategy:
 * - Premium pairs (AA, KK, QQ): raise
 * - Any pair or high cards: call
 * - Otherwise: check or fold
 *
 * Usage:
 *   export AGON_AGENT_WALLET_PRIVATE_KEY=0xabc123...
 *   npx tsx examples/simple-agent.ts
 */

import { createAgonSkill, preflopStrength, type AgentTurnRequest, type AAPActionResponse } from '../src/index.js';

function decide(request: AgentTurnRequest): AAPActionResponse {
  const { state, validActions } = request;

  // Find our player
  const me = state.players.find((p) => p.agentId === request.agentId);
  if (!me) return { action: 'fold' };

  // Use preflop strength heuristic for hole cards
  const strength = me.cards.length === 2 ? preflopStrength(me.cards) : 0.5;

  // Strong hand → raise
  if (strength > 0.75 && validActions.includes('raise')) {
    return { action: 'raise', amount: state.bigBlindAmount * 3 };
  }

  // Decent hand → call
  if (strength > 0.4 && validActions.includes('call')) {
    return { action: 'call' };
  }

  // Free check
  if (validActions.includes('check')) {
    return { action: 'check' };
  }

  // Marginal → call if cheap
  if (strength > 0.3 && validActions.includes('call')) {
    return { action: 'call' };
  }

  return { action: 'fold' };
}

const skill = createAgonSkill({
  apiUrl: process.env.AGON_API_URL ?? 'https://api.agon.win',
  agentWalletPrivateKey: process.env.AGON_AGENT_WALLET_PRIVATE_KEY,
  decide,
  agentName: 'SimpleOpenClawBot',
  agentDescription: 'Reference OpenClaw runtime for Agon Arena outbound arena play',
  agentCapabilities: ['socket:runtime', 'poker:no-limit-holdem'],
  agentMetadata: { framework: 'openclaw', example: 'simple-agent' },
});

async function main(): Promise<void> {
  await skill.start();
  console.log('SimpleOpenClawBot bootstrapped and waiting for runtime events...');

  if (!skill.state.agentId) {
    console.log('Set AGON_AGENT_WALLET_PRIVATE_KEY to enable auto-bootstrap.');
    return;
  }

  if (skill.state.arenaId) {
    console.log(`Joined arena ${skill.state.arenaId} with agent ${skill.state.agentId}.`);
  } else {
    console.log('No waiting arenas were available yet. The agent session is ready.');
  }

  await new Promise(() => {});
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

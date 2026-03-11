/**
 * Simple OpenClaw agent that plays Agon Arena poker.
 *
 * This example creates an Agon skill with a basic strategy:
 * - Premium pairs (AA, KK, QQ): raise
 * - Any pair or high cards: call
 * - Otherwise: check or fold
 *
 * Usage:
 *   npx tsx examples/simple-agent.ts
 */

import { createAgonSkill, preflopStrength, type AAPActionRequest, type AAPActionResponse } from '../src/index.js';

function decide(request: AAPActionRequest): AAPActionResponse {
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
  port: parseInt(process.env.PORT ?? '8080', 10),
  platformPublicKey: process.env.AGON_PLATFORM_PUBLIC_KEY,
  verifySignatures: !!process.env.AGON_PLATFORM_PUBLIC_KEY,
  decide,
  agentName: 'SimpleOpenClawBot',
});

skill.start().then(() => {
  console.log('SimpleOpenClawBot is running and waiting for games...');
});

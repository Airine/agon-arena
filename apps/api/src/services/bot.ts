/**
 * AGO-33: Fill-in bot system — 8 rule-based bot personalities.
 *
 * Each bot has a unique strategy URL (bot://<name>) that the orchestrator
 * resolves locally without making HTTP calls.
 */
import type { ActionType, Card, GameState, PlayerAction } from '@agon/types';
import { evaluateHand } from '../game/evaluator.js';

// ─── Bot profiles ─────────────────────────────────────────────────────────────

export interface BotProfile {
  name: string;
  url: string;
  description: string;
}

export const BOT_PROFILES: BotProfile[] = [
  { name: 'NitBot',     url: 'bot://nit',     description: 'Ultra-tight, only premium hands' },
  { name: 'PassiveBot', url: 'bot://passive',  description: 'Always calls, never raises' },
  { name: 'TagBot',     url: 'bot://tag',      description: 'Tight-Aggressive: fold weak, raise strong' },
  { name: 'LagBot',     url: 'bot://lag',      description: 'Loose-Aggressive: wide range, frequent raises' },
  { name: 'BluffBot',   url: 'bot://bluff',    description: 'Frequent bluffer, unpredictable' },
  { name: 'CallBot',    url: 'bot://call',     description: 'Calling station, never raises' },
  { name: 'ManiacBot',  url: 'bot://maniac',   description: 'Raise or all-in every street' },
  { name: 'RandomBot',  url: 'bot://random',   description: 'Weighted random actions' },
];

// ─── Hand strength helpers ────────────────────────────────────────────────────

/**
 * Map HandRank string to strength tier 0-9.
 */
const HAND_RANK_STRENGTH: Record<string, number> = {
  high_card:       0,
  pair:            1,
  two_pair:        2,
  three_of_a_kind: 3,
  straight:        4,
  flush:           5,
  full_house:      6,
  four_of_a_kind:  7,
  straight_flush:  8,
  royal_flush:     9,
};

/**
 * Compute pre-flop hand strength (0–10) from exactly 2 hole cards.
 * Uses a simplified chart — higher = stronger hand.
 */
export function preFlopStrength(cards: Card[]): number {
  if (cards.length < 2) return 0;

  const [c1, c2] = [cards[0]!, cards[1]!];
  const r1 = c1.rank;
  const r2 = c2.rank;
  const suited = c1.suit === c2.suit;

  // Normalize: put higher rank first
  const rankOrder = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'] as const;
  const idx1 = rankOrder.indexOf(r1 as typeof rankOrder[number]);
  const idx2 = rankOrder.indexOf(r2 as typeof rankOrder[number]);
  const [hi, lo] = idx1 >= idx2 ? [r1, r2] : [r2, r1];
  const hiIdx = Math.max(idx1, idx2);
  const loIdx = Math.min(idx1, idx2);

  // Pocket pairs
  if (hi === lo) {
    if (hi === 'A') return 10;
    if (hi === 'K') return 10;
    if (hi === 'Q' || hi === 'J') return 9;
    if (hi === '10' || hi === '9') return 8;
    if (hi === '8') return 7;
    if (hi === '7') return 6;
    if (hi === '6') return 5;
    if (hi === '5') return 4;
    if (hi === '4') return 3;
    if (hi === '3') return 2;
    if (hi === '2') return 1;
    return 1;
  }

  // Ace-high hands
  if (hi === 'A') {
    if (lo === 'K') return suited ? 8 : 7;
    if (lo === 'Q') return suited ? 7 : 6;
    if (lo === 'J') return suited ? 6 : 5;
    if (lo === '10') return suited ? 5 : 4;
    // A9–A7 offsuit: 3; A9–A2 suited: 4
    if (loIdx >= 5 && loIdx <= 7) return suited ? 4 : 3; // A7-A9
    // A6-A2 offsuit: 2; A6-A2 suited also: 4
    if (loIdx >= 0 && loIdx <= 6) return suited ? 4 : 2;
    return suited ? 4 : 2;
  }

  // King-high hands
  if (hi === 'K') {
    if (lo === 'Q') return suited ? 6 : 5;
    if (lo === 'J') return suited ? 5 : 4;
    if (lo === '10') return suited ? 4 : 3;
    // K9-K2 suited: 2
    if (suited) return 2;
    return 0;
  }

  // Queen-high hands
  if (hi === 'Q') {
    if (lo === 'J') return suited ? 5 : 4;
    if (lo === '10') return suited ? 4 : 3;
    // Q9-Q2 suited: 2
    if (suited) return 2;
    return 0;
  }

  // Jack-high hands
  if (hi === 'J') {
    if (lo === '10') return suited ? 4 : 3;
    if (lo === '9') return suited ? 3 : 0;
    if (lo === '8') return suited ? 1 : 0;
    return 0;
  }

  // Ten-high hands
  if (hi === '10') {
    if (lo === '9') return suited ? 3 : 0;
    if (lo === '8') return suited ? 1 : 0;
    return 0;
  }

  // Small suited connectors
  const gap = hiIdx - loIdx;
  if (suited && gap === 1) return 1;

  return 0;
}

/**
 * Compute post-flop hand strength (0–9) using the evaluator.
 * Requires at least 3 community cards + 2 hole cards (≥5 total).
 */
export function postFlopStrength(holeCards: Card[], community: Card[]): number {
  const allCards = [...holeCards, ...community];
  if (allCards.length < 5) return 0;

  try {
    const evaluated = evaluateHand(allCards);
    return HAND_RANK_STRENGTH[evaluated.rank] ?? 0;
  } catch {
    return 0;
  }
}

/**
 * Dispatch to pre-flop or post-flop strength computation.
 */
export function computeHandStrength(holeCards: Card[], community: Card[]): number {
  if (community.length >= 3) {
    return postFlopStrength(holeCards, community);
  }
  return preFlopStrength(holeCards);
}

// ─── Action helpers ───────────────────────────────────────────────────────────

/** Return the first available action from a priority list, falling back to fold. */
function pickAction(validActions: ActionType[], priority: ActionType[]): PlayerAction {
  for (const a of priority) {
    if (validActions.includes(a)) return { type: a };
  }
  // Ultimate fallback
  if (validActions.includes('fold')) return { type: 'fold' };
  return { type: validActions[0]! };
}

function makeRaise(validActions: ActionType[], amount: number): PlayerAction {
  if (validActions.includes('raise')) return { type: 'raise', amount };
  return pickAction(validActions, ['call', 'check', 'fold']);
}

function callOrCheck(validActions: ActionType[]): PlayerAction {
  return pickAction(validActions, ['check', 'call', 'fold']);
}

// ─── Bot strategies ───────────────────────────────────────────────────────────

/**
 * NitBot: Only plays premium hands.
 * Pre-flop: strength ≥ 8 → raise; ≥ 6 → call/check; else → fold.
 * Post-flop: strength ≥ 4 → raise; ≥ 2 → call/check; else → fold.
 */
function nitStrategy(
  validActions: ActionType[],
  state: GameState,
  strength: number,
  isPreFlop: boolean,
): PlayerAction {
  if (isPreFlop) {
    if (strength >= 8) return makeRaise(validActions, state.minRaise);
    if (strength >= 6) return callOrCheck(validActions);
    return pickAction(validActions, ['fold', 'check']);
  } else {
    if (strength >= 4) return makeRaise(validActions, state.minRaise);
    if (strength >= 2) return callOrCheck(validActions);
    return pickAction(validActions, ['fold', 'check']);
  }
}

/**
 * PassiveBot / CallBot: Never raises, always calls or checks.
 */
function passiveStrategy(validActions: ActionType[]): PlayerAction {
  return pickAction(validActions, ['check', 'call', 'fold']);
}

/**
 * TagBot: Tight-Aggressive.
 * Pre-flop: strength ≥ 6 → 60% raise else call; strength ≤ 3 → 70% fold.
 * Post-flop: strength ≥ 3 → 70% raise else call; strength ≤ 0 → 30% fold.
 */
function tagStrategy(
  validActions: ActionType[],
  state: GameState,
  strength: number,
  isPreFlop: boolean,
): PlayerAction {
  const r = Math.random();
  if (isPreFlop) {
    if (strength <= 3 && r < 0.70) return pickAction(validActions, ['fold', 'check']);
    if (strength >= 6) {
      if (r < 0.60) return makeRaise(validActions, state.minRaise);
      return callOrCheck(validActions);
    }
    return callOrCheck(validActions);
  } else {
    if (strength <= 0 && r < 0.30) return pickAction(validActions, ['fold', 'check']);
    if (strength >= 3) {
      if (r < 0.70) return makeRaise(validActions, state.minRaise);
      return callOrCheck(validActions);
    }
    return callOrCheck(validActions);
  }
}

/**
 * LagBot: Loose-Aggressive.
 * Pre-flop: strength ≥ 3 → 50% raise else call; strength == 0 → 50% fold.
 * Post-flop: strength ≥ 1 → 50% raise else call/check; strength == 0 → 40% fold.
 */
function lagStrategy(
  validActions: ActionType[],
  state: GameState,
  strength: number,
  isPreFlop: boolean,
): PlayerAction {
  const r = Math.random();
  if (isPreFlop) {
    if (strength === 0 && r < 0.50) return pickAction(validActions, ['fold', 'check']);
    if (strength >= 3) {
      if (r < 0.50) return makeRaise(validActions, state.minRaise);
    }
    return callOrCheck(validActions);
  } else {
    if (strength === 0 && r < 0.40) return pickAction(validActions, ['fold', 'check']);
    if (strength >= 1) {
      if (r < 0.50) return makeRaise(validActions, state.minRaise);
    }
    return callOrCheck(validActions);
  }
}

/**
 * BluffBot: Frequent bluffer, unpredictable.
 * If strength ≥ 5 → raise 80% (value bet).
 * Otherwise: 60% raise (bluff), 30% call/check, 10% fold.
 */
function bluffStrategy(validActions: ActionType[], state: GameState, strength: number): PlayerAction {
  const r = Math.random();
  if (strength >= 5) {
    if (r < 0.80) return makeRaise(validActions, state.minRaise);
    return callOrCheck(validActions);
  }
  // Bluff range
  if (r < 0.60) return makeRaise(validActions, state.minRaise);
  if (r < 0.90) return callOrCheck(validActions);
  return pickAction(validActions, ['fold', 'check']);
}

/**
 * ManiacBot: Always raises or goes all-in.
 */
function maniacStrategy(validActions: ActionType[], state: GameState): PlayerAction {
  if (validActions.includes('raise')) return { type: 'raise', amount: state.minRaise };
  if (validActions.includes('all_in')) return { type: 'all_in' };
  if (validActions.includes('call')) return { type: 'call' };
  if (validActions.includes('check')) return { type: 'check' };
  return { type: 'fold' };
}

/**
 * RandomBot: Weighted random.
 * fold 15%, raise 5% (min raise), check 20%, call 60%.
 */
function randomStrategy(validActions: ActionType[], state: GameState): PlayerAction {
  const r = Math.random();
  if (r < 0.15 && validActions.includes('fold')) return { type: 'fold' };
  if (r < 0.20 && validActions.includes('raise')) return { type: 'raise', amount: state.minRaise };
  if (validActions.includes('check')) return { type: 'check' };
  if (validActions.includes('call')) return { type: 'call' };
  return { type: 'fold' };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Resolve a bot action locally without HTTP.
 * Dispatches to the correct strategy based on the bot:// URL.
 *
 * Guards:
 * - Falls back to randomStrategy when actor or actor's cards are missing.
 * - Each strategy always returns a valid action from validActions.
 */
export function resolveBotAction(
  botUrl: string,
  validActions: ActionType[],
  state: GameState,
): PlayerAction {
  if (validActions.length === 0) return { type: 'fold' };

  const strategy = botUrl.replace('bot://', '').toLowerCase();

  // Guard: if no current actor or no hole cards, fall back to random
  const actorIdx = state.currentActorIndex;
  if (actorIdx === null || actorIdx === undefined) {
    return randomStrategy(validActions, state);
  }

  const actor = state.players[actorIdx];
  if (!actor || !actor.cards || actor.cards.length === 0) {
    return randomStrategy(validActions, state);
  }

  const community = state.communityCards;
  const isPreFlop = community.length < 3;
  const strength = computeHandStrength(actor.cards, community);

  switch (strategy) {
    case 'nit':
      return nitStrategy(validActions, state, strength, isPreFlop);

    case 'passive':
    case 'call':
      return passiveStrategy(validActions);

    case 'tag':
      return tagStrategy(validActions, state, strength, isPreFlop);

    case 'lag':
      return lagStrategy(validActions, state, strength, isPreFlop);

    case 'bluff':
      return bluffStrategy(validActions, state, strength);

    case 'maniac':
      return maniacStrategy(validActions, state);

    case 'random':
    default:
      return randomStrategy(validActions, state);
  }
}

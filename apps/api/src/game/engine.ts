import type {
  Card,
  GameState,
  GameStage,
  PlayerState,
  PlayerAction,
  ActionType,
  Winner,
} from '@agon/types';
import { createDeck, shuffleDeck } from './deck.js';
import { evaluateHand, compareHands } from './evaluator.js';
import { calculatePots } from './pot.js';

export interface GameConfig {
  arenaId: string;
  players: Array<{ agentId: string; agentName: string; stack: number }>;
  smallBlind: number;
  bigBlind: number;
  dealerIndex: number;
}

/**
 * Create a new game hand with blinds posted.
 */
export function createGame(config: GameConfig): { state: GameState; deck: Card[] } {
  const { arenaId, players: playerConfigs, smallBlind, bigBlind, dealerIndex } = config;

  if (playerConfigs.length < 2) throw new Error('Need at least 2 players');
  if (playerConfigs.length > 10) throw new Error('Maximum 10 players');

  const n = playerConfigs.length;
  const deck = shuffleDeck(createDeck());

  // Heads-up: dealer is SB, other is BB
  // Multi-way: SB is dealer+1, BB is dealer+2
  const smallBlindIndex = n === 2 ? dealerIndex : (dealerIndex + 1) % n;
  const bigBlindIndex = n === 2 ? (dealerIndex + 1) % n : (dealerIndex + 2) % n;

  const players: PlayerState[] = playerConfigs.map((p, i) => ({
    agentId: p.agentId,
    agentName: p.agentName,
    position: i,
    stack: p.stack,
    bet: 0,
    totalBet: 0,
    cards: [],
    isActive: true,
    isFolded: false,
    isAllIn: false,
    hasActed: false,
  }));

  // Post blinds
  postBlind(players[smallBlindIndex]!, smallBlind);
  postBlind(players[bigBlindIndex]!, bigBlind);

  // Deal 2 hole cards to each player
  for (const player of players) {
    player.cards = [deck.pop()!, deck.pop()!];
  }

  // First to act pre-flop is UTG (player after BB)
  const firstToAct = (bigBlindIndex + 1) % n;

  const state: GameState = {
    arenaId,
    handId: crypto.randomUUID(),
    handNumber: 0, // Caller should set this
    stage: 'pre_flop',
    players,
    communityCards: [],
    pots: [{ amount: smallBlind + bigBlind, eligiblePlayers: players.map((p) => p.agentId) }],
    currentActorIndex: firstToAct,
    dealerIndex,
    smallBlindIndex,
    bigBlindIndex,
    smallBlindAmount: smallBlind,
    bigBlindAmount: bigBlind,
    minRaise: bigBlind,
  };

  return { state, deck };
}

function postBlind(player: PlayerState, amount: number): void {
  const actual = Math.min(amount, player.stack);
  player.bet = actual;
  player.totalBet = actual;
  player.stack -= actual;
  if (player.stack === 0) player.isAllIn = true;
}

/**
 * Get valid actions for the current actor.
 */
export function getValidActions(state: GameState): ActionType[] {
  const actor = state.players[state.currentActorIndex!];
  if (!actor || actor.isFolded || actor.isAllIn) return [];

  const actions: ActionType[] = ['fold'];
  const maxBet = Math.max(...state.players.map((p) => p.bet));
  const toCall = maxBet - actor.bet;

  if (toCall === 0) {
    actions.push('check');
  } else {
    actions.push('call');
  }

  // Can raise if has enough chips
  if (actor.stack > toCall) {
    actions.push('raise');
  }

  // All-in is always an option (unless already all-in)
  actions.push('all_in');

  return actions;
}

/**
 * Process a player action and return the updated state.
 * This is the core state machine transition function.
 */
export function processAction(
  state: GameState,
  action: PlayerAction,
  deck: Card[],
): GameState {
  const newState = structuredClone(state);
  const actorIdx = newState.currentActorIndex;
  if (actorIdx === null) throw new Error('No current actor');

  const actor = newState.players[actorIdx]!;
  if (actor.isFolded || actor.isAllIn) throw new Error('Actor cannot act');

  const maxBet = Math.max(...newState.players.map((p) => p.bet));
  const toCall = maxBet - actor.bet;

  switch (action.type) {
    case 'fold':
      actor.isFolded = true;
      actor.isActive = false;
      actor.hasActed = true;
      break;

    case 'check':
      if (toCall > 0) throw new Error('Cannot check, must call or fold');
      actor.hasActed = true;
      break;

    case 'call': {
      const callAmount = Math.min(toCall, actor.stack);
      actor.bet += callAmount;
      actor.totalBet += callAmount;
      actor.stack -= callAmount;
      actor.hasActed = true;
      if (actor.stack === 0) actor.isAllIn = true;
      break;
    }

    case 'raise': {
      const raiseAmount = action.amount ?? newState.minRaise;
      const totalNeeded = toCall + raiseAmount;

      if (raiseAmount < newState.minRaise && totalNeeded < actor.stack) {
        throw new Error(`Raise must be at least ${newState.minRaise}`);
      }

      const actual = Math.min(totalNeeded, actor.stack);
      actor.bet += actual;
      actor.totalBet += actual;
      actor.stack -= actual;
      actor.hasActed = true;

      if (actor.stack === 0) actor.isAllIn = true;

      // Update min raise
      const raiseSize = actor.bet - maxBet;
      if (raiseSize > newState.minRaise) {
        newState.minRaise = raiseSize;
      }

      // Reset hasActed for other active players (they need to respond)
      for (let i = 0; i < newState.players.length; i++) {
        if (i !== actorIdx && !newState.players[i]!.isFolded && !newState.players[i]!.isAllIn) {
          newState.players[i]!.hasActed = false;
        }
      }
      break;
    }

    case 'all_in': {
      const allInAmount = actor.stack;
      actor.bet += allInAmount;
      actor.totalBet += allInAmount;
      actor.stack = 0;
      actor.isAllIn = true;
      actor.hasActed = true;

      // If this raises above current max, reset others
      if (actor.bet > maxBet) {
        newState.minRaise = Math.max(newState.minRaise, actor.bet - maxBet);
        for (let i = 0; i < newState.players.length; i++) {
          if (i !== actorIdx && !newState.players[i]!.isFolded && !newState.players[i]!.isAllIn) {
            newState.players[i]!.hasActed = false;
          }
        }
      }
      break;
    }
  }

  newState.lastAction = {
    agentId: actor.agentId,
    action,
    timestamp: Date.now(),
  };

  // Check if only one player remains (everyone else folded)
  const activePlayers = newState.players.filter((p) => !p.isFolded);
  if (activePlayers.length === 1) {
    newState.pots = calculatePots(newState.players);
    newState.stage = 'finished';
    newState.currentActorIndex = null;
    return newState;
  }

  // Check if betting round is complete
  if (isBettingRoundComplete(newState)) {
    advanceStage(newState, deck);
  } else {
    // Move to next active player
    newState.currentActorIndex = findNextActor(newState, actorIdx);
  }

  return newState;
}

function isBettingRoundComplete(state: GameState): boolean {
  const activePlayers = state.players.filter((p) => !p.isFolded && !p.isAllIn);

  // All active (non-folded, non-all-in) players must have acted
  if (!activePlayers.every((p) => p.hasActed)) return false;

  // All active players' bets must be equal
  if (activePlayers.length > 0) {
    const maxBet = Math.max(...activePlayers.map((p) => p.bet));
    if (!activePlayers.every((p) => p.bet === maxBet)) return false;
  }

  return true;
}

function findNextActor(state: GameState, fromIndex: number): number | null {
  const n = state.players.length;
  for (let i = 1; i < n; i++) {
    const idx = (fromIndex + i) % n;
    const player = state.players[idx]!;
    if (!player.isFolded && !player.isAllIn && !player.hasActed) {
      return idx;
    }
  }
  return null;
}

const STAGE_ORDER: GameStage[] = ['pre_flop', 'flop', 'turn', 'river', 'showdown', 'finished'];

function advanceStage(state: GameState, deck: Card[]): void {
  const currentIdx = STAGE_ORDER.indexOf(state.stage);
  const nextStage = STAGE_ORDER[currentIdx + 1];
  if (!nextStage) return;

  // Recalculate pots before advancing
  state.pots = calculatePots(state.players);

  // Reset bets for new round
  for (const p of state.players) {
    p.bet = 0;
    p.hasActed = false;
  }

  // Check if we need to run out the board (all players all-in or folded)
  const canAct = state.players.filter((p) => !p.isFolded && !p.isAllIn);

  if (canAct.length <= 1) {
    // Run out remaining community cards
    while (state.communityCards.length < 5) {
      deck.pop(); // burn
      if (state.communityCards.length < 3) {
        state.communityCards.push(deck.pop()!, deck.pop()!, deck.pop()!);
      } else {
        state.communityCards.push(deck.pop()!);
      }
    }
    state.stage = 'showdown';
    state.currentActorIndex = null;
    return;
  }

  switch (nextStage) {
    case 'flop':
      deck.pop(); // burn
      state.communityCards.push(deck.pop()!, deck.pop()!, deck.pop()!);
      break;
    case 'turn':
      deck.pop(); // burn
      state.communityCards.push(deck.pop()!);
      break;
    case 'river':
      deck.pop(); // burn
      state.communityCards.push(deck.pop()!);
      break;
    case 'showdown':
      state.currentActorIndex = null;
      state.stage = 'showdown';
      return;
  }

  state.stage = nextStage;
  state.minRaise = state.bigBlindAmount;

  // First to act post-flop: first active player after dealer
  const n = state.players.length;
  for (let i = 1; i <= n; i++) {
    const idx = (state.dealerIndex + i) % n;
    const p = state.players[idx]!;
    if (!p.isFolded && !p.isAllIn) {
      state.currentActorIndex = idx;
      return;
    }
  }

  state.currentActorIndex = null;
}

/**
 * Determine the winners for a completed hand.
 */
export function getWinners(state: GameState): Winner[] {
  const activePlayers = state.players.filter((p) => !p.isFolded);

  // If only one player left, they win everything
  if (activePlayers.length === 1) {
    const winner = activePlayers[0]!;
    const totalPot = state.pots.reduce((sum, p) => sum + p.amount, 0);
    return [{
      agentId: winner.agentId,
      amount: totalPot,
    }];
  }

  // Evaluate hands
  const handResults = activePlayers.map((p) => ({
    player: p,
    hand: evaluateHand([...p.cards, ...state.communityCards]),
  }));

  const winners: Winner[] = [];

  for (const pot of state.pots) {
    // Filter to eligible players for this pot
    const eligible = handResults.filter((h) =>
      pot.eligiblePlayers.includes(h.player.agentId)
    );

    if (eligible.length === 0) continue;

    // Find the best hand among eligible
    eligible.sort((a, b) => compareHands(b.hand, a.hand));
    const bestHand = eligible[0]!.hand;

    // Find all players that tie with the best
    const potWinners = eligible.filter(
      (h) => compareHands(h.hand, bestHand) === 0
    );

    // Split pot equally
    const share = Math.floor(pot.amount / potWinners.length);
    const remainder = pot.amount % potWinners.length;

    for (let i = 0; i < potWinners.length; i++) {
      const pw = potWinners[i]!;
      const existing = winners.find((w) => w.agentId === pw.player.agentId);
      const winAmount = share + (i === 0 ? remainder : 0);

      if (existing) {
        existing.amount += winAmount;
      } else {
        winners.push({
          agentId: pw.player.agentId,
          amount: winAmount,
          hand: pw.hand.cards,
          handRank: pw.hand.rank,
          handDescription: pw.hand.description,
        });
      }
    }
  }

  return winners;
}

/**
 * Check if the game hand is over.
 */
export function isHandOver(state: GameState): boolean {
  return state.stage === 'finished' || state.stage === 'showdown';
}

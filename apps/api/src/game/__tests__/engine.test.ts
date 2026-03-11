import { describe, it, expect } from 'vitest';
import { createGame, processAction, getValidActions, getWinners, isHandOver } from '../engine.js';
import type { GameConfig } from '../engine.js';
import type { Card } from '@agon/types';

function makeConfig(overrides?: Partial<GameConfig>): GameConfig {
  return {
    arenaId: 'test-arena',
    players: [
      { agentId: 'p1', agentName: 'Player 1', stack: 1000 },
      { agentId: 'p2', agentName: 'Player 2', stack: 1000 },
      { agentId: 'p3', agentName: 'Player 3', stack: 1000 },
    ],
    smallBlind: 10,
    bigBlind: 20,
    dealerIndex: 0,
    ...overrides,
  };
}

describe('createGame', () => {
  it('creates a valid game state', () => {
    const { state } = createGame(makeConfig());
    expect(state.stage).toBe('pre_flop');
    expect(state.players).toHaveLength(3);
    expect(state.communityCards).toHaveLength(0);
  });

  it('posts blinds correctly (3 players)', () => {
    const { state } = createGame(makeConfig());
    // Dealer=0, SB=1, BB=2
    expect(state.players[1]!.bet).toBe(10); // SB
    expect(state.players[1]!.stack).toBe(990);
    expect(state.players[2]!.bet).toBe(20); // BB
    expect(state.players[2]!.stack).toBe(980);
  });

  it('posts blinds correctly (heads-up)', () => {
    const config = makeConfig({
      players: [
        { agentId: 'p1', agentName: 'Player 1', stack: 1000 },
        { agentId: 'p2', agentName: 'Player 2', stack: 1000 },
      ],
    });
    const { state } = createGame(config);
    // Heads-up: dealer is SB
    expect(state.players[0]!.bet).toBe(10); // Dealer=SB
    expect(state.players[1]!.bet).toBe(20); // BB
  });

  it('deals 2 cards to each player', () => {
    const { state } = createGame(makeConfig());
    for (const p of state.players) {
      expect(p.cards).toHaveLength(2);
    }
  });

  it('first to act is UTG (after BB)', () => {
    const { state } = createGame(makeConfig());
    // Dealer=0, SB=1, BB=2, UTG=0
    expect(state.currentActorIndex).toBe(0);
  });
});

describe('processAction', () => {
  it('handles fold', () => {
    const { state, deck } = createGame(makeConfig());
    const newState = processAction(state, { type: 'fold' }, deck);
    expect(newState.players[0]!.isFolded).toBe(true);
  });

  it('handles call', () => {
    const { state, deck } = createGame(makeConfig());
    const newState = processAction(state, { type: 'call' }, deck);
    expect(newState.players[0]!.bet).toBe(20);
    expect(newState.players[0]!.stack).toBe(980);
  });

  it('handles raise', () => {
    const { state, deck } = createGame(makeConfig());
    const newState = processAction(state, { type: 'raise', amount: 40 }, deck);
    // Call 20 + raise 40 = 60 total bet
    expect(newState.players[0]!.bet).toBe(60);
    expect(newState.players[0]!.stack).toBe(940);
  });

  it('everyone folds gives winner immediately', () => {
    const config = makeConfig({
      players: [
        { agentId: 'p1', agentName: 'Player 1', stack: 1000 },
        { agentId: 'p2', agentName: 'Player 2', stack: 1000 },
      ],
    });
    const { state, deck } = createGame(config);
    // In heads-up: dealer(0)=SB, other(1)=BB. First to act pre-flop: player 0 (SB/dealer)
    const afterFold = processAction(state, { type: 'fold' }, deck);
    expect(afterFold.stage).toBe('finished');
    expect(isHandOver(afterFold)).toBe(true);
  });

  it('advances to flop after all call', () => {
    const { state, deck } = createGame(makeConfig());
    // UTG (p1@idx0) calls
    let s = processAction(state, { type: 'call' }, deck);
    // SB (p2@idx1) calls
    s = processAction(s, { type: 'call' }, deck);
    // BB (p3@idx2) checks
    s = processAction(s, { type: 'check' }, deck);
    expect(s.stage).toBe('flop');
    expect(s.communityCards).toHaveLength(3);
  });

  it('completes a full hand through showdown', () => {
    const { state, deck } = createGame(makeConfig());
    let s = state;

    // Pre-flop: everyone calls
    s = processAction(s, { type: 'call' }, deck);
    s = processAction(s, { type: 'call' }, deck);
    s = processAction(s, { type: 'check' }, deck);
    expect(s.stage).toBe('flop');

    // Flop: everyone checks
    s = processAction(s, { type: 'check' }, deck);
    s = processAction(s, { type: 'check' }, deck);
    s = processAction(s, { type: 'check' }, deck);
    expect(s.stage).toBe('turn');

    // Turn: everyone checks
    s = processAction(s, { type: 'check' }, deck);
    s = processAction(s, { type: 'check' }, deck);
    s = processAction(s, { type: 'check' }, deck);
    expect(s.stage).toBe('river');

    // River: everyone checks
    s = processAction(s, { type: 'check' }, deck);
    s = processAction(s, { type: 'check' }, deck);
    s = processAction(s, { type: 'check' }, deck);
    expect(s.stage).toBe('showdown');
    expect(s.communityCards).toHaveLength(5);

    // Get winners
    const winners = getWinners(s);
    expect(winners.length).toBeGreaterThan(0);
    const totalWinnings = winners.reduce((sum, w) => sum + w.amount, 0);
    expect(totalWinnings).toBe(60); // 3 players * 20 BB each
  });
});

describe('getValidActions', () => {
  it('returns correct actions pre-flop for UTG', () => {
    const { state } = createGame(makeConfig());
    const actions = getValidActions(state);
    expect(actions).toContain('fold');
    expect(actions).toContain('call');
    expect(actions).toContain('raise');
    expect(actions).toContain('all_in');
    expect(actions).not.toContain('check');
  });

  it('returns check option when no bet to call', () => {
    const { state, deck } = createGame(makeConfig());
    // UTG calls, SB calls, BB can check
    let s = processAction(state, { type: 'call' }, deck);
    s = processAction(s, { type: 'call' }, deck);
    const actions = getValidActions(s);
    expect(actions).toContain('check');
  });
});

describe('all-in scenarios', () => {
  it('handles short-stack all-in', () => {
    const config = makeConfig({
      players: [
        { agentId: 'p1', agentName: 'Short', stack: 50 },
        { agentId: 'p2', agentName: 'Deep', stack: 1000 },
      ],
    });
    const { state, deck } = createGame(config);
    // Short stack all-in
    const s = processAction(state, { type: 'all_in' }, deck);
    const shortPlayer = s.players.find((p) => p.agentId === 'p1')!;
    expect(shortPlayer.isAllIn).toBe(true);
    expect(shortPlayer.stack).toBe(0);
  });
});

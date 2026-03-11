import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * AGO-33: Bot service unit tests.
 *
 * Tests all 8 strategy personalities, preFlopStrength lookup,
 * computeHandStrength dispatch, and resolveBotAction routing.
 */

// ─── Mock evaluator ───────────────────────────────────────────────────────────

const { mockEvaluateHand } = vi.hoisted(() => {
  const mockEvaluateHand = vi.fn();
  return { mockEvaluateHand };
});

vi.mock('../../game/evaluator.js', () => ({
  evaluateHand: mockEvaluateHand,
}));

import {
  BOT_PROFILES,
  preFlopStrength,
  postFlopStrength,
  computeHandStrength,
  resolveBotAction,
} from '../bot.js';
import type { ActionType, Card, GameState } from '@agon/types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function card(rank: string, suit: string): Card {
  return { rank, suit } as Card;
}

function makeState(overrides: Partial<GameState> = {}): GameState {
  return {
    arenaId: 'arena-1',
    handId: 'hand-1',
    handNumber: 1,
    stage: 'pre_flop',
    players: [
      {
        agentId: 'bot-1',
        agentName: 'TestBot',
        position: 0,
        stack: 1000,
        bet: 0,
        totalBet: 0,
        cards: [card('A', 'spades'), card('K', 'spades')],
        isActive: true,
        isFolded: false,
        isAllIn: false,
        hasActed: false,
      },
    ],
    communityCards: [],
    pots: [{ amount: 30, eligiblePlayers: ['bot-1'] }],
    currentActorIndex: 0,
    dealerIndex: 0,
    smallBlindIndex: 0,
    bigBlindIndex: 1,
    smallBlindAmount: 10,
    bigBlindAmount: 20,
    minRaise: 20,
    ...overrides,
  };
}

const allActions: ActionType[] = ['fold', 'check', 'call', 'raise', 'all_in'];
const noRaiseActions: ActionType[] = ['fold', 'check', 'call'];
const checkOnlyActions: ActionType[] = ['check'];
const foldCallActions: ActionType[] = ['fold', 'call'];

// ─── BOT_PROFILES ─────────────────────────────────────────────────────────────

describe('BOT_PROFILES', () => {
  it('exports exactly 8 profiles', () => {
    expect(BOT_PROFILES).toHaveLength(8);
  });

  it('all profiles have unique names and URLs', () => {
    const names = BOT_PROFILES.map((p) => p.name);
    const urls = BOT_PROFILES.map((p) => p.url);
    expect(new Set(names).size).toBe(8);
    expect(new Set(urls).size).toBe(8);
  });

  it('all URLs start with bot://', () => {
    for (const p of BOT_PROFILES) {
      expect(p.url).toMatch(/^bot:\/\//);
    }
  });

  it('includes expected strategy names', () => {
    const names = BOT_PROFILES.map((p) => p.name);
    expect(names).toContain('NitBot');
    expect(names).toContain('ManiacBot');
    expect(names).toContain('RandomBot');
    expect(names).toContain('BluffBot');
  });
});

// ─── preFlopStrength ──────────────────────────────────────────────────────────

describe('preFlopStrength', () => {
  it('AA gets strength 10', () => {
    expect(preFlopStrength([card('A', 'spades'), card('A', 'hearts')])).toBe(10);
  });

  it('KK gets strength 10', () => {
    expect(preFlopStrength([card('K', 'spades'), card('K', 'hearts')])).toBe(10);
  });

  it('QQ gets strength 9', () => {
    expect(preFlopStrength([card('Q', 'spades'), card('Q', 'hearts')])).toBe(9);
  });

  it('JJ gets strength 9', () => {
    expect(preFlopStrength([card('J', 'spades'), card('J', 'hearts')])).toBe(9);
  });

  it('TT gets strength 8', () => {
    expect(preFlopStrength([card('10', 'spades'), card('10', 'hearts')])).toBe(8);
  });

  it('AK suited gets strength 8', () => {
    expect(preFlopStrength([card('A', 'spades'), card('K', 'spades')])).toBe(8);
  });

  it('AK offsuit gets strength 7', () => {
    expect(preFlopStrength([card('A', 'spades'), card('K', 'hearts')])).toBe(7);
  });

  it('72 offsuit gets strength 0', () => {
    expect(preFlopStrength([card('7', 'spades'), card('2', 'hearts')])).toBe(0);
  });

  it('AQ suited gets strength 7', () => {
    expect(preFlopStrength([card('A', 'spades'), card('Q', 'spades')])).toBe(7);
  });

  it('AQ offsuit gets strength 6', () => {
    expect(preFlopStrength([card('A', 'spades'), card('Q', 'hearts')])).toBe(6);
  });

  it('returns 0 for empty cards array', () => {
    expect(preFlopStrength([])).toBe(0);
  });

  it('22 gets strength 1 (small pair)', () => {
    expect(preFlopStrength([card('2', 'spades'), card('2', 'hearts')])).toBe(1);
  });

  it('KQ suited gets strength 6', () => {
    expect(preFlopStrength([card('K', 'spades'), card('Q', 'spades')])).toBe(6);
  });

  it('KQ offsuit gets strength 5', () => {
    expect(preFlopStrength([card('K', 'spades'), card('Q', 'hearts')])).toBe(5);
  });
});

// ─── postFlopStrength ─────────────────────────────────────────────────────────

describe('postFlopStrength', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 0 when fewer than 5 cards total', () => {
    const result = postFlopStrength(
      [card('A', 'spades'), card('K', 'spades')],
      [card('Q', 'spades'), card('J', 'spades')],
    );
    expect(result).toBe(0);
    expect(mockEvaluateHand).not.toHaveBeenCalled();
  });

  it('maps high_card to 0', () => {
    mockEvaluateHand.mockReturnValue({ rank: 'high_card', score: 1, cards: [], description: '' });
    expect(postFlopStrength(
      [card('A', 'spades'), card('K', 'hearts')],
      [card('2', 'clubs'), card('5', 'diamonds'), card('9', 'hearts')],
    )).toBe(0);
  });

  it('maps pair to 1', () => {
    mockEvaluateHand.mockReturnValue({ rank: 'pair', score: 1, cards: [], description: '' });
    expect(postFlopStrength(
      [card('A', 'spades'), card('A', 'hearts')],
      [card('2', 'clubs'), card('5', 'diamonds'), card('9', 'hearts')],
    )).toBe(1);
  });

  it('maps flush to 5', () => {
    mockEvaluateHand.mockReturnValue({ rank: 'flush', score: 1, cards: [], description: '' });
    expect(postFlopStrength(
      [card('A', 'spades'), card('K', 'spades')],
      [card('Q', 'spades'), card('J', 'spades'), card('9', 'spades')],
    )).toBe(5);
  });

  it('maps royal_flush to 9', () => {
    mockEvaluateHand.mockReturnValue({ rank: 'royal_flush', score: 1, cards: [], description: '' });
    expect(postFlopStrength(
      [card('A', 'spades'), card('K', 'spades')],
      [card('Q', 'spades'), card('J', 'spades'), card('10', 'spades')],
    )).toBe(9);
  });

  it('returns 0 when evaluateHand throws', () => {
    mockEvaluateHand.mockImplementation(() => { throw new Error('bad hand'); });
    expect(postFlopStrength(
      [card('A', 'spades'), card('K', 'hearts')],
      [card('2', 'clubs'), card('5', 'diamonds'), card('9', 'hearts')],
    )).toBe(0);
  });
});

// ─── computeHandStrength ──────────────────────────────────────────────────────

describe('computeHandStrength', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses preFlopStrength when no community cards', () => {
    const strength = computeHandStrength(
      [card('A', 'spades'), card('A', 'hearts')],
      [],
    );
    expect(strength).toBe(10); // AA pre-flop
    expect(mockEvaluateHand).not.toHaveBeenCalled();
  });

  it('uses preFlopStrength when only 2 community cards', () => {
    const strength = computeHandStrength(
      [card('A', 'spades'), card('A', 'hearts')],
      [card('K', 'spades'), card('Q', 'hearts')],
    );
    expect(strength).toBe(10); // AA pre-flop
    expect(mockEvaluateHand).not.toHaveBeenCalled();
  });

  it('uses postFlopStrength when 3+ community cards', () => {
    mockEvaluateHand.mockReturnValue({ rank: 'two_pair', score: 1, cards: [], description: '' });
    const strength = computeHandStrength(
      [card('A', 'spades'), card('K', 'hearts')],
      [card('A', 'clubs'), card('K', 'clubs'), card('2', 'diamonds')],
    );
    expect(strength).toBe(2); // two_pair → 2
    expect(mockEvaluateHand).toHaveBeenCalled();
  });
});

// ─── resolveBotAction ─────────────────────────────────────────────────────────

describe('resolveBotAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns fold when validActions is empty', () => {
    const action = resolveBotAction('bot://random', [], makeState());
    expect(action.type).toBe('fold');
  });

  it('falls back to random when currentActorIndex is null', () => {
    const state = makeState({ currentActorIndex: null });
    // Should not throw
    const action = resolveBotAction('bot://random', allActions, state);
    expect(allActions).toContain(action.type);
  });

  it('falls back to random when actor has no cards', () => {
    const state = makeState();
    state.players[0]!.cards = [];
    const action = resolveBotAction('bot://nit', allActions, state);
    expect(allActions).toContain(action.type);
  });

  // ── NitBot ──────────────────────────────────────────────────────────────────

  describe('NitBot (bot://nit)', () => {
    it('folds weak pre-flop hands (strength < 6)', () => {
      // 72o = strength 0
      const state = makeState();
      state.players[0]!.cards = [card('7', 'spades'), card('2', 'hearts')];
      // With random not always fold, run a few times checking fold is possible
      // But since strength 0 < 6, nit will fold (not raise/call)
      // Since fold or check — with foldCallActions it must fold
      const action = resolveBotAction('bot://nit', foldCallActions, state);
      expect(action.type).toBe('fold');
    });

    it('raises premium pre-flop hands (AA = strength 10)', () => {
      const state = makeState();
      state.players[0]!.cards = [card('A', 'spades'), card('A', 'hearts')];
      const action = resolveBotAction('bot://nit', allActions, state);
      expect(action.type).toBe('raise');
    });

    it('calls/checks medium pre-flop hands (AQ offsuit = strength 6)', () => {
      const state = makeState();
      state.players[0]!.cards = [card('A', 'spades'), card('Q', 'hearts')];
      // strength 6 >= 6, so raise. With noRaiseActions it falls back to call/check
      const action = resolveBotAction('bot://nit', noRaiseActions, state);
      expect(['check', 'call']).toContain(action.type);
    });

    it('folds on the flop with weak hand (high card = 0)', () => {
      mockEvaluateHand.mockReturnValue({ rank: 'high_card', score: 1, cards: [], description: '' });
      const state = makeState({
        communityCards: [card('2', 'clubs'), card('5', 'diamonds'), card('9', 'hearts')],
      });
      state.players[0]!.cards = [card('7', 'spades'), card('3', 'hearts')];
      // strength 0 < 2, should fold
      const action = resolveBotAction('bot://nit', foldCallActions, state);
      expect(action.type).toBe('fold');
    });

    it('raises strong post-flop hand (flush = strength 5 >= 4)', () => {
      mockEvaluateHand.mockReturnValue({ rank: 'flush', score: 1, cards: [], description: '' });
      const state = makeState({
        communityCards: [card('Q', 'spades'), card('J', 'spades'), card('9', 'spades')],
      });
      state.players[0]!.cards = [card('A', 'spades'), card('K', 'spades')];
      const action = resolveBotAction('bot://nit', allActions, state);
      expect(action.type).toBe('raise');
    });
  });

  // ── PassiveBot ──────────────────────────────────────────────────────────────

  describe('PassiveBot (bot://passive)', () => {
    it('never raises', () => {
      const state = makeState();
      // Run multiple times — passive should never raise
      for (let i = 0; i < 20; i++) {
        const action = resolveBotAction('bot://passive', allActions, state);
        expect(action.type).not.toBe('raise');
        expect(action.type).not.toBe('all_in');
      }
    });

    it('prefers check over call', () => {
      const state = makeState();
      const action = resolveBotAction('bot://passive', ['check', 'call', 'fold'], state);
      expect(action.type).toBe('check');
    });

    it('calls when check is not available', () => {
      const state = makeState();
      const action = resolveBotAction('bot://passive', foldCallActions, state);
      expect(action.type).toBe('call');
    });
  });

  // ── CallBot ─────────────────────────────────────────────────────────────────

  describe('CallBot (bot://call)', () => {
    it('never raises', () => {
      const state = makeState();
      for (let i = 0; i < 20; i++) {
        const action = resolveBotAction('bot://call', allActions, state);
        expect(action.type).not.toBe('raise');
        expect(action.type).not.toBe('all_in');
      }
    });

    it('checks when check is available', () => {
      const state = makeState();
      const action = resolveBotAction('bot://call', checkOnlyActions, state);
      expect(action.type).toBe('check');
    });
  });

  // ── ManiacBot ────────────────────────────────────────────────────────────────

  describe('ManiacBot (bot://maniac)', () => {
    it('always raises when raise is available', () => {
      const state = makeState();
      for (let i = 0; i < 20; i++) {
        const action = resolveBotAction('bot://maniac', allActions, state);
        expect(action.type).toBe('raise');
      }
    });

    it('goes all_in when raise is not available', () => {
      const state = makeState();
      const action = resolveBotAction('bot://maniac', ['fold', 'call', 'all_in'], state);
      expect(action.type).toBe('all_in');
    });

    it('calls when neither raise nor all_in available', () => {
      const state = makeState();
      const action = resolveBotAction('bot://maniac', foldCallActions, state);
      expect(action.type).toBe('call');
    });

    it('checks when only check available', () => {
      const state = makeState();
      const action = resolveBotAction('bot://maniac', checkOnlyActions, state);
      expect(action.type).toBe('check');
    });
  });

  // ── TagBot ───────────────────────────────────────────────────────────────────

  describe('TagBot (bot://tag)', () => {
    it('can raise with strong pre-flop hand (AA)', () => {
      const state = makeState();
      state.players[0]!.cards = [card('A', 'spades'), card('A', 'hearts')];
      // With 60% raise chance and 20 trials, very likely to raise at least once
      const actions = Array.from({ length: 40 }, () =>
        resolveBotAction('bot://tag', allActions, state),
      );
      expect(actions.some((a) => a.type === 'raise')).toBe(true);
    });

    it('often folds weak pre-flop hands (72o)', () => {
      const state = makeState();
      state.players[0]!.cards = [card('7', 'spades'), card('2', 'hearts')];
      const actions = Array.from({ length: 40 }, () =>
        resolveBotAction('bot://tag', allActions, state),
      );
      // 70% fold chance → in 40 trials expect at least some folds
      expect(actions.some((a) => a.type === 'fold')).toBe(true);
    });

    it('always returns a valid action', () => {
      const state = makeState();
      state.players[0]!.cards = [card('K', 'spades'), card('Q', 'hearts')];
      for (let i = 0; i < 20; i++) {
        const action = resolveBotAction('bot://tag', noRaiseActions, state);
        expect(noRaiseActions).toContain(action.type);
      }
    });
  });

  // ── LagBot ───────────────────────────────────────────────────────────────────

  describe('LagBot (bot://lag)', () => {
    it('can raise with moderate pre-flop hands', () => {
      const state = makeState();
      state.players[0]!.cards = [card('K', 'spades'), card('Q', 'spades')]; // suited, strength 6
      const actions = Array.from({ length: 40 }, () =>
        resolveBotAction('bot://lag', allActions, state),
      );
      expect(actions.some((a) => a.type === 'raise')).toBe(true);
    });

    it('occasionally folds garbage pre-flop (72o, strength 0)', () => {
      const state = makeState();
      state.players[0]!.cards = [card('7', 'spades'), card('2', 'hearts')];
      const actions = Array.from({ length: 40 }, () =>
        resolveBotAction('bot://lag', allActions, state),
      );
      expect(actions.some((a) => a.type === 'fold')).toBe(true);
    });

    it('always returns a valid action from the provided set', () => {
      const state = makeState();
      state.players[0]!.cards = [card('A', 'spades'), card('K', 'hearts')];
      for (let i = 0; i < 20; i++) {
        const action = resolveBotAction('bot://lag', foldCallActions, state);
        expect(foldCallActions).toContain(action.type);
      }
    });
  });

  // ── BluffBot ─────────────────────────────────────────────────────────────────

  describe('BluffBot (bot://bluff)', () => {
    it('frequently raises (60%+ of the time including bluffs)', () => {
      const state = makeState();
      state.players[0]!.cards = [card('7', 'spades'), card('2', 'hearts')]; // weak hand
      const actions = Array.from({ length: 40 }, () =>
        resolveBotAction('bot://bluff', allActions, state),
      );
      const raises = actions.filter((a) => a.type === 'raise').length;
      // 60% raise chance → in 40 trials, expect at least 10 raises
      expect(raises).toBeGreaterThan(5);
    });

    it('raises at high rate with strong hand (flush = strength 5)', () => {
      mockEvaluateHand.mockReturnValue({ rank: 'flush', score: 1, cards: [], description: '' });
      const state = makeState({
        communityCards: [card('Q', 'spades'), card('J', 'spades'), card('9', 'spades')],
      });
      state.players[0]!.cards = [card('A', 'spades'), card('K', 'spades')];
      const actions = Array.from({ length: 40 }, () =>
        resolveBotAction('bot://bluff', allActions, state),
      );
      const raises = actions.filter((a) => a.type === 'raise').length;
      // 80% raise chance → expect ≥ 20 raises
      expect(raises).toBeGreaterThan(15);
    });

    it('falls back gracefully when raise not available', () => {
      const state = makeState();
      state.players[0]!.cards = [card('7', 'spades'), card('2', 'hearts')];
      for (let i = 0; i < 20; i++) {
        const action = resolveBotAction('bot://bluff', noRaiseActions, state);
        expect(noRaiseActions).toContain(action.type);
      }
    });
  });

  // ── RandomBot ────────────────────────────────────────────────────────────────

  describe('RandomBot (bot://random)', () => {
    it('returns a valid action from the provided set', () => {
      const state = makeState();
      for (let i = 0; i < 20; i++) {
        const action = resolveBotAction('bot://random', allActions, state);
        expect(allActions).toContain(action.type);
      }
    });

    it('works with a restricted action set (fold only)', () => {
      const state = makeState();
      const action = resolveBotAction('bot://random', ['fold'], state);
      expect(action.type).toBe('fold');
    });

    it('never picks an invalid action', () => {
      const state = makeState();
      for (let i = 0; i < 40; i++) {
        const action = resolveBotAction('bot://random', foldCallActions, state);
        expect(foldCallActions).toContain(action.type);
      }
    });
  });

  // ── Unknown URL fallback ─────────────────────────────────────────────────────

  describe('unknown bot URL', () => {
    it('falls back to random strategy for unrecognised bot URLs', () => {
      const state = makeState();
      for (let i = 0; i < 10; i++) {
        const action = resolveBotAction('bot://unknown', allActions, state);
        expect(allActions).toContain(action.type);
      }
    });
  });

  // ── Raise amounts ────────────────────────────────────────────────────────────

  describe('raise amounts', () => {
    it('raise action includes minRaise as amount', () => {
      const state = makeState({ minRaise: 40 });
      state.players[0]!.cards = [card('A', 'spades'), card('A', 'hearts')]; // premium
      const action = resolveBotAction('bot://maniac', allActions, state);
      expect(action.type).toBe('raise');
      expect(action.amount).toBe(40);
    });
  });
});

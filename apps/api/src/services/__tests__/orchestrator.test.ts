import { afterEach, describe, expect, it } from 'vitest';
import { resolveActionRoundMinMs, resolveArenaHandLimit } from '../orchestrator.js';

describe('resolveArenaHandLimit', () => {
  it('uses the arena maxHands value when it is a positive integer', () => {
    expect(resolveArenaHandLimit({
      smallBlind: 10,
      bigBlind: 20,
      startingStack: 1000,
      maxHands: 1,
    })).toBe(1);
  });

  it('falls back to the bounded default when maxHands is zero or missing', () => {
    expect(resolveArenaHandLimit({
      smallBlind: 10,
      bigBlind: 20,
      startingStack: 1000,
      maxHands: 0,
    })).toBe(100);

    expect(resolveArenaHandLimit({
      smallBlind: 10,
      bigBlind: 20,
      startingStack: 1000,
    })).toBe(100);
  });
});

afterEach(() => {
  delete process.env['ACTION_ROUND_MIN_MS'];
});

describe('resolveActionRoundMinMs', () => {
  it('defaults to 5000ms when ACTION_ROUND_MIN_MS is unset or invalid', () => {
    expect(resolveActionRoundMinMs()).toBe(5_000);
    process.env['ACTION_ROUND_MIN_MS'] = 'invalid';
    expect(resolveActionRoundMinMs()).toBe(5_000);
  });

  it('uses ACTION_ROUND_MIN_MS when it is a positive integer', () => {
    process.env['ACTION_ROUND_MIN_MS'] = '7000';
    expect(resolveActionRoundMinMs()).toBe(7_000);
  });
});

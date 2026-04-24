'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const { formatCard, stripAnsi } = require('../lib/cards');
const { renderClearScreen, renderSnapshot } = require('../lib/tui');

function sampleTurn() {
  const agentId = 'agent-claude-00000000';
  return {
    turnId: 'turn-1',
    arenaId: 'arena-12345678',
    handId: 'hand-1',
    handNumber: 7,
    agentId,
    validActions: ['fold', 'call', 'raise'],
    deadlineMs: null,
    callAmount: 40,
    minRaise: 80,
    maxRaise: 880,
    state: {
      arenaId: 'arena-12345678',
      handId: 'hand-1',
      handNumber: 7,
      stage: 'river',
      players: [
        {
          agentId: 'agent-a',
          agentName: 'Alice',
          position: 0,
          stack: 940,
          bet: 20,
          totalBet: 80,
          cards: [],
          isActive: true,
          isFolded: false,
          isAllIn: false,
          hasActed: true,
        },
        {
          agentId,
          agentName: 'Claude',
          position: 1,
          stack: 880,
          bet: 60,
          totalBet: 120,
          cards: [
            { rank: 'A', suit: 'hearts' },
            { rank: 'A', suit: 'diamonds' },
          ],
          isActive: true,
          isFolded: false,
          isAllIn: false,
          hasActed: false,
          expression: '😎',
        },
        {
          agentId: 'agent-c',
          agentName: 'Codex',
          position: 2,
          stack: 0,
          bet: 100,
          totalBet: 1000,
          cards: [],
          isActive: true,
          isFolded: false,
          isAllIn: true,
          hasActed: true,
        },
        {
          agentId: 'agent-d',
          agentName: 'Hermes',
          position: 3,
          stack: 950,
          bet: 0,
          totalBet: 50,
          cards: [],
          isActive: false,
          isFolded: true,
          isAllIn: false,
          hasActed: true,
        },
      ],
      communityCards: [
        { rank: 'A', suit: 'spades' },
        { rank: 'K', suit: 'hearts' },
        { rank: '7', suit: 'diamonds' },
        { rank: '2', suit: 'clubs' },
        { rank: '5', suit: 'spades' },
      ],
      pots: [{ amount: 340, eligiblePlayers: ['agent-a', agentId, 'agent-c'] }],
      currentActorIndex: 1,
      dealerIndex: 0,
      smallBlindIndex: 1,
      bigBlindIndex: 2,
      smallBlindAmount: 10,
      bigBlindAmount: 20,
      minRaise: 80,
      lastAction: {
        agentId: 'agent-c',
        action: { type: 'raise', amount: 80 },
        timestamp: Date.now(),
      },
    },
    submitPath: '/arenas/arena-12345678/actions',
  };
}

test('formatCard renders compact poker cards with suit symbols', () => {
  assert.equal(stripAnsi(formatCard({ rank: 'A', suit: 'spades' })), '[A♠]');
  assert.equal(stripAnsi(formatCard('10d')), '[10♦]');
});

test('renderSnapshot renders a private turn with cards, state, badges, and legal actions', () => {
  const rendered = stripAnsi(renderSnapshot(sampleTurn(), {
    color: false,
    agentId: 'agent-claude-00000000',
  }));

  assert.match(rendered, /AGON ARENA/);
  assert.match(rendered, /hand #7/);
  assert.match(rendered, /\[A♠\] \[K♥\] \[7♦\] \[2♣\] \[5♠\]/);
  assert.match(rendered, /YOU\(Claude\)/);
  assert.match(rendered, /\[A♥\] \[A♦\]/);
  assert.match(rendered, /TURN/);
  assert.match(rendered, /ALL-IN/);
  assert.match(rendered, /FOLD/);
  assert.match(rendered, /legal: fold \| call 40 \| raise 80..880/);
});

test('renderClearScreen can render plain frames without cursor control escapes', () => {
  const rendered = renderClearScreen(sampleTurn(), {
    color: false,
    clear: false,
  });

  assert.doesNotMatch(rendered, /\x1b\[H/);
  assert.doesNotMatch(rendered, /\x1b\[2J/);
  assert.match(rendered, /AGON ARENA/);
});

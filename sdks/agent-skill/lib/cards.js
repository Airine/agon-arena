'use strict';

const ANSI = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
};

const SUIT_SYMBOLS = {
  spades: '♠',
  hearts: '♥',
  diamonds: '♦',
  clubs: '♣',
  s: '♠',
  h: '♥',
  d: '♦',
  c: '♣',
};

const SUIT_NAMES_BY_SYMBOL = {
  '♠': 'spades',
  '♥': 'hearts',
  '♦': 'diamonds',
  '♣': 'clubs',
};

function stripAnsi(value) {
  return String(value ?? '').replace(/\x1b\[[0-9;]*m/g, '');
}

function normalizeCard(card) {
  if (!card) return null;
  if (typeof card === 'string') {
    const trimmed = card.trim();
    if (!trimmed || trimmed === '??') return null;
    const suitToken = trimmed.slice(-1).toLowerCase();
    const suit = SUIT_NAMES_BY_SYMBOL[trimmed.slice(-1)] || {
      s: 'spades',
      h: 'hearts',
      d: 'diamonds',
      c: 'clubs',
    }[suitToken];
    const rank = trimmed.slice(0, -1).toUpperCase();
    if (rank && suit) return { rank, suit };
    return { rank: trimmed.toUpperCase(), suit: '' };
  }
  return {
    rank: String(card.rank ?? '?').toUpperCase(),
    suit: String(card.suit ?? '').toLowerCase(),
  };
}

function isRedSuit(suit) {
  return suit === 'hearts' || suit === 'diamonds' || suit === 'h' || suit === 'd';
}

function formatCard(card, options = {}) {
  const normalized = normalizeCard(card);
  if (!normalized) return '[??]';

  const color = options.color !== false;
  const symbol = SUIT_SYMBOLS[normalized.suit] || normalized.suit || '?';
  const visible = `${normalized.rank}${symbol}`;
  const rendered = color && isRedSuit(normalized.suit)
    ? `${normalized.rank}${ANSI.red}${symbol}${ANSI.reset}`
    : visible;
  return `[${rendered}]`;
}

function formatCards(cards, options = {}) {
  if (!Array.isArray(cards) || cards.length === 0) return '(none)';
  return cards.map((card) => formatCard(card, options)).join(' ');
}

module.exports = {
  ANSI,
  SUIT_SYMBOLS,
  formatCard,
  formatCards,
  normalizeCard,
  stripAnsi,
};

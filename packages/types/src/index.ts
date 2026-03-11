// Poker game types
export type Suit = 'spades' | 'hearts' | 'diamonds' | 'clubs';
export type Rank = '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K' | 'A';

export interface Card {
  suit: Suit;
  rank: Rank;
}

export type ActionType = 'fold' | 'check' | 'call' | 'raise' | 'all_in';

export interface PlayerAction {
  type: ActionType;
  amount?: number; // For raise/all_in
}

export type GameStage = 'waiting' | 'pre_flop' | 'flop' | 'turn' | 'river' | 'showdown' | 'finished';

export interface PlayerState {
  agentId: string;
  agentName: string;
  position: number; // 0-based seat index
  stack: number; // Current chip count
  bet: number; // Current round bet
  totalBet: number; // Total bet this hand
  cards: Card[]; // Hole cards (empty if not revealed)
  isActive: boolean; // Still in the hand (not folded)
  isFolded: boolean;
  isAllIn: boolean;
  hasActed: boolean; // Has acted in current round
}

export interface PotInfo {
  amount: number;
  eligiblePlayers: string[]; // agentIds eligible for this pot
}

export interface GameState {
  arenaId: string;
  handId: string;
  handNumber: number;
  stage: GameStage;
  players: PlayerState[];
  communityCards: Card[];
  pots: PotInfo[];
  currentActorIndex: number | null; // Index in players array
  dealerIndex: number;
  smallBlindIndex: number;
  bigBlindIndex: number;
  smallBlindAmount: number;
  bigBlindAmount: number;
  minRaise: number;
  lastAction?: {
    agentId: string;
    action: PlayerAction;
    timestamp: number;
  };
}

export interface Winner {
  agentId: string;
  amount: number;
  hand?: Card[]; // Best 5-card hand
  handRank?: HandRank;
  handDescription?: string;
}

export type HandRank =
  | 'royal_flush'
  | 'straight_flush'
  | 'four_of_a_kind'
  | 'full_house'
  | 'flush'
  | 'straight'
  | 'three_of_a_kind'
  | 'two_pair'
  | 'pair'
  | 'high_card';

// Agent Adapter Protocol (AAP) types
export interface AAPActionRequest {
  gameId: string;
  handId: string;
  agentId: string;
  state: GameState;
  validActions: ActionType[];
  timeoutMs: number;
}

export interface AAPActionResponse {
  action: ActionType;
  amount?: number;
}

// API types
export interface AgentProfile {
  id: string;
  name: string;
  description?: string;
  ownerId: string;
  eloRating: number;
  handsPlayed: number;
  handsWon: number;
  totalChipsWon: number;
  createdAt: string;
}

export interface ArenaInfo {
  id: string;
  name: string;
  gameType: 'texas_holdem';
  status: 'waiting' | 'running' | 'finished';
  playerCount: number;
  maxPlayers: number;
  smallBlind: number;
  bigBlind: number;
  startingStack: number;
  spectatorCount: number;
  createdAt: string;
}

// WebSocket event types
export interface WsGameStateUpdate {
  arenaId: string;
  state: GameState;
}

export interface WsGameAction {
  arenaId: string;
  handId: string;
  agentId: string;
  action: PlayerAction;
  resultingState: GameState;
}

export interface WsHandStart {
  arenaId: string;
  handNumber: number;
  players: Array<{ agentId: string; agentName: string; stack: number }>;
}

export interface WsHandEnd {
  arenaId: string;
  handNumber: number;
  winners: Winner[];
  finalState: GameState;
}

/** Agon Arena game types for OpenClaw skill integration. */

export type Suit = 'spades' | 'hearts' | 'diamonds' | 'clubs';
export type Rank = '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K' | 'A';

export interface Card {
  suit: Suit;
  rank: Rank;
}

export type ActionType = 'fold' | 'check' | 'call' | 'raise' | 'all_in';

export interface PlayerState {
  agentId: string;
  agentName: string;
  position: number;
  stack: number;
  bet: number;
  totalBet: number;
  cards: Card[];
  isActive: boolean;
  isFolded: boolean;
  isAllIn: boolean;
  hasActed: boolean;
}

export interface PotInfo {
  amount: number;
  eligiblePlayers: string[];
}

export type GameStage = 'waiting' | 'pre_flop' | 'flop' | 'turn' | 'river' | 'showdown' | 'finished';

export interface GameState {
  arenaId: string;
  handId: string;
  handNumber: number;
  stage: GameStage;
  players: PlayerState[];
  communityCards: Card[];
  pots: PotInfo[];
  currentActorIndex: number | null;
  dealerIndex: number;
  smallBlindIndex: number;
  bigBlindIndex: number;
  smallBlindAmount: number;
  bigBlindAmount: number;
  minRaise: number;
  lastAction?: {
    agentId: string;
    action: { type: ActionType; amount?: number };
    timestamp: number;
  };
}

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

/** Configuration for the Agon Arena skill. */
export interface AgonSkillConfig {
  /** Agon Arena API base URL. */
  apiUrl: string;
  /** Agent's webhook server port. */
  port?: number;
  /** Agent's webhook server host. */
  host?: string;
  /** Platform's Ed25519 public key (hex) for verifying incoming webhooks. */
  platformPublicKey?: string;
  /** Whether to verify incoming webhook signatures. Default: true. */
  verifySignatures?: boolean;
}

/** Strategy function that decides the agent's next action. */
export type DecideFunction = (
  request: AAPActionRequest,
) => AAPActionResponse | Promise<AAPActionResponse>;

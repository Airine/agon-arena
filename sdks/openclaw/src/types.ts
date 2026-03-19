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

export interface AgentCard {
  name: string;
  description?: string;
  version?: string;
  capabilities?: string[];
  metadata?: Record<string, unknown>;
}

export interface AgentTurnRequest {
  turnId: string;
  arenaId: string;
  handId: string;
  handNumber: number;
  agentId: string;
  validActions: ActionType[];
  deadlineMs: number | null;
  callAmount: number;
  minRaise: number;
  maxRaise: number;
  state: GameState;
  submitPath: string;
}

export interface AgentRuntimeSnapshot {
  arenaId: string;
  agentId: string;
  handId: string | null;
  handNumber: number;
  publicState: GameState | null;
  privateState: GameState | null;
  pendingTurn: AgentTurnRequest | null;
  updatedAt: number;
}

export interface AgentArenaEvent {
  arenaId: string;
  type: 'hand:start' | 'hand:action' | 'hand:end' | 'arena:finished';
  handId?: string;
  handNumber?: number;
  actorAgentId?: string;
  action?: { type: ActionType; amount?: number };
  state?: GameState;
  winners?: Array<{ agentId: string; amount: number }>;
  updatedAt: number;
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
  /** EVM private key used for wallet-signed agent bootstrap. */
  agentWalletPrivateKey?: string;
  /** Optional description stored on the agent card. */
  agentDescription?: string;
  /** Optional semantic version for the agent card. */
  agentVersion?: string;
  /** Optional capabilities list advertised on the agent card. */
  agentCapabilities?: string[];
  /** Optional metadata object advertised on the agent card. */
  agentMetadata?: Record<string, unknown>;
  /** Arena to auto-join after bootstrap. Defaults to the first waiting arena. */
  autoJoinArenaId?: string;
}

/** Strategy function that decides the agent's next action. */
export type DecideFunction = (
  request: AgentTurnRequest,
) => AAPActionResponse | Promise<AAPActionResponse>;

/** Legacy webhook strategy function retained for compatibility helpers. */
export type WebhookDecideFunction = (
  request: AAPActionRequest,
) => AAPActionResponse | Promise<AAPActionResponse>;

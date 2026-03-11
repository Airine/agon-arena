/** Agon Arena game types for ElizaOS plugin. */

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

/** ElizaOS runtime interface (minimal subset used by this plugin). */
export interface IAgentRuntime {
  getSetting: (key: string) => string | undefined;
  composeState: (message: unknown) => Promise<Record<string, unknown>>;
  evaluate: (message: unknown, state: Record<string, unknown>) => Promise<string>;
}

/** ElizaOS action interface. */
export interface ElizaAction {
  name: string;
  description: string;
  similes: string[];
  examples: Array<Array<{ user: string; content: { text: string } }>>;
  validate: (runtime: IAgentRuntime, message: unknown) => Promise<boolean>;
  handler: (
    runtime: IAgentRuntime,
    message: unknown,
    state: Record<string, unknown>,
    options: Record<string, unknown>,
    callback: (response: { text: string; action?: string }) => void,
  ) => Promise<void>;
}

/** ElizaOS provider interface. */
export interface ElizaProvider {
  name: string;
  description: string;
  get: (runtime: IAgentRuntime, message: unknown) => Promise<string>;
}

/** ElizaOS plugin interface. */
export interface ElizaPlugin {
  name: string;
  description: string;
  actions: ElizaAction[];
  providers: ElizaProvider[];
  initialize?: (runtime: IAgentRuntime) => Promise<void>;
}

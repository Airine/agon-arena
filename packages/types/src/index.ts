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

export interface AgentCard {
  name: string;
  description?: string;
  version?: string;
  capabilities?: string[];
  metadata?: Record<string, unknown>;
}

export interface AgentActionSubmission {
  agentId: string;
  turnId: string;
  action: ActionType;
  amount?: number;
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

/**
 * Response envelope for GET /arenas/:id/runtime
 *
 * `lastProcessedTurnId` semantics:
 *   - Set to the turnId of the last turn that was submitted AND successfully
 *     accepted by the server (i.e. `POST /arenas/:id/actions` returned 202).
 *   - Persists across reconnects: stored in Redis (24h TTL, fast path) and
 *     in the arena_seats DB row (durable fallback, survives Redis restarts).
 *   - Null until the agent has submitted at least one action in this arena.
 *   - Agents use this field with `protocol resume` to detect whether their
 *     last submission was processed after a crash, avoiding duplicate turns.
 */
export interface AgentRuntimeResponse {
  snapshot: AgentRuntimeSnapshot;
  lastProcessedTurnId?: string | null;
}

export interface AgentArenaEvent {
  arenaId: string;
  type: 'hand:start' | 'hand:action' | 'hand:end' | 'arena:finished';
  handId?: string;
  handNumber?: number;
  actorAgentId?: string;
  action?: PlayerAction;
  state?: GameState;
  winners?: Winner[];
  updatedAt: number;
}

// Webhook signature headers (Ed25519)
export interface WebhookSignatureHeaders {
  'x-agon-signature': string;   // Ed25519 signature (hex)
  'x-agon-timestamp': string;   // Unix timestamp (seconds)
  'x-agon-nonce': string;       // Unique nonce (UUID)
}

export interface AgentResponseSignatureHeaders {
  'x-agent-signature': string;  // Ed25519 signature (hex) from agent
}

// Skill types
export type SkillVisibility = 'public' | 'private';

export interface SkillInfo {
  id: string;
  agentId: string;
  name: string;
  description?: string;
  visibility: SkillVisibility;
  currentVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface SkillVersionInfo {
  id: string;
  skillId: string;
  version: number;
  fileSha256: string;
  fileSize: number;
  changelog?: string;
  createdAt: string;
}

export interface SkillVersionDetail extends SkillVersionInfo {
  fileContent: string;
}

// API types
export interface AgentProfile {
  id: string;
  name: string;
  description?: string;
  ownerId: string;
  creatorUserId: string;
  agentAddress?: string | null;
  avatarUrl?: string;
  version: string;
  metadata?: Record<string, unknown>;
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
  mode?: 'practice' | 'cash' | 'tournament';
  buyInAmount?: number;
  tier?: 'practice' | 'micro' | 'serious';
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
  replayAvailable?: boolean;
}

export interface ReplayStep {
  sequenceNumber: number;
  stage: 'pre_flop' | 'flop' | 'turn' | 'river' | 'showdown';
  actorAgentId: string;
  action: { type: string; amount?: number };
  potTotal: number;
  communityCards: Card[];
  playerStates: Array<{
    agentId: string;
    stack: number;
    bet: number;
    isFolded: boolean;
    holeCards: Card[];
  }>;
  thinkingText?: string;
}

export interface HandReplayResponse {
  arenaId: string;
  handNumber: number;
  startingStacks: Record<string, number>;
  steps: ReplayStep[];
  winners: Winner[];
  vrfSeed?: string;
}

export interface AapThinkingUpload {
  type: 'thinking_upload';
  arenaId: string;
  handNumber: number;
  steps: Array<{
    sequenceNumber: number;
    thinkingText: string;
  }>;
}

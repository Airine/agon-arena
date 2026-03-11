import axios from 'axios';
import { eq, sql } from 'drizzle-orm';
import type { GameState, PlayerAction, ActionType, AAPActionRequest, AAPActionResponse } from '@agon/types';
import { createGame, processAction, getValidActions, getWinners, isHandOver, type GameConfig } from '../game/index.js';
import { db, schema } from '../db/index.js';
import { getIO } from './io.js';
import { signWebhookPayload, verifyAgentSignature } from './webhook-crypto.js';
import { generateCommit, verifyVRFCommit } from './vrf.js';
import { setGameSnapshot } from './redis.js';
import { dispatchToAll, type AgentEndpoint } from './webhook-dispatcher.js';

const ACTION_TIMEOUT_MS = 5000;
const MAX_HANDS = 100; // Max hands per arena session

interface SeatInfo {
  seatIndex: number;
  currentStack: number;
  agentId: string;
  agentName: string;
  apiUrl: string;
  webhookPublicKey: string | null;
}

interface ArenaConfig {
  smallBlind: number;
  bigBlind: number;
  startingStack: number;
}

/**
 * Start the game loop for an arena. Runs asynchronously.
 */
export function startGame(arenaId: string, arena: ArenaConfig, seats: SeatInfo[]): void {
  runGameLoop(arenaId, arena, seats).catch((err) => {
    console.error(`[Orchestrator] Arena ${arenaId} game loop crashed:`, err);
    // Mark arena as finished on unrecoverable error
    db.update(schema.arenas)
      .set({ status: 'finished', finishedAt: new Date() })
      .where(eq(schema.arenas.id, arenaId))
      .then(() => {})
      .catch(() => {});
  });
}

async function runGameLoop(arenaId: string, arena: ArenaConfig, seats: SeatInfo[]): Promise<void> {
  let dealerIndex = 0;
  const agentUrls = new Map(seats.map((s) => [s.agentId, s.apiUrl]));
  const agentPublicKeys = new Map(seats.map((s) => [s.agentId, s.webhookPublicKey]));

  const agentEndpoints: AgentEndpoint[] = seats.map((s) => ({
    agentId: s.agentId,
    apiUrl: s.apiUrl,
    webhookPublicKey: s.webhookPublicKey,
  }));

  // Track stacks across hands
  const stacks = new Map(seats.map((s) => [s.agentId, arena.startingStack]));

  for (let handNumber = 1; handNumber <= MAX_HANDS; handNumber++) {
    // Build active player list (agents with chips)
    const activePlayers = seats.filter((s) => (stacks.get(s.agentId) ?? 0) > 0);
    if (activePlayers.length < 2) break;

    dealerIndex = (handNumber - 1) % activePlayers.length;

    const config: GameConfig = {
      arenaId,
      players: activePlayers.map((s) => ({
        agentId: s.agentId,
        agentName: s.agentName,
        stack: stacks.get(s.agentId) ?? 0,
      })),
      smallBlind: arena.smallBlind,
      bigBlind: arena.bigBlind,
      dealerIndex,
    };

    const vrf = generateCommit();
    const { state: initialState, deck } = createGame(config, vrf.seed);
    const gameState = { ...initialState, handNumber };

    // Create hand record in DB
    const [handRecord] = await db
      .insert(schema.gameHands)
      .values({
        arenaId,
        handNumber,
        stage: gameState.stage,
        dealerIndex,
        communityCards: [],
        potAmount: gameState.pots.reduce((sum, p) => sum + p.amount, 0),
        vrfCommit: vrf.commit,
        vrfSignature: vrf.signature,
        // vrfSeed is null until revealed after hand
      })
      .returning();

    // Update arena hand number
    await db
      .update(schema.arenas)
      .set({ currentHandNumber: handNumber })
      .where(eq(schema.arenas.id, arenaId));

    // Broadcast hand start
    getIO().to(`arena:${arenaId}`).emit('hand:start', {
      arenaId,
      handNumber,
      players: activePlayers.map((s) => ({
        agentId: s.agentId,
        agentName: s.agentName,
        stack: stacks.get(s.agentId) ?? 0,
      })),
    });

    // Dispatch hand:start to all agents (fire-and-forget)
    dispatchToAll(agentEndpoints, (agentId) => ({
      event: 'hand:start',
      arenaId,
      handNumber,
      vrfCommit: vrf.commit,
      state: createPrivateView(currentState, agentId),
    }));

    // Broadcast VRF commitment — players can verify dealing was committed before cards were known
    getIO().to(`arena:${arenaId}`).emit('hand:vrf_commit', {
      arenaId,
      handNumber,
      vrfCommit: vrf.commit,
      vrfSignature: vrf.signature,
      vrfPublicKey: vrf.publicKey,
    });

    // Play the hand
    let currentState = gameState;
    let sequenceNumber = 0;

    while (!isHandOver(currentState) && currentState.currentActorIndex !== null) {
      const actorIdx = currentState.currentActorIndex;
      const actor = currentState.players[actorIdx]!;
      const validActions = getValidActions(currentState);

      if (validActions.length === 0) break;

      // Create private view for the agent (hide other players' hole cards)
      const privateState = createPrivateView(currentState, actor.agentId);

      const aapRequest: AAPActionRequest = {
        gameId: arenaId,
        handId: handRecord!.id,
        agentId: actor.agentId,
        state: privateState,
        validActions,
        timeoutMs: ACTION_TIMEOUT_MS,
      };

      // Request action from agent with Ed25519 signed webhook
      const startTime = Date.now();
      let action: PlayerAction;

      try {
        const agentUrl = agentUrls.get(actor.agentId)!;
        if (agentUrl.startsWith('bot://')) {
          // Bot agent: resolve action locally (no HTTP)
          action = resolveBotAction(agentUrl, validActions, currentState);
        } else {
          const publicKey = agentPublicKeys.get(actor.agentId) ?? null;
          const response = await requestAgentAction(agentUrl, aapRequest, publicKey);
          action = validateAction(response, validActions, currentState);
        }
      } catch {
        // Timeout or error: auto-fold
        action = { type: 'fold' };
      }
      const responseTimeMs = Date.now() - startTime;

      // Process the action
      currentState = processAction(currentState, action, deck);
      sequenceNumber++;

      // Record action in DB
      await db.insert(schema.gameActions).values({
        handId: handRecord!.id,
        arenaId,
        agentId: actor.agentId,
        actionType: action.type,
        amount: action.amount ?? null,
        stage: gameState.stage,
        sequenceNumber,
        responseTimeMs,
      });

      // Broadcast action to spectators (hide hole cards)
      const spectatorState = createSpectatorView(currentState);
      getIO().to(`arena:${arenaId}`).emit('game:action', {
        arenaId,
        handId: handRecord!.id,
        agentId: actor.agentId,
        action,
        resultingState: spectatorState,
      });

      // Dispatch hand:action to all agents (fire-and-forget)
      dispatchToAll(agentEndpoints, (agentId) => ({
        event: 'hand:action',
        arenaId,
        handNumber,
        actorAgentId: actor.agentId,
        action,
        state: createPrivateView(currentState, agentId),
      }));

      // Cache snapshot for reconnecting spectators (fire-and-forget)
      setGameSnapshot(arenaId, {
        arenaId,
        gameState: spectatorState,
        handNumber: currentState.handNumber,
        updatedAt: Date.now(),
      }).catch(() => {});
    }

    // Hand is over - determine winners
    const winners = getWinners(currentState);

    // Update stacks
    for (const player of currentState.players) {
      stacks.set(player.agentId, player.stack);
    }
    for (const winner of winners) {
      const current = stacks.get(winner.agentId) ?? 0;
      stacks.set(winner.agentId, current + winner.amount);
    }

    // Update hand record
    await db
      .update(schema.gameHands)
      .set({
        stage: currentState.stage,
        stateSnapshot: currentState,
        communityCards: currentState.communityCards,
        potAmount: currentState.pots.reduce((sum, p) => sum + p.amount, 0),
        winnersJson: winners,
        endedAt: new Date(),
      })
      .where(eq(schema.gameHands.id, handRecord!.id));

    // Reveal VRF seed after hand ends — anyone can now verify the commitment
    await db
      .update(schema.gameHands)
      .set({ vrfSeed: vrf.seed })
      .where(eq(schema.gameHands.id, handRecord!.id));

    // Broadcast seed reveal
    getIO().to(`arena:${arenaId}`).emit('hand:vrf_reveal', {
      arenaId,
      handNumber,
      vrfSeed: vrf.seed,
      vrfCommit: vrf.commit,
      verified: verifyVRFCommit(vrf.seed, vrf.commit),
    });

    // Update agent stats
    for (const player of currentState.players) {
      await db
        .update(schema.agents)
        .set({
          handsPlayed: sql`${schema.agents.handsPlayed} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(schema.agents.id, player.agentId));
    }
    for (const winner of winners) {
      await db
        .update(schema.agents)
        .set({
          handsWon: sql`${schema.agents.handsWon} + 1`,
          totalChipsWon: sql`${schema.agents.totalChipsWon} + ${winner.amount}`,
          updatedAt: new Date(),
        })
        .where(eq(schema.agents.id, winner.agentId));
    }

    // Update arena seat stacks
    for (const [agentId, stack] of stacks) {
      await db
        .update(schema.arenaSeats)
        .set({ currentStack: stack, isActive: stack > 0 })
        .where(eq(schema.arenaSeats.agentId, agentId));
    }

    // Broadcast hand end
    const finalSpectatorState = createSpectatorView(currentState);
    getIO().to(`arena:${arenaId}`).emit('hand:end', {
      arenaId,
      handNumber,
      winners,
      finalState: finalSpectatorState,
    });

    // Dispatch hand:end to all agents (fire-and-forget)
    dispatchToAll(agentEndpoints, (agentId) => ({
      event: 'hand:end',
      arenaId,
      handNumber,
      winners,
      vrfSeed: vrf.seed,
      state: createSpectatorView(currentState),
    }));

    // Cache snapshot for reconnecting spectators (fire-and-forget)
    setGameSnapshot(arenaId, {
      arenaId,
      gameState: finalSpectatorState,
      handNumber,
      updatedAt: Date.now(),
    }).catch(() => {});

    // Brief pause between hands
    await sleep(1000);
  }

  // Arena finished
  await db
    .update(schema.arenas)
    .set({ status: 'finished', finishedAt: new Date() })
    .where(eq(schema.arenas.id, arenaId));

  getIO().to(`arena:${arenaId}`).emit('arena:finished', { arenaId });
}

/**
 * Request an action from an agent via webhook (AAP protocol).
 * Signs the request with Ed25519 and verifies the agent's response signature.
 */
async function requestAgentAction(
  agentUrl: string,
  request: AAPActionRequest,
  agentPublicKeyHex: string | null,
): Promise<AAPActionResponse> {
  const bodyStr = JSON.stringify(request);

  // Sign the webhook payload with platform Ed25519 key
  const { signature, timestamp, nonce } = signWebhookPayload(bodyStr);

  const response = await axios.post<AAPActionResponse>(
    `${agentUrl}/action`,
    request,
    {
      timeout: ACTION_TIMEOUT_MS,
      headers: {
        'Content-Type': 'application/json',
        'X-Agon-Signature': signature,
        'X-Agon-Timestamp': timestamp,
        'X-Agon-Nonce': nonce,
      },
      // Prevent axios from following redirects (SSRF mitigation)
      maxRedirects: 0,
    },
  );

  // Verify agent response signature when agent registered a public key
  if (agentPublicKeyHex) {
    const agentSig = response.headers['x-agent-signature'] as string | undefined;
    if (!agentSig) {
      throw new Error(`Agent ${request.agentId} registered a public key but did not sign response`);
    }

    const responseBody = JSON.stringify(response.data);
    const valid = verifyAgentSignature(responseBody, agentSig, agentPublicKeyHex);
    if (!valid) {
      throw new Error(`Invalid signature from agent ${request.agentId} — possible tampering`);
    }
  }

  return response.data;
}

/**
 * Validate and normalize the agent's action response.
 */
function validateAction(
  response: AAPActionResponse,
  validActions: ActionType[],
  state: GameState,
): PlayerAction {
  if (!response?.action || !validActions.includes(response.action)) {
    // Invalid action → fold
    return { type: 'fold' };
  }

  const action: PlayerAction = { type: response.action };

  if (response.action === 'raise' && response.amount !== undefined) {
    const actor = state.players[state.currentActorIndex!]!;
    const maxBet = Math.max(...state.players.map((p) => p.bet));
    const toCall = maxBet - actor.bet;

    // Clamp raise amount between minRaise and (stack - toCall)
    const maxRaise = actor.stack - toCall;
    const clampedAmount = Math.max(state.minRaise, Math.min(response.amount, maxRaise));
    action.amount = clampedAmount;
  }

  return action;
}

/**
 * Create a private view for a specific agent (only their own hole cards visible).
 */
function createPrivateView(state: GameState, agentId: string): GameState {
  return {
    ...state,
    players: state.players.map((p) => ({
      ...p,
      cards: p.agentId === agentId ? p.cards : [],
    })),
  };
}

/**
 * Create a spectator view (no hole cards unless showdown).
 */
function createSpectatorView(state: GameState): GameState {
  const isShowdown = state.stage === 'showdown' || state.stage === 'finished';
  return {
    ...state,
    players: state.players.map((p) => ({
      ...p,
      cards: isShowdown && !p.isFolded ? p.cards : [],
    })),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Resolve a bot action locally without HTTP.
 * Strategy variants (encoded in URL):
 *   bot://random  — random valid action
 *   bot://call    — always call/check (passive)
 *   bot://fold    — always fold (foldbots, for testing)
 * This is the AGO-33 fill-in bot implementation (minimal version).
 */
function resolveBotAction(
  botUrl: string,
  validActions: ActionType[],
  state: GameState,
): PlayerAction {
  const strategy = botUrl.replace('bot://', '').toLowerCase();

  if (strategy === 'fold' && validActions.includes('fold')) {
    return { type: 'fold' };
  }

  if (strategy === 'call' || strategy === 'passive') {
    if (validActions.includes('check')) return { type: 'check' };
    if (validActions.includes('call')) return { type: 'call' };
    return { type: 'fold' };
  }

  // Default: random (weighted: call 60%, check 20%, fold 15%, raise 5%)
  const r = Math.random();
  if (r < 0.15 && validActions.includes('fold')) {
    return { type: 'fold' };
  }
  if (r < 0.20 && validActions.includes('raise')) {
    return { type: 'raise', amount: state.minRaise };
  }
  if (validActions.includes('check')) return { type: 'check' };
  if (validActions.includes('call')) return { type: 'call' };
  return { type: 'fold' };
}

import { eq, sql } from 'drizzle-orm';
import type { GameState, PlayerAction, ActionType, AgentActionSubmission } from '@agon/types';
import { createGame, processAction, getValidActions, getWinners, isHandOver, type GameConfig } from '../game/index.js';
import { db, schema } from '../db/index.js';
import { getIO } from './io.js';
import { generateCommit, verifyVRFCommit } from './vrf.js';
import {
  clearAgentPendingTurn,
  clearArenaLoopHeartbeat,
  setGameSnapshot,
  touchArenaLoopHeartbeat,
} from './redis.js';
import {
  createPrivateView,
  createSpectatorView,
  createTurnRequest,
  emitArenaEvent,
  publishRuntimeSnapshot,
  publishTurnRequest,
  waitForSubmittedTurn,
} from './agent-runtime.js';
import { publishEvent } from './kafka.js';
import { chipService } from './chip.js';
import { resolveBotAction } from './bot.js';
import { settleBets } from './bet-settlement.js';

const DEFAULT_ACTION_ROUND_MIN_MS = 5_000;
const MAX_HANDS = 100; // Max hands per arena session

interface SeatInfo {
  seatIndex: number;
  currentStack: number;
  agentId: string;
  agentName: string;
  apiUrl: string | null;
}

interface ArenaConfig {
  smallBlind: number;
  bigBlind: number;
  startingStack: number;
  maxHands?: number;
}

export function resolveArenaHandLimit(arena: ArenaConfig): number {
  return arena.maxHands && arena.maxHands > 0 ? arena.maxHands : MAX_HANDS;
}

export function resolveActionRoundMinMs(): number {
  const raw = Number(process.env['ACTION_ROUND_MIN_MS']);
  return Number.isInteger(raw) && raw > 0 ? raw : DEFAULT_ACTION_ROUND_MIN_MS;
}

/**
 * Start the game loop for an arena. Runs asynchronously.
 */
export function startGame(arenaId: string, arena: ArenaConfig, seats: SeatInfo[]): void {
  runGameLoop(arenaId, arena, seats).catch((err) => {
    console.error(`[Orchestrator] Arena ${arenaId} game loop crashed:`, err);
    // Mark arena as finished on unrecoverable error
    clearArenaLoopHeartbeat(arenaId).catch(() => {});
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
  const handLimit = resolveArenaHandLimit(arena);
  const actionRoundMinMs = resolveActionRoundMinMs();

  // Track stacks across hands
  const stacks = new Map(seats.map((s) => [s.agentId, arena.startingStack]));

  for (let handNumber = 1; handNumber <= handLimit; handNumber++) {
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

    publishEvent({
      eventType: 'hand_start',
      arenaId,
      handId: handRecord!.id,
      handNumber,
      playerCount: activePlayers.length,
      vrfCommit: vrf.commit,
      ts: Date.now(),
    });

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
    let roundStartedAt = Date.now();
    await publishRuntimeSnapshot(arenaId, currentState);
    await emitArenaEvent(
      arenaId,
      activePlayers.map((player) => player.agentId),
      {
        type: 'hand:start',
        handId: handRecord!.id,
        handNumber,
        state: createSpectatorView(currentState),
      },
    );

    while (!isHandOver(currentState) && currentState.currentActorIndex !== null) {
      const actorIdx = currentState.currentActorIndex;
      const actor = currentState.players[actorIdx]!;
      const validActions = getValidActions(currentState);

      if (validActions.length === 0) break;

      // External runtimes now pull turns over Socket.IO + REST, while local
      // bot:// seats still resolve actions in-process.
      const startTime = Date.now();
      let action: PlayerAction;

      const agentUrl = agentUrls.get(actor.agentId);
      if (agentUrl?.startsWith('bot://')) {
        // Bot agent: resolve action locally (no HTTP)
        action = resolveBotAction(agentUrl, validActions, currentState);
      } else {
        const turn = await createTurnRequest({
          arenaId,
          handId: handRecord!.id,
          handNumber,
          agentId: actor.agentId,
          validActions,
          deadlineMs: null,
          state: currentState,
        });
        await publishTurnRequest(turn);
        await touchArenaLoopHeartbeat(arenaId);
        const submission = await waitForSubmittedTurn(
          arenaId,
          actor.agentId,
          turn.turnId,
          {
            onHeartbeat: () => touchArenaLoopHeartbeat(arenaId),
          },
        );
        if (!submission) {
          throw new Error(`Pending turn disappeared before submission for agent ${actor.agentId}`);
        }
        action = toPlayerAction(submission, validActions, currentState);
      }
      const responseTimeMs = Date.now() - startTime;
      await clearAgentPendingTurn(arenaId, actor.agentId);

      // Process the action
      const stageBeforeAction = currentState.stage;
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

      // AGO-68: trigger first-bet invite rewards for non-fold actions
      if (action.type !== 'fold') {
        triggerFirstBetRewards(actor.agentId).catch((err) => {
          console.error('[InviteReward] First-bet trigger error:', err);
        });
      }

      // Broadcast action to spectators (hide hole cards)
      const spectatorState = createSpectatorView(currentState);
      getIO().to(`arena:${arenaId}`).emit('game:action', {
        arenaId,
        handId: handRecord!.id,
        agentId: actor.agentId,
        action,
        resultingState: spectatorState,
      });

      publishEvent({
        eventType: 'game_action',
        arenaId,
        handId: handRecord!.id,
        handNumber,
        agentId: actor.agentId,
        action,
        stage: currentState.stage,
        sequenceNumber,
        responseTimeMs,
        ts: Date.now(),
      });
      await publishRuntimeSnapshot(arenaId, currentState);
      await emitArenaEvent(
        arenaId,
        currentState.players.map((player) => player.agentId),
        {
          type: 'hand:action',
          handId: handRecord!.id,
          handNumber,
          actorAgentId: actor.agentId,
          action,
          state: spectatorState,
        },
      );

      // Cache snapshot for reconnecting spectators (fire-and-forget)
      setGameSnapshot(arenaId, {
        arenaId,
        gameState: spectatorState,
        handNumber: currentState.handNumber,
        updatedAt: Date.now(),
      }).catch(() => {});

      if (currentState.stage !== stageBeforeAction || isHandOver(currentState)) {
        await ensureRoundMinimumDuration(roundStartedAt, actionRoundMinMs);
        roundStartedAt = Date.now();
      }
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

    publishEvent({
      eventType: 'hand_end',
      arenaId,
      handId: handRecord!.id,
      handNumber,
      winners: winners.map((w) => ({ agentId: w.agentId, amount: w.amount })),
      potAmount: currentState.pots.reduce((sum, p) => sum + p.amount, 0),
      vrfSeed: vrf.seed,
      ts: Date.now(),
    });
    await publishRuntimeSnapshot(arenaId, currentState);
    await emitArenaEvent(
      arenaId,
      currentState.players.map((player) => player.agentId),
      {
        type: 'hand:end',
        handId: handRecord!.id,
        handNumber,
        winners,
        state: finalSpectatorState,
      },
    );

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

  // Arena finished — determine final standings from stacks
  const winnerAgentIds = Array.from(stacks.entries())
    .filter(([, chips]) => chips > 0)
    .map(([agentId]) => agentId);

  // Settle spectator bets before marking arena finished
  try {
    await settleBets(arenaId, winnerAgentIds);
  } catch (err) {
    console.error(`[Orchestrator] settleBets failed for arena ${arenaId}:`, err);
    // Non-fatal: arena should still be marked finished
  }

  await db
    .update(schema.arenas)
    .set({ status: 'finished', finishedAt: new Date() })
    .where(eq(schema.arenas.id, arenaId));
  await clearArenaLoopHeartbeat(arenaId);

  getIO().to(`arena:${arenaId}`).emit('arena:finished', { arenaId });
  await emitArenaEvent(
    arenaId,
    seats.map((seat) => seat.agentId),
    { type: 'arena:finished' },
  );

  publishEvent({
    eventType: 'arena_finished',
    arenaId,
    ts: Date.now(),
  });
}

function toPlayerAction(
  submission: AgentActionSubmission,
  validActions: ActionType[],
  state: GameState,
): PlayerAction {
  if (!submission?.action || !validActions.includes(submission.action)) {
    // Invalid action → fold
    return { type: 'fold' };
  }

  const action: PlayerAction = { type: submission.action };

  if (submission.action === 'raise' && submission.amount !== undefined) {
    const actor = state.players[state.currentActorIndex!]!;
    const maxBet = Math.max(...state.players.map((p) => p.bet));
    const toCall = maxBet - actor.bet;

    // Clamp raise amount between minRaise and (stack - toCall)
    const maxRaise = actor.stack - toCall;
    const clampedAmount = Math.max(state.minRaise, Math.min(submission.amount, maxRaise));
    action.amount = clampedAmount;
  }

  return action;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ensureRoundMinimumDuration(roundStartedAt: number, roundMinMs: number): Promise<void> {
  const elapsedMs = Date.now() - roundStartedAt;
  if (elapsedMs >= roundMinMs) {
    return;
  }
  await sleep(roundMinMs - elapsedMs);
}

// ---------------------------------------------------------------------------
// AGO-68: First-bet invite reward trigger
// ---------------------------------------------------------------------------

/**
 * Check if the agent's owner user has pending first-bet invite rewards and distribute them.
 * No-op if the agent is a bot (bot:// URL) or has no owner with a pending invite.
 * Called fire-and-forget after recording a non-fold/non-timeout game action.
 */
async function triggerFirstBetRewards(agentId: string): Promise<void> {
  // Look up the agent's owner user
  const [agentRow] = await db
    .select({ ownerId: schema.agents.ownerId })
    .from(schema.agents)
    .where(eq(schema.agents.id, agentId))
    .limit(1);

  if (!agentRow) return;

  // allocateFirstBetRewards is idempotent — it checks firstBetRewardedAt internally
  await chipService.allocateFirstBetRewards(agentRow.ownerId);
}

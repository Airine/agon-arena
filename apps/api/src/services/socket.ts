import { and, eq } from 'drizzle-orm';
import type { Server as SocketIOServer } from 'socket.io';
import { verifyTokenFull } from '../middleware/auth.js';
import { db, schema } from '../db/index.js';
import { getGameSnapshot, getRedisClient } from './redis.js';
import { getAgentRuntimeRoom } from './agent-runtime.js';
import { getAgentPendingTurn, getAgentRuntimeSnapshot } from './redis.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const WS_RATE_LIMIT_WINDOW_SECS = 60;
const WS_RATE_LIMIT_MAX_CONNS = 20;
const SPECTATOR_CAP_PER_ARENA = 500;

export function setupSocketHandlers(io: SocketIOServer): void {
  // Per-IP WebSocket connection rate limit (20 connections per minute per IP).
  io.use(async (socket, next) => {
    const xff = socket.handshake.headers['x-forwarded-for'];
    const ip = (typeof xff === 'string' ? xff.split(',')[0]?.trim() : undefined)
      ?? socket.handshake.address;
    try {
      const redis = await getRedisClient();
      const key = `rl:ws:${ip}`;
      const count = await redis.incr(key);
      if (count === 1) await redis.expire(key, WS_RATE_LIMIT_WINDOW_SECS);
      if (count > WS_RATE_LIMIT_MAX_CONNS) {
        socket.disconnect(true);
        return;
      }
    } catch {
      // Redis unavailable — fail open
    }
    next();
  });

  // Auth middleware — optional token. Spectating is public but we track auth'd users.
  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.['token'] as string | undefined;
    if (token) {
      try {
        (socket.data as Record<string, unknown>).user = await verifyTokenFull(token);
      } catch {
        // Invalid token — allow connection but unauthenticated
      }
    }
    next();
  });

  io.on('connection', (socket) => {
    // join:arena — join a spectator room (existing event, keep for compatibility)
    socket.on('join:arena', (arenaId: unknown) => {
      if (typeof arenaId !== 'string' || !UUID_RE.test(arenaId)) return;
      socket.join(`arena:${arenaId}`);
    });

    socket.on('leave:arena', (arenaId: unknown) => {
      if (typeof arenaId !== 'string' || !UUID_RE.test(arenaId)) return;
      socket.leave(`arena:${arenaId}`);
    });

    // subscribe — join a spectator room AND receive current game state immediately
    socket.on('subscribe', async (payload: unknown) => {
      const arenaId = (payload as Record<string, unknown>)?.['arenaId'];
      if (typeof arenaId !== 'string' || !UUID_RE.test(arenaId)) return;

      // Enforce per-arena spectator cap
      try {
        const redis = await getRedisClient();
        const capKey = `arena:spectators:${arenaId}`;
        const count = await redis.sCard(capKey);
        if (count >= SPECTATOR_CAP_PER_ARENA) {
          socket.emit('arena:full', { arenaId });
          return;
        }
        await redis.sAdd(capKey, socket.id);
        await redis.expire(capKey, 86400); // 24h TTL — evicts orphaned ids after crashes/restarts
        socket.on('disconnect', () => {
          redis.sRem(capKey, socket.id).catch(() => {});
        });
      } catch {
        // Redis unavailable — allow subscription without cap enforcement
      }

      socket.join(`arena:${arenaId}`);
      // Push current game snapshot to the newly subscribed spectator
      getGameSnapshot(arenaId)
        .then((snapshot) => {
          if (snapshot) {
            socket.emit('game:state_update', {
              arenaId: snapshot.arenaId,
              state: snapshot.gameState,
            });
          }
        })
        .catch(() => {
          // Redis unavailable — spectator will receive next live event
        });
    });

    socket.on('unsubscribe', (payload: unknown) => {
      const arenaId = (payload as Record<string, unknown>)?.['arenaId'];
      if (typeof arenaId !== 'string' || !UUID_RE.test(arenaId)) return;
      socket.leave(`arena:${arenaId}`);
    });

    socket.on('agent:subscribe', async (payload: unknown) => {
      const arenaId = (payload as Record<string, unknown>)?.['arenaId'];
      const agentId = (payload as Record<string, unknown>)?.['agentId'];
      const authUser = (socket.data as Record<string, unknown>)['user'] as { agentId?: string } | undefined;

      if (typeof arenaId !== 'string' || !UUID_RE.test(arenaId)) return;
      if (typeof agentId !== 'string' || !UUID_RE.test(agentId)) return;
      if (!authUser?.agentId || authUser.agentId !== agentId) {
        socket.emit('agent:error', {
          arenaId,
          agentId,
          message: 'An agent access token is required to subscribe to private runtime events.',
        });
        return;
      }

      const [seat] = await db
        .select({ agentId: schema.arenaSeats.agentId })
        .from(schema.arenaSeats)
        .where(and(
          eq(schema.arenaSeats.arenaId, arenaId),
          eq(schema.arenaSeats.agentId, agentId),
          eq(schema.arenaSeats.isActive, true),
        ))
        .limit(1);

      if (!seat) {
        socket.emit('agent:error', {
          arenaId,
          agentId,
          message: 'The agent is not seated in this arena.',
        });
        return;
      }

      socket.join(getAgentRuntimeRoom(agentId, arenaId));
      const snapshot = await getAgentRuntimeSnapshot(arenaId, agentId);
      const pendingTurn = await getAgentPendingTurn(arenaId, agentId);
      socket.emit('agent:runtime_snapshot', snapshot ?? {
        arenaId,
        agentId,
        handId: null,
        handNumber: 0,
        publicState: null,
        privateState: null,
        pendingTurn: pendingTurn?.status === 'pending' ? pendingTurn : null,
        updatedAt: Date.now(),
      });
    });

    socket.on('agent:unsubscribe', (payload: unknown) => {
      const arenaId = (payload as Record<string, unknown>)?.['arenaId'];
      const agentId = (payload as Record<string, unknown>)?.['agentId'];
      if (typeof arenaId !== 'string' || !UUID_RE.test(arenaId)) return;
      if (typeof agentId !== 'string' || !UUID_RE.test(agentId)) return;
      socket.leave(getAgentRuntimeRoom(agentId, arenaId));
    });
  });
}

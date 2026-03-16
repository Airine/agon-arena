import { and, eq } from 'drizzle-orm';
import type { Server as SocketIOServer } from 'socket.io';
import { verifyToken } from '../middleware/auth.js';
import { db, schema } from '../db/index.js';
import { getGameSnapshot } from './redis.js';
import { getAgentRuntimeRoom } from './agent-runtime.js';
import { getAgentPendingTurn, getAgentRuntimeSnapshot } from './redis.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function setupSocketHandlers(io: SocketIOServer): void {
  // Auth middleware — optional token. Spectating is public but we track auth'd users.
  io.use((socket, next) => {
    const token = socket.handshake.auth?.['token'] as string | undefined;
    if (token) {
      try {
        (socket.data as Record<string, unknown>).user = verifyToken(token);
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
    socket.on('subscribe', (payload: unknown) => {
      const arenaId = (payload as Record<string, unknown>)?.['arenaId'];
      if (typeof arenaId !== 'string' || !UUID_RE.test(arenaId)) return;
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

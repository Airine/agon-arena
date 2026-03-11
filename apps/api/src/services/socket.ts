import type { Server as SocketIOServer } from 'socket.io';
import { verifyToken } from '../middleware/auth.js';
import { getGameSnapshot } from './redis.js';

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
  });
}

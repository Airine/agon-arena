import type { Server as SocketIOServer } from 'socket.io';
import { verifyToken } from '../middleware/auth.js';

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
    socket.on('join:arena', (arenaId: unknown) => {
      // Validate arenaId is a UUID to prevent room name injection
      if (typeof arenaId !== 'string' || !UUID_RE.test(arenaId)) return;
      socket.join(`arena:${arenaId}`);
    });

    socket.on('leave:arena', (arenaId: unknown) => {
      if (typeof arenaId !== 'string' || !UUID_RE.test(arenaId)) return;
      socket.leave(`arena:${arenaId}`);
    });
  });
}

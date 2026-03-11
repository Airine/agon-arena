import type { Server as SocketIOServer } from 'socket.io';

export function setupSocketHandlers(io: SocketIOServer): void {
  io.on('connection', (socket) => {
    console.log(`Client connected: ${socket.id}`);

    socket.on('join:arena', (arenaId: string) => {
      socket.join(`arena:${arenaId}`);
      console.log(`${socket.id} joined arena:${arenaId}`);
    });

    socket.on('leave:arena', (arenaId: string) => {
      socket.leave(`arena:${arenaId}`);
      console.log(`${socket.id} left arena:${arenaId}`);
    });

    socket.on('disconnect', () => {
      console.log(`Client disconnected: ${socket.id}`);
    });
  });
}

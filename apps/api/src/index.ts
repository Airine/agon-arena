import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { authRouter } from './routes/auth.js';
import { agentsRouter } from './routes/agents.js';
import { arenasRouter } from './routes/arenas.js';
import { skillsRouter } from './routes/skills.js';
import { setupSocketHandlers } from './services/socket.js';
import { setIO } from './services/io.js';

const app = express();
const httpServer = createServer(app);

const io = new SocketIOServer(httpServer, {
  cors: {
    origin: process.env['CORS_ORIGIN'] ?? 'http://localhost:3000',
    methods: ['GET', 'POST'],
  },
});

// Register IO instance for orchestrator access
setIO(io);

// Middleware
app.use(cors({ origin: process.env['CORS_ORIGIN'] ?? 'http://localhost:3000' }));
app.use(express.json({ limit: '1mb' }));

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Routes
app.use('/auth', authRouter);
app.use('/agents', agentsRouter);
app.use('/arenas', arenasRouter);
app.use('/skills', skillsRouter);

// Socket.io
setupSocketHandlers(io);

const PORT = Number(process.env['PORT'] ?? 4000);

httpServer.listen(PORT, () => {
  console.log(`AgentArena API running on http://localhost:${PORT}`);
});

export { io };

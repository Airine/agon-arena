import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient } from 'redis';
import { authRouter } from './routes/auth.js';
import { agentsRouter } from './routes/agents.js';
import { arenasRouter } from './routes/arenas.js';
import { skillsRouter } from './routes/skills.js';
import { githubOAuthRouter } from './routes/github-oauth.js';
import { googleOAuthRouter } from './routes/google-oauth.js';
import { socialBindingsRouter } from './routes/social-bindings.js';
import { matchmakingRouter } from './routes/matchmaking.js';
import { paymentsRouter } from './routes/payments.js';
import { setupSocketHandlers } from './services/socket.js';
import { setIO } from './services/io.js';
import { startMatchmakingProcessor } from './services/matchmaking.js';

const app = express();
const httpServer = createServer(app);

const io = new SocketIOServer(httpServer, {
  cors: {
    origin: process.env['CORS_ORIGIN'] ?? 'http://localhost:3000',
    methods: ['GET', 'POST'],
  },
});

// Redis Pub/Sub adapter for multi-instance support
const REDIS_URL = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
const pubClient = createClient({ url: REDIS_URL });
const subClient = pubClient.duplicate();

pubClient.on('error', (err) => console.warn('[Redis Pub] error:', err));
subClient.on('error', (err) => console.warn('[Redis Sub] error:', err));

Promise.all([pubClient.connect(), subClient.connect()])
  .then(() => {
    io.adapter(createAdapter(pubClient, subClient));
    console.log('[Socket.io] Redis adapter attached');
  })
  .catch((err) => {
    console.warn('[Socket.io] Redis adapter unavailable, falling back to in-memory:', err);
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
app.use('/auth/github', githubOAuthRouter);
app.use('/auth/google', googleOAuthRouter);
app.use('/auth/social', socialBindingsRouter);
app.use('/agents', agentsRouter);
app.use('/arenas', arenasRouter);
app.use('/skills', skillsRouter);
app.use('/matchmaking', matchmakingRouter);
app.use('/payments', paymentsRouter);

// Socket.io
setupSocketHandlers(io);

// Background services
startMatchmakingProcessor();

const PORT = Number(process.env['PORT'] ?? 4000);

httpServer.listen(PORT, () => {
  console.log(`AgentArena API running on http://localhost:${PORT}`);
});

export { io };

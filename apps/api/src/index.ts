import 'dotenv/config';
import './env.js';
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient } from 'redis';
import { authRouter } from './routes/auth.js';
import { emailAuthRouter } from './routes/email-auth.js';
import { ipRateLimit, deviceFingerprintLimit } from './middleware/rate-limit.js';
import { agentsRouter } from './routes/agents.js';
import { arenasRouter } from './routes/arenas.js';
import { skillsRouter } from './routes/skills.js';
import { githubOAuthRouter } from './routes/github-oauth.js';
import { googleOAuthRouter } from './routes/google-oauth.js';
import { twitterOAuthRouter } from './routes/twitter-oauth.js';
import { socialBindingsRouter } from './routes/social-bindings.js';
import { invitesRouter } from './routes/invites.js';
import { ensBindingRouter } from './routes/ens-binding.js';
import { matchmakingRouter } from './routes/matchmaking.js';
import { paymentsRouter } from './routes/payments.js';
import { setupSocketHandlers } from './services/socket.js';
import { setIO } from './services/io.js';
import { startMatchmakingProcessor } from './services/matchmaking.js';
import { initKafka, shutdownKafka } from './services/kafka.js';
import { reconcileRunningArenasOnStartup } from './services/arena-lifecycle.js';

const app = express();
const httpServer = createServer(app);
const allowedOrigins = (process.env['CORS_ORIGIN'] ?? 'http://localhost:3000')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const io = new SocketIOServer(httpServer, {
  cors: {
    origin: allowedOrigins,
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
app.use(cors({ origin: allowedOrigins }));
app.use(express.json({ limit: '1mb' }));

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Anti-fraud: IP rate limits on auth endpoints (applied before route handlers)
app.use('/auth/siwe', ipRateLimit(60, 10, 'rl:siwe'));            // 10 SIWE requests per min per IP
app.use('/auth/github/callback', ipRateLimit(60, 5, 'rl:gh'));    // 5 GitHub callbacks per min per IP
app.use('/auth/google/callback', ipRateLimit(60, 5, 'rl:gg'));    // 5 Google callbacks per min per IP
app.use('/auth/twitter/callback', ipRateLimit(60, 5, 'rl:tw'));   // 5 Twitter callbacks per min per IP
app.use('/auth/ens/verify', ipRateLimit(60, 5, 'rl:ens'));         // 5 ENS verifications per min per IP (prevents resolver spam)
// Device fingerprint: max 3 new accounts per 24h per device
app.use('/auth/siwe/verify', deviceFingerprintLimit(86400, 3));

// Routes
app.use('/auth', authRouter);
app.use('/auth/email', emailAuthRouter);
app.use('/auth/github', githubOAuthRouter);
app.use('/auth/google', googleOAuthRouter);
app.use('/auth/twitter', twitterOAuthRouter);
app.use('/auth/social', socialBindingsRouter);
app.use('/auth/invites', invitesRouter);
app.use('/auth/ens', ensBindingRouter);
app.use('/agents', agentsRouter);
app.use('/arenas', arenasRouter);
app.use('/skills', skillsRouter);
app.use('/matchmaking', matchmakingRouter);
app.use('/payments', paymentsRouter);

// Socket.io
setupSocketHandlers(io);

// Background services
startMatchmakingProcessor();
initKafka().catch(console.error);

process.on('SIGTERM', async () => {
  await shutdownKafka();
  process.exit(0);
});

const PORT = Number(process.env['PORT'] ?? 4000);

httpServer.listen(PORT, () => {
  console.log(`AgentArena API running on http://localhost:${PORT}`);
  reconcileRunningArenasOnStartup().catch((err) => {
    console.error('[Arena lifecycle] Failed to reconcile running arenas on startup', err);
  });
});

export { io };

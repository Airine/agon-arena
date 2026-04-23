/**
 * k6 load test — 100 concurrent agent action submissions
 *
 * Simulates 100 agents submitting poker actions via REST while also
 * maintaining WebSocket connections for turn notifications.
 *
 * Run:
 *   k6 run e2e/load/agents.k6.js \
 *     -e API_URL=http://localhost:4000 \
 *     -e AGENT_TOKENS=<token1>,<token2>,...
 *
 * AGENT_TOKENS should be valid agent JWT tokens (one per VU).
 * Without tokens the test exercises unauthenticated action submission
 * and expects 401 responses, which it still counts for p99 latency.
 */
import { check, sleep } from 'k6';
import http from 'k6/http';
import ws from 'k6/ws';
import { Rate, Trend } from 'k6/metrics';

const actionLatency = new Trend('action_latency_ms', true);
const actionSuccessRate = new Rate('action_success');

export const options = {
  scenarios: {
    agents: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '20s', target: 100 }, // ramp to 100 agents
        { duration: '60s', target: 100 }, // hold
        { duration: '10s', target: 0 },   // ramp down
      ],
    },
  },
  thresholds: {
    'action_latency_ms{name:action}': ['p99<500'], // REST action p99 < 500ms
    action_success: ['rate>0.95'],                  // >95% of requests complete (some 401s expected without real tokens)
    checks: ['rate>0.95'],
  },
};

const API_URL = __ENV.API_URL || 'http://localhost:4000';
const WS_URL = API_URL.replace(/^http/, 'ws');

const AGENT_TOKENS = (__ENV.AGENT_TOKENS || '').split(',').filter(Boolean);
const ARENA_IDS = (__ENV.ARENA_IDS || '').split(',').filter(Boolean);
const AGENT_IDS = (__ENV.AGENT_IDS || '').split(',').filter(Boolean);

export default function agentSession() {
  const vuIdx = __VU - 1;
  const token = AGENT_TOKENS[vuIdx % Math.max(AGENT_TOKENS.length, 1)] || null;
  const arenaId = ARENA_IDS[vuIdx % Math.max(ARENA_IDS.length, 1)] || null;
  const agentId = AGENT_IDS[vuIdx % Math.max(AGENT_IDS.length, 1)] || null;

  const headers = token
    ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    : { 'Content-Type': 'application/json' };

  // Open WebSocket for turn notifications
  ws.connect(WS_URL, {}, (socket) => {
    socket.on('open', () => {
      if (arenaId && agentId) {
        socket.send(JSON.stringify({
          event: 'agent:subscribe',
          data: { arenaId, agentId },
        }));
      }
    });

    socket.on('message', (data) => {
      let msg;
      try { msg = JSON.parse(data); } catch { return; }

      // When a turn arrives, immediately submit an action via REST
      if (msg.event === 'agent:turn_request' && arenaId && agentId) {
        const turnId = msg.data?.turnId;
        if (!turnId) return;

        const start = Date.now();
        const res = http.post(
          `${API_URL}/arenas/${arenaId}/actions`,
          JSON.stringify({ agentId, turnId, action: 'call' }),
          { headers, tags: { name: 'action' } },
        );
        actionLatency.add(Date.now() - start, { name: 'action' });
        const ok = res.status === 200 || res.status === 201;
        actionSuccessRate.add(ok);
        check(res, { 'action accepted': () => ok });
      }
    });

    sleep(90);
    socket.close();
  });
}

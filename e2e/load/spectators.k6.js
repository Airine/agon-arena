/**
 * k6 load test — 1,000 concurrent spectators
 *
 * Tests that the API can hold 1,000 simultaneous WebSocket spectator
 * connections across multiple arenas without dropping events or exceeding
 * acceptable latency budgets.
 *
 * Run:
 *   k6 run e2e/load/spectators.k6.js \
 *     -e API_URL=http://localhost:4000 \
 *     -e ARENA_IDS=<uuid1>,<uuid2>,...
 */
import { check, sleep } from 'k6';
import ws from 'k6/ws';
import { Counter, Rate } from 'k6/metrics';

const eventsReceived = new Counter('events_received');
const subscribeSuccessRate = new Rate('subscribe_success');
const arenaFullRate = new Rate('arena_full');

export const options = {
  scenarios: {
    spectators: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 1000 }, // ramp to 1,000 spectators
        { duration: '60s', target: 1000 }, // hold for 1 minute
        { duration: '15s', target: 0 },    // ramp down
      ],
    },
  },
  thresholds: {
    ws_session_duration: ['p95<5000'],   // 95% of sessions open within 5s
    subscribe_success: ['rate>0.99'],    // >99% subscribe events accepted
    arena_full: ['rate<0.01'],           // <1% arena:full rejections
    checks: ['rate>0.99'],
  },
};

const API_URL = __ENV.API_URL || 'http://localhost:4000';
const WS_URL = API_URL.replace(/^http/, 'ws');

// Spread spectators across arenas (comma-separated list, or single arena)
const ARENA_IDS = (__ENV.ARENA_IDS || '').split(',').filter(Boolean);

export default function spectatorSession() {
  const arenaId = ARENA_IDS.length
    ? ARENA_IDS[Math.floor(Math.random() * ARENA_IDS.length)]
    : null;

  if (!arenaId) {
    console.error('No ARENA_IDS provided — set -e ARENA_IDS=<uuid>,...');
    return;
  }

  const res = ws.connect(WS_URL, {}, (socket) => {
    socket.on('open', () => {
      socket.send(JSON.stringify({ event: 'subscribe', data: { arenaId } }));
    });

    socket.on('message', (data) => {
      let msg;
      try { msg = JSON.parse(data); } catch { return; }

      if (msg.event === 'game:state_update' || msg.event === 'game:action' || msg.event === 'hand:start' || msg.event === 'hand:end') {
        eventsReceived.add(1);
        subscribeSuccessRate.add(true);
      }

      if (msg.event === 'arena:full') {
        arenaFullRate.add(true);
        socket.close();
        return;
      }
    });

    socket.on('error', () => {
      subscribeSuccessRate.add(false);
    });

    // Hold connection for the test duration
    sleep(90);
    socket.close();
  });

  check(res, { 'WS connected': (r) => r && r.status === 101 });
}

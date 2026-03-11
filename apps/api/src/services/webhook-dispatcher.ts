/**
 * AGO-28: Webhook dispatcher — sends proactive state-update webhooks to agents.
 *
 * Event flow per hand:
 *   hand:start  → dispatched once, before first action
 *   hand:action → dispatched after every player action (to all agents)
 *   hand:end    → dispatched once, after hand resolves
 *
 * Each agent receives only their private view (hole cards hidden for others).
 * Failed dispatches are fire-and-forget (log error, never block the game loop).
 * Agents not registered with a webhook URL (apiUrl starts with 'bot://') are skipped.
 */
import axios from 'axios';
import type { GameState, Winner } from '@agon/types';
import { signWebhookPayload } from './webhook-crypto.js';

const DISPATCH_TIMEOUT_MS = 3_000; // non-blocking, best-effort

export interface AgentEndpoint {
  agentId: string;
  apiUrl: string;
  webhookPublicKey: string | null;
}

export type HandEventType = 'hand:start' | 'hand:action' | 'hand:end';

export interface HandStartPayload {
  event: 'hand:start';
  arenaId: string;
  handNumber: number;
  vrfCommit: string;
  state: GameState; // private view for this agent
}

export interface HandActionPayload {
  event: 'hand:action';
  arenaId: string;
  handNumber: number;
  actorAgentId: string;
  action: { type: string; amount?: number };
  state: GameState; // private view for this agent
}

export interface HandEndPayload {
  event: 'hand:end';
  arenaId: string;
  handNumber: number;
  winners: Winner[];
  vrfSeed: string;
  state: GameState; // private view (hole cards visible at showdown for surviving players)
}

export type HandEventPayload = HandStartPayload | HandActionPayload | HandEndPayload;

/**
 * Dispatch an event to a single agent endpoint. Fire-and-forget.
 */
export async function dispatchToAgent(
  endpoint: AgentEndpoint,
  payload: HandEventPayload,
): Promise<void> {
  if (endpoint.apiUrl.startsWith('bot://')) return; // skip local bots

  const body = JSON.stringify(payload);
  const { signature, timestamp, nonce } = signWebhookPayload(body);

  try {
    await axios.post(`${endpoint.apiUrl}/state`, payload, {
      timeout: DISPATCH_TIMEOUT_MS,
      headers: {
        'Content-Type': 'application/json',
        'X-Agon-Signature': signature,
        'X-Agon-Timestamp': timestamp,
        'X-Agon-Nonce': nonce,
        'X-Agon-Event': payload.event,
      },
      maxRedirects: 0,
    });
  } catch {
    // Best-effort: never let dispatch errors affect the game loop
    console.warn(`[WebhookDispatcher] Failed to dispatch ${payload.event} to agent ${endpoint.agentId}`);
  }
}

/**
 * Dispatch an event to all agents in a hand, each with their private state view.
 * Dispatches are fire-and-forget and run in parallel.
 */
export function dispatchToAll(
  endpoints: AgentEndpoint[],
  makePayload: (agentId: string) => HandEventPayload,
): void {
  for (const endpoint of endpoints) {
    if (endpoint.apiUrl.startsWith('bot://')) continue;
    dispatchToAgent(endpoint, makePayload(endpoint.agentId)).catch(() => {});
  }
}

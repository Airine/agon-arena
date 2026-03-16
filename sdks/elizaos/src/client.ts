/** HTTP + runtime client for the Agon Arena REST and Socket.IO APIs. */

import { createHash, randomBytes } from 'crypto';
import { Wallet } from 'ethers';
import { io, type Socket } from 'socket.io-client';
import type { AgentArenaEvent, AgentRuntimeSnapshot, AgentTurnRequest } from './types.js';

export interface AgentAccessCard {
  name: string;
  description?: string;
  version?: string;
  capabilities?: string[];
  metadata?: Record<string, unknown>;
}

export interface AgentAccessParams {
  walletPrivateKey: string;
  agentCard: AgentAccessCard;
  timestamp?: number;
  nonce?: string;
}

export interface AuthSession {
  accessToken: string;
  refreshToken: string;
  expiresIn?: number;
  user?: Record<string, unknown>;
  agent?: Record<string, unknown> & { id?: string };
  created?: boolean;
}

export interface RuntimeSubscriptionOptions {
  agentId: string;
  arenaId: string;
  onSnapshot?: (snapshot: AgentRuntimeSnapshot) => void;
  onTurnRequest?: (turn: AgentTurnRequest) => void;
  onArenaEvent?: (event: AgentArenaEvent) => void;
  onError?: (payload: Record<string, unknown>) => void;
}

export class AgonClient {
  private baseUrl: string;
  private token: string | null;
  private refreshToken: string | null;

  constructor(baseUrl = 'https://api.agon.win', token?: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.token = token ?? null;
    this.refreshToken = null;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.token) h['Authorization'] = `Bearer ${this.token}`;
    return h;
  }

  private requestPath(path: string): string {
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    const parsed = new URL(this.baseUrl);
    const basePath = parsed.pathname === '/' ? '' : parsed.pathname.replace(/\/+$/, '');
    return `${basePath}${normalizedPath}` || '/';
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: { ...this.headers(), ...(init?.headers as Record<string, string>) },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Agon API ${res.status}: ${body}`);
    }
    return res.json() as Promise<T>;
  }

  private storeSession(data: Partial<AuthSession>): void {
    this.token = data.accessToken ?? this.token;
    this.refreshToken = data.refreshToken ?? this.refreshToken;
  }

  async login(email: string, password: string) {
    const data = await this.request<AuthSession>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    this.storeSession(data);
    return data;
  }

  async agentAccess(params: AgentAccessParams) {
    const wallet = new Wallet(params.walletPrivateKey);
    const address = wallet.address.toLowerCase();
    const timestamp = String(params.timestamp ?? Date.now());
    const nonce = params.nonce ?? randomBytes(16).toString('hex');
    const body = {
      agentCard: {
        ...params.agentCard,
        version: params.agentCard.version ?? '1.0',
        capabilities: params.agentCard.capabilities ?? [],
      },
    };
    const payload = JSON.stringify({
      address,
      timestamp: Number(timestamp),
      nonce,
      method: 'POST',
      path: this.requestPath('/auth/agent/access'),
      body_hash: createHash('sha256').update(JSON.stringify(body)).digest('hex'),
    });
    const signature = await wallet.signMessage(payload);
    const data = await this.request<AuthSession>('/auth/agent/access', {
      method: 'POST',
      headers: {
        'X-Agent-Address': address,
        'X-Timestamp': timestamp,
        'X-Nonce': nonce,
        'X-Signature': signature,
      },
      body: JSON.stringify(body),
    });
    this.storeSession(data);
    return data;
  }

  async listAgents() {
    return this.request<{ agents: Record<string, unknown>[] }>('/agents');
  }

  async getAgent(agentId: string) {
    return this.request<Record<string, unknown>>(`/agents/${agentId}`);
  }

  async listArenas(status?: string) {
    const qs = status ? `?status=${status}` : '';
    return this.request<{ arenas: Record<string, unknown>[] }>(`/arenas${qs}`);
  }

  async getArena(arenaId: string) {
    return this.request<Record<string, unknown>>(`/arenas/${arenaId}`);
  }

  async joinArena(arenaId: string, agentId: string) {
    return this.request<Record<string, unknown>>(`/arenas/${arenaId}/join`, {
      method: 'POST',
      body: JSON.stringify({ agentId }),
    });
  }

  async startArena(arenaId: string) {
    return this.request<Record<string, unknown>>(`/arenas/${arenaId}/start`, {
      method: 'POST',
    });
  }

  async getRuntime(arenaId: string, agentId: string) {
    return this.request<{ snapshot: AgentRuntimeSnapshot }>(
      `/arenas/${arenaId}/runtime?agentId=${agentId}`,
    );
  }

  async submitAction(
    arenaId: string,
    params: { agentId: string; turnId: string; action: string; amount?: number },
  ) {
    return this.request<{ accepted: boolean; turnId: string }>(`/arenas/${arenaId}/actions`, {
      method: 'POST',
      body: JSON.stringify(params),
    });
  }

  subscribeRuntime(options: RuntimeSubscriptionOptions): Socket {
    const socket = io(this.baseUrl, {
      auth: { token: this.token },
      transports: ['websocket'],
    });

    socket.on('connect', () => {
      socket.emit('agent:subscribe', {
        agentId: options.agentId,
        arenaId: options.arenaId,
      });
    });
    socket.on('agent:runtime_snapshot', (snapshot: AgentRuntimeSnapshot) => options.onSnapshot?.(snapshot));
    socket.on('agent:turn_request', (turn: AgentTurnRequest) => options.onTurnRequest?.(turn));
    socket.on('agent:arena_event', (event: AgentArenaEvent) => options.onArenaEvent?.(event));
    socket.on('agent:error', (payload) => options.onError?.(payload));

    return socket;
  }
}

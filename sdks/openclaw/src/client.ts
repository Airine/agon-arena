/** HTTP client for the Agon Arena REST API. */

import { createHash, randomBytes } from 'crypto';
import { Wallet } from 'ethers';
import { io, type Socket } from 'socket.io-client';
import type {
  AgentArenaEvent,
  AgentCard,
  AgentRuntimeSnapshot,
  AgentTurnRequest,
} from './types.js';

export interface AgentRegistrationParams {
  name: string;
  description?: string;
  avatarUrl?: string;
  version?: string;
  metadata?: Record<string, unknown>;
}

export type AgentAccessCard = AgentCard;

export interface AgentAccessParams {
  walletPrivateKey: string;
  agentCard: AgentAccessCard;
  timestamp?: number;
  nonce?: string;
}

export type AgentAccessHeaders = Record<string, string> & {
  'X-Agent-Address': string;
  'X-Timestamp': string;
  'X-Nonce': string;
  'X-Signature': string;
};

export interface AuthSession {
  accessToken: string;
  refreshToken: string;
  expiresIn?: number;
  user?: Record<string, unknown>;
  agent?: Record<string, unknown> & { id?: string };
  created?: boolean;
  token?: string;
}

export interface AgonClientConfig {
  baseUrl?: string;
  token?: string;
  refreshToken?: string;
}

function normalizeAgentCard(card: AgentAccessCard): AgentAccessCard {
  return {
    name: card.name,
    description: card.description,
    version: card.version ?? '1.0',
    capabilities: card.capabilities ?? [],
    metadata: card.metadata,
  };
}

export interface RuntimeSubscriptionOptions {
  agentId: string;
  arenaId: string;
  onSnapshot?: (snapshot: AgentRuntimeSnapshot) => void;
  onTurnRequest?: (turn: AgentTurnRequest) => void;
  onArenaEvent?: (event: AgentArenaEvent) => void;
  onError?: (payload: Record<string, unknown>) => void;
}

export function hashAgentAccessBody(body: unknown): string {
  return createHash('sha256').update(JSON.stringify(body ?? {})).digest('hex');
}

export function buildAgentAccessPayload(input: {
  address: string;
  timestamp: string;
  nonce: string;
  method: string;
  path: string;
  bodyHash: string;
}): string {
  return JSON.stringify({
    address: input.address.toLowerCase(),
    timestamp: Number(input.timestamp),
    nonce: input.nonce,
    method: input.method.toUpperCase(),
    path: input.path,
    body_hash: input.bodyHash,
  });
}

export class AgonClient {
  private baseUrl: string;
  private token: string | null;
  private refreshToken: string | null;

  constructor(config: AgonClientConfig = {}) {
    this.baseUrl = (config.baseUrl ?? 'https://api.agon.win').replace(/\/$/, '');
    this.token = config.token ?? null;
    this.refreshToken = config.refreshToken ?? null;
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

  private requestUrl(path: string): string {
    const parsed = new URL(this.baseUrl);
    return `${parsed.origin}${this.requestPath(path)}`;
  }

  private storeSession(data: Partial<AuthSession>): void {
    this.token = data.accessToken ?? data.token ?? this.token;
    this.refreshToken = data.refreshToken ?? this.refreshToken;
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(this.requestUrl(path), {
      ...init,
      headers: { ...this.headers(), ...(init?.headers as Record<string, string>) },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Agon API ${res.status}: ${body}`);
    }
    return res.json() as Promise<T>;
  }

  getAccessToken(): string | null {
    return this.token;
  }

  getRefreshToken(): string | null {
    return this.refreshToken;
  }

  setAccessToken(token: string | null): void {
    this.token = token;
  }

  async buildAgentAccessHeaders(params: AgentAccessParams): Promise<AgentAccessHeaders> {
    const wallet = new Wallet(params.walletPrivateKey);
    const address = wallet.address.toLowerCase();
    const timestamp = String(params.timestamp ?? Date.now());
    const nonce = params.nonce ?? randomBytes(16).toString('hex');
    const body = { agentCard: normalizeAgentCard(params.agentCard) };
    const payload = buildAgentAccessPayload({
      address,
      timestamp,
      nonce,
      method: 'POST',
      path: this.requestPath('/auth/agent/access'),
      bodyHash: hashAgentAccessBody(body),
    });
    const signature = await wallet.signMessage(payload);

    return {
      'X-Agent-Address': address,
      'X-Timestamp': timestamp,
      'X-Nonce': nonce,
      'X-Signature': signature,
    };
  }

  // --- Auth ---

  async register(username: string, email: string, password: string) {
    const data = await this.request<AuthSession>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, email, password }),
    });
    this.storeSession(data);
    return data;
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
    const agentCard = normalizeAgentCard(params.agentCard);
    const headers = await this.buildAgentAccessHeaders({ ...params, agentCard });
    const data = await this.request<AuthSession>('/auth/agent/access', {
      method: 'POST',
      headers,
      body: JSON.stringify({ agentCard }),
    });
    this.storeSession(data);
    return data;
  }

  async getPlatformPublicKey(): Promise<string> {
    const data = await this.request<{ publicKey: string }>('/auth/public-key');
    return data.publicKey;
  }

  // --- Agents ---

  async createAgent(params: AgentRegistrationParams) {
    return this.request<{ agent: Record<string, unknown> }>(
      '/agents',
      { method: 'POST', body: JSON.stringify(params) },
    );
  }

  async listAgents(ownerId?: string) {
    const qs = ownerId ? `?ownerId=${ownerId}` : '';
    return this.request<{ agents: Record<string, unknown>[] }>(`/agents${qs}`);
  }

  async getAgent(agentId: string) {
    return this.request<Record<string, unknown>>(`/agents/${agentId}`);
  }

  // --- Arenas ---

  async listArenas(status?: string) {
    const qs = status ? `?status=${status}` : '';
    return this.request<{ arenas: Record<string, unknown>[] }>(`/arenas${qs}`);
  }

  async getArena(arenaId: string) {
    return this.request<Record<string, unknown>>(`/arenas/${arenaId}`);
  }

  async createArena(name: string, options?: Record<string, unknown>) {
    return this.request<Record<string, unknown>>('/arenas', {
      method: 'POST',
      body: JSON.stringify({ name, ...options }),
    });
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

    socket.on('agent:runtime_snapshot', (snapshot: AgentRuntimeSnapshot) => {
      options.onSnapshot?.(snapshot);
    });
    socket.on('agent:turn_request', (turn: AgentTurnRequest) => {
      options.onTurnRequest?.(turn);
    });
    socket.on('agent:arena_event', (event: AgentArenaEvent) => {
      options.onArenaEvent?.(event);
    });
    socket.on('agent:error', (payload: Record<string, unknown>) => {
      options.onError?.(payload);
    });

    return socket;
  }
}

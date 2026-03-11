/** HTTP client for the Agon Arena REST API. */

export interface AgentRegistrationParams {
  name: string;
  description?: string;
  apiUrl: string;
  webhookPublicKey: string;
  avatarUrl?: string;
  version?: string;
  metadata?: Record<string, unknown>;
}

export interface AgonClientConfig {
  baseUrl?: string;
  token?: string;
}

export class AgonClient {
  private baseUrl: string;
  private token: string | null;

  constructor(config: AgonClientConfig = {}) {
    this.baseUrl = (config.baseUrl ?? 'https://api.agon.win').replace(/\/$/, '');
    this.token = config.token ?? null;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.token) h['Authorization'] = `Bearer ${this.token}`;
    return h;
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

  // --- Auth ---

  async register(username: string, email: string, password: string) {
    const data = await this.request<{ token: string }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, email, password }),
    });
    this.token = data.token;
    return data;
  }

  async login(email: string, password: string) {
    const data = await this.request<{ token: string }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    this.token = data.token;
    return data;
  }

  async getPlatformPublicKey(): Promise<string> {
    const data = await this.request<{ publicKey: string }>('/auth/public-key');
    return data.publicKey;
  }

  // --- Agents ---

  async createAgent(params: AgentRegistrationParams) {
    return this.request<{ agent: Record<string, unknown>; apiKey: string; platformPublicKey: string }>(
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
}

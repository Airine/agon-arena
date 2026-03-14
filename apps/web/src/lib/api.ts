const DEFAULT_API_BASE = 'http://localhost:4000';

function normalizeApiBase(base: string): string {
  return base.replace(/\/+$/, '');
}

export function getApiBase(): string {
  return normalizeApiBase(process.env.NEXT_PUBLIC_API_URL ?? DEFAULT_API_BASE);
}

export function buildApiUrl(path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${getApiBase()}${normalizedPath}`;
}

export function getAccessToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('accessToken') ?? localStorage.getItem('agon_token');
}

export function saveAccessToken(accessToken: string): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem('accessToken', accessToken);
  // Keep the older dashboard flow working until every caller is fully migrated.
  localStorage.setItem('agon_token', accessToken);
}

async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = getAccessToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(buildApiUrl(path), { ...options, headers });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error ?? `Request failed: ${res.status}`);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(body) }),
};

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface UserInfo {
  id: string;
  username: string;
  email?: string | null;
  walletAddress?: string | null;
  chipBalance?: number;
  createdAt?: string;
}

export function saveSession(tokens: TokenPair): void {
  saveAccessToken(tokens.accessToken);
  localStorage.setItem('refreshToken', tokens.refreshToken);
}

export function clearSession(): void {
  localStorage.removeItem('accessToken');
  localStorage.removeItem('agon_token');
  localStorage.removeItem('refreshToken');
}

export function isLoggedIn(): boolean {
  return Boolean(getAccessToken());
}

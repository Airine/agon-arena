'use client';

import { useState } from 'react';
import { api, saveSession, type TokenPair, type UserInfo } from '../../lib/api';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface EthereumProvider {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
}

declare global {
  interface Window {
    ethereum?: EthereumProvider;
  }
}

// ---------------------------------------------------------------------------
// SIWE helpers
// ---------------------------------------------------------------------------

function buildSiweMessage(address: string, nonce: string): string {
  const domain = window.location.host;
  const uri = window.location.origin;
  const issuedAt = new Date().toISOString();
  return [
    `${domain} wants you to sign in with your Ethereum account:`,
    address,
    '',
    'Sign in to Agon Arena',
    '',
    `URI: ${uri}`,
    'Version: 1',
    'Chain ID: 84532',
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt}`,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Tab components
// ---------------------------------------------------------------------------

function SiweTab({ onSuccess }: { onSuccess: () => void }) {
  const [status, setStatus] = useState<'idle' | 'connecting' | 'signing' | 'verifying'>('idle');
  const [error, setError] = useState('');

  async function handleSiweLogin() {
    setError('');

    if (!window.ethereum) {
      setError('No Ethereum wallet detected. Please install MetaMask.');
      return;
    }

    try {
      setStatus('connecting');
      const accounts = (await window.ethereum.request({
        method: 'eth_requestAccounts',
      })) as string[];

      const address = accounts[0];
      if (!address) throw new Error('No account selected');

      setStatus('signing');
      const { nonce } = await api.get<{ nonce: string }>('/auth/siwe/nonce');
      const message = buildSiweMessage(address, nonce);

      const signature = (await window.ethereum.request({
        method: 'personal_sign',
        params: [message, address],
      })) as string;

      setStatus('verifying');
      const result = await api.post<TokenPair & { user: UserInfo }>(
        '/auth/siwe/verify',
        { message, signature },
      );

      saveSession(result);
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'SIWE login failed');
      setStatus('idle');
    }
  }

  const labels: Record<typeof status, string> = {
    idle: 'Connect Wallet & Sign In',
    connecting: 'Connecting wallet…',
    signing: 'Sign the message in your wallet…',
    verifying: 'Verifying…',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <p style={{ color: 'var(--muted)', fontSize: '0.9rem' }}>
        Sign in with your Ethereum wallet using EIP-4361 (Base Sepolia).
      </p>

      <button
        onClick={handleSiweLogin}
        disabled={status !== 'idle'}
        style={{
          padding: '0.75rem 1.5rem',
          background: status !== 'idle' ? 'var(--border)' : 'var(--accent)',
          color: 'var(--fg)',
          border: 'none',
          borderRadius: '6px',
          cursor: status !== 'idle' ? 'not-allowed' : 'pointer',
          fontSize: '1rem',
          fontWeight: 600,
          transition: 'background 0.2s',
        }}
      >
        {labels[status]}
      </button>

      {error && (
        <p style={{ color: '#ef4444', fontSize: '0.875rem' }}>{error}</p>
      )}
    </div>
  );
}

function EmailTab({ onSuccess }: { onSuccess: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const result = await api.post<TokenPair & { user: UserInfo }>('/auth/login', {
        email,
        password,
      });
      saveSession(result);
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        <label style={{ fontSize: '0.875rem', color: 'var(--muted)' }}>Email</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          style={inputStyle}
          placeholder="you@example.com"
        />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        <label style={{ fontSize: '0.875rem', color: 'var(--muted)' }}>Password</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          style={inputStyle}
          placeholder="••••••••"
        />
      </div>

      {error && (
        <p style={{ color: '#ef4444', fontSize: '0.875rem' }}>{error}</p>
      )}

      <button
        type="submit"
        disabled={loading}
        style={{
          padding: '0.75rem 1.5rem',
          background: loading ? 'var(--border)' : 'var(--accent)',
          color: 'var(--fg)',
          border: 'none',
          borderRadius: '6px',
          cursor: loading ? 'not-allowed' : 'pointer',
          fontSize: '1rem',
          fontWeight: 600,
        }}
      >
        {loading ? 'Signing in…' : 'Sign In'}
      </button>

      <p style={{ fontSize: '0.875rem', color: 'var(--muted)', textAlign: 'center' }}>
        No account?{' '}
        <a href="/register" style={{ color: 'var(--accent)' }}>
          Register
        </a>
      </p>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Shared styles
// ---------------------------------------------------------------------------

const inputStyle: React.CSSProperties = {
  padding: '0.6rem 0.75rem',
  background: 'var(--bg)',
  border: '1px solid var(--border)',
  borderRadius: '6px',
  color: 'var(--fg)',
  fontSize: '1rem',
  outline: 'none',
  width: '100%',
};

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

type Tab = 'siwe' | 'email';

export default function LoginPage() {
  const [tab, setTab] = useState<Tab>('siwe');

  function handleSuccess() {
    window.location.href = '/dashboard';
  }

  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '2rem',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '420px',
          background: 'var(--card-bg)',
          border: '1px solid var(--border)',
          borderRadius: '12px',
          padding: '2rem',
        }}
      >
        <h1 style={{ fontSize: '1.75rem', marginBottom: '0.25rem' }}>Sign In</h1>
        <p style={{ color: 'var(--muted)', marginBottom: '1.5rem', fontSize: '0.9rem' }}>
          Welcome back to Agon Arena
        </p>

        {/* Tabs */}
        <div
          style={{
            display: 'flex',
            borderBottom: '1px solid var(--border)',
            marginBottom: '1.5rem',
          }}
        >
          {(['siwe', 'email'] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                flex: 1,
                padding: '0.6rem',
                background: 'none',
                border: 'none',
                borderBottom: tab === t ? `2px solid var(--accent)` : '2px solid transparent',
                color: tab === t ? 'var(--fg)' : 'var(--muted)',
                cursor: 'pointer',
                fontSize: '0.9rem',
                fontWeight: tab === t ? 600 : 400,
                marginBottom: '-1px',
                transition: 'color 0.15s',
              }}
            >
              {t === 'siwe' ? 'Wallet (SIWE)' : 'Email / Password'}
            </button>
          ))}
        </div>

        {tab === 'siwe' ? (
          <SiweTab onSuccess={handleSuccess} />
        ) : (
          <EmailTab onSuccess={handleSuccess} />
        )}
      </div>
    </main>
  );
}

'use client';

import Link from 'next/link';
import { useState } from 'react';
import { BrandShell, FormCard, StatusBadge } from '@/components/chrome';
import { api, saveSession, type TokenPair, type UserInfo } from '@/lib/api';

interface EthereumProvider {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
}

declare global {
  interface Window {
    ethereum?: EthereumProvider;
  }
}

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
      const result = await api.post<TokenPair & { user: UserInfo }>('/auth/siwe/verify', {
        message,
        signature,
      });

      saveSession(result);
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'SIWE login failed');
      setStatus('idle');
    }
  }

  const labels: Record<typeof status, string> = {
    idle: 'Connect Wallet & Sign In',
    connecting: 'Connecting wallet...',
    signing: 'Sign the message in your wallet...',
    verifying: 'Verifying...',
  };

  return (
    <div className="page-stack">
      <p className="muted-copy">
        Use wallet auth when you want the shortest path into owner and
        agent-native flows on Base Sepolia.
      </p>

      <button
        onClick={handleSiweLogin}
        disabled={status !== 'idle'}
        className="button-primary"
        style={{ width: '100%' }}
      >
        {labels[status]}
      </button>

      {error ? <div className="error-banner">{error}</div> : null}
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
    <form onSubmit={handleSubmit} className="field-grid">
      <div className="form-field">
        <label className="form-label">Email</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          className="text-input"
          placeholder="you@example.com"
        />
      </div>

      <div className="form-field">
        <label className="form-label">Password</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          className="text-input"
          placeholder="••••••••"
        />
      </div>

      {error ? <div className="error-banner">{error}</div> : null}

      <button type="submit" disabled={loading} className="button-primary" style={{ width: '100%' }}>
        {loading ? 'Signing in...' : 'Sign In'}
      </button>
    </form>
  );
}

type Tab = 'siwe' | 'email';

const valueProps = [
  'Wallet-first access for human owners, with email compatibility still intact.',
  'Agent accounts stay first-class citizens while session helpers and legacy token mirroring remain supported.',
  'The same workspace can move from live arenas to capital allocation without switching mental models.',
];

export default function LoginPage() {
  const [tab, setTab] = useState<Tab>('siwe');

  function handleSuccess() {
    window.location.href = '/dashboard';
  }

  return (
    <BrandShell compact>
      <section className="auth-shell">
        <div className="auth-shell__story surface-card surface-card--brand surface-card--padded">
          <p className="brand-kicker">Owner Access</p>
          <h1 className="auth-shell__title">Sign into the owner workspace.</h1>
          <p className="auth-shell__lead">
            In the PRD model, humans fund and govern autonomous agents rather
            than micromanage every action. This flow is the bridge into that
            workspace.
          </p>

          <div className="page-stack">
            <StatusBadge label="Wallet First" tone="accent" />
            <StatusBadge label="Owner Console" tone="success" />
          </div>

          <div className="auth-shell__notes">
            {valueProps.map((item) => (
              <div key={item} className="auth-shell__note">
                {item}
              </div>
            ))}
          </div>
        </div>

        <FormCard
          eyebrow="Authentication"
          title="Welcome back"
          description="Choose wallet auth for the shortest path, or sign in with email and password."
          footer={
            <p className="muted-copy" style={{ fontSize: '0.92rem' }}>
              No account yet?{' '}
              <Link href="/register" style={{ color: 'var(--accent-blue)' }}>
                Create one here
              </Link>
              .
            </p>
          }
        >
          <div className="pill-row" style={{ marginBottom: '18px' }}>
            {(['siwe', 'email'] as Tab[]).map((item) => (
              <button
                key={item}
                onClick={() => setTab(item)}
                className={`pill-button ${tab === item ? 'pill-button--active' : ''}`}
                type="button"
              >
                {item === 'siwe' ? 'Wallet (SIWE)' : 'Email / Password'}
              </button>
            ))}
          </div>

          {tab === 'siwe' ? <SiweTab onSuccess={handleSuccess} /> : <EmailTab onSuccess={handleSuccess} />}
        </FormCard>
      </section>
    </BrandShell>
  );
}

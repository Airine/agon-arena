'use client';

import { useState, useEffect } from 'react';
import { api, clearSession, isLoggedIn, type UserInfo } from '../../lib/api';

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

interface AgentInfo {
  id: string;
  name: string;
  apiUrl: string;
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

const cardStyle: React.CSSProperties = {
  background: 'var(--card-bg)',
  border: '1px solid var(--border)',
  borderRadius: '12px',
  padding: '1.5rem',
  marginBottom: '1.5rem',
};

// ---------------------------------------------------------------------------
// Agent Registration Panel
// ---------------------------------------------------------------------------

function AgentRegistrationPanel() {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [apiUrl, setApiUrl] = useState('');
  const [capabilities, setCapabilities] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [registered, setRegistered] = useState<AgentInfo | null>(null);

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (!window.ethereum) {
      setError('No Ethereum wallet detected. Please install MetaMask.');
      return;
    }

    setLoading(true);
    try {
      // 1. Get accounts
      const accounts = (await window.ethereum.request({
        method: 'eth_requestAccounts',
      })) as string[];
      const walletAddress = accounts[0];
      if (!walletAddress) throw new Error('No account selected');

      // 2. Get nonce
      const { nonce } = await api.get<{ nonce: string }>('/auth/agent/nonce');

      // 3. Sign EIP-191 message
      const message = `Register Agon Agent\nNonce: ${nonce}`;
      const signature = (await window.ethereum.request({
        method: 'personal_sign',
        params: [message, walletAddress],
      })) as string;

      // 4. Register agent
      const capList = capabilities
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

      const result = await api.post<{ agent: AgentInfo }>('/auth/agent/register', {
        walletAddress,
        nonce,
        signature,
        agentCard: {
          name,
          description: description || undefined,
          apiUrl,
          capabilities: capList,
        },
      });

      setRegistered(result.agent);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Agent registration failed');
    } finally {
      setLoading(false);
    }
  }

  if (registered) {
    return (
      <div style={cardStyle}>
        <h2 style={{ marginBottom: '1rem', fontSize: '1.1rem' }}>Agent Registration</h2>
        <div
          style={{
            padding: '1rem',
            background: '#14532d33',
            border: '1px solid #22c55e44',
            borderRadius: '8px',
            color: '#22c55e',
          }}
        >
          <p style={{ fontWeight: 600, marginBottom: '0.25rem' }}>
            ✓ Agent registered successfully
          </p>
          <p style={{ fontSize: '0.875rem', opacity: 0.8 }}>
            Name: {registered.name} · ID: {registered.id.slice(0, 8)}…
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={cardStyle}>
      <h2 style={{ marginBottom: '0.5rem', fontSize: '1.1rem' }}>Register an Agent</h2>
      <p style={{ color: 'var(--muted)', fontSize: '0.875rem', marginBottom: '1rem' }}>
        Connect your AI agent to compete in the arena. Requires wallet signature.
      </p>

      <form
        onSubmit={handleRegister}
        style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <label style={{ fontSize: '0.875rem', color: 'var(--muted)' }}>Agent Name *</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            style={inputStyle}
            placeholder="My Poker Bot"
          />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <label style={{ fontSize: '0.875rem', color: 'var(--muted)' }}>
            Description{' '}
            <span style={{ fontSize: '0.8rem', opacity: 0.6 }}>(optional)</span>
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            maxLength={500}
            style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }}
            placeholder="A GTO-based poker agent…"
          />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <label style={{ fontSize: '0.875rem', color: 'var(--muted)' }}>
            API URL *
          </label>
          <input
            type="url"
            value={apiUrl}
            onChange={(e) => setApiUrl(e.target.value)}
            required
            style={inputStyle}
            placeholder="https://your-agent.example.com"
          />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <label style={{ fontSize: '0.875rem', color: 'var(--muted)' }}>
            Capabilities{' '}
            <span style={{ fontSize: '0.8rem', opacity: 0.6 }}>(comma-separated)</span>
          </label>
          <input
            type="text"
            value={capabilities}
            onChange={(e) => setCapabilities(e.target.value)}
            style={inputStyle}
            placeholder="gto, bluff-detection, hand-reading"
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
          {loading ? 'Registering…' : 'Register Agent (Sign with Wallet)'}
        </button>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function SettingsPage() {
  const [user, setUser] = useState<UserInfo | null>(null);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    if (!isLoggedIn()) {
      window.location.href = '/login';
      return;
    }
    api.get<UserInfo>('/auth/me')
      .then(setUser)
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : 'Failed to load profile';
        setLoadError(msg);
      });
  }, []);

  function handleLogout() {
    clearSession();
    window.location.href = '/login';
  }

  if (loadError) {
    return (
      <main style={{ padding: '2rem', maxWidth: '640px', margin: '0 auto' }}>
        <p style={{ color: '#ef4444' }}>{loadError}</p>
        <a href="/login" style={{ color: 'var(--accent)' }}>
          Go to login
        </a>
      </main>
    );
  }

  if (!user) {
    return (
      <main style={{ padding: '2rem', maxWidth: '640px', margin: '0 auto' }}>
        <p style={{ color: 'var(--muted)' }}>Loading…</p>
      </main>
    );
  }

  return (
    <main style={{ padding: '2rem', maxWidth: '640px', margin: '0 auto' }}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '2rem',
        }}
      >
        <div>
          <h1 style={{ fontSize: '2rem', marginBottom: '0.25rem' }}>Settings</h1>
          <a href="/dashboard" style={{ color: 'var(--muted)', fontSize: '0.875rem' }}>
            ← Back to Dashboard
          </a>
        </div>
        <button
          onClick={handleLogout}
          style={{
            padding: '0.5rem 1rem',
            background: 'transparent',
            border: '1px solid var(--border)',
            borderRadius: '6px',
            color: 'var(--muted)',
            cursor: 'pointer',
            fontSize: '0.875rem',
          }}
        >
          Logout
        </button>
      </div>

      {/* Profile card */}
      <div style={cardStyle}>
        <h2 style={{ marginBottom: '1rem', fontSize: '1.1rem' }}>Profile</h2>
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <tbody>
            {[
              ['Username', user.username],
              ['Email', user.email ?? '—'],
              ['Wallet', user.walletAddress
                ? `${user.walletAddress.slice(0, 6)}…${user.walletAddress.slice(-4)}`
                : '—'],
              ['CHIP Balance', user.chipBalance !== undefined ? user.chipBalance.toLocaleString() : '—'],
              ['Member since', user.createdAt ? new Date(user.createdAt).toLocaleDateString() : '—'],
            ].map(([label, value]) => (
              <tr key={label}>
                <td
                  style={{
                    padding: '0.5rem 0',
                    color: 'var(--muted)',
                    fontSize: '0.875rem',
                    width: '40%',
                    borderBottom: '1px solid var(--border)',
                  }}
                >
                  {label}
                </td>
                <td
                  style={{
                    padding: '0.5rem 0',
                    fontSize: '0.9rem',
                    borderBottom: '1px solid var(--border)',
                    fontFamily: label === 'Wallet' ? 'monospace' : 'inherit',
                  }}
                >
                  {value}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Agent registration */}
      <AgentRegistrationPanel />
    </main>
  );
}

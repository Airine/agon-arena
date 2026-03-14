'use client';

import { useEffect, useState } from 'react';
import {
  ConsoleShell,
  FormCard,
  SectionTitle,
  StatusBadge,
  SurfaceCard,
} from '../../components/chrome';
import { buildConsoleNav } from '../../components/console-nav';
import { api, clearSession, isLoggedIn, type UserInfo } from '../../lib/api';

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
      const accounts = (await window.ethereum.request({
        method: 'eth_requestAccounts',
      })) as string[];
      const walletAddress = accounts[0];
      if (!walletAddress) throw new Error('No account selected');

      const { nonce } = await api.get<{ nonce: string }>('/auth/agent/nonce');
      const message = `Register Agon Agent\nNonce: ${nonce}`;
      const signature = (await window.ethereum.request({
        method: 'personal_sign',
        params: [message, walletAddress],
      })) as string;

      const capList = capabilities
        .split(',')
        .map((item) => item.trim())
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

  return (
    <FormCard
      eyebrow="Agent Registration"
      title="Add a new poker agent"
      description="This keeps the existing wallet-sign flow but puts it inside the new console shell."
    >
      {registered ? (
        <div className="success-banner">
          Agent registered successfully: {registered.name} ({registered.id.slice(0, 8)}...)
        </div>
      ) : (
        <form onSubmit={handleRegister} className="field-grid">
          <div className="form-field">
            <label className="form-label">Agent Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="text-input"
              placeholder="My Poker Bot"
            />
          </div>

          <div className="form-field">
            <label className="form-label">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              maxLength={500}
              className="text-area"
              placeholder="A GTO-based poker agent..."
            />
          </div>

          <div className="form-field">
            <label className="form-label">API URL</label>
            <input
              type="url"
              value={apiUrl}
              onChange={(e) => setApiUrl(e.target.value)}
              required
              className="text-input"
              placeholder="https://your-agent.example.com"
            />
          </div>

          <div className="form-field">
            <label className="form-label">Capabilities</label>
            <input
              type="text"
              value={capabilities}
              onChange={(e) => setCapabilities(e.target.value)}
              className="text-input"
              placeholder="gto, bluff-detection, hand-reading"
            />
          </div>

          {error ? <div className="error-banner">{error}</div> : null}

          <button type="submit" disabled={loading} className="button-primary" style={{ width: '100%' }}>
            {loading ? 'Registering...' : 'Register Agent'}
          </button>
        </form>
      )}
    </FormCard>
  );
}

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
        const message = err instanceof Error ? err.message : 'Failed to load profile';
        setLoadError(message);
      });
  }, []);

  function handleLogout() {
    clearSession();
    window.location.href = '/login';
  }

  const walletDisplay = user?.walletAddress
    ? `${user.walletAddress.slice(0, 6)}...${user.walletAddress.slice(-4)}`
    : '--';

  return (
    <ConsoleShell
      section="settings"
      title="Settings"
      eyebrow="Owner Console"
      description="Profile and registration settings now live in the same console language as the dashboard."
      actions={
        <button onClick={handleLogout} className="button-ghost">
          Logout
        </button>
      }
      sidebarGroups={buildConsoleNav('settings')}
      sidebarFooter={
        <SurfaceCard tone="spotlight" className="surface-card--padded">
          <div className="section-title__eyebrow">Profile Status</div>
          <h3 style={{ marginTop: '8px', fontSize: '1.02rem', fontWeight: 800 }}>
            {user?.username ?? 'Loading profile'}
          </h3>
          <p className="muted-copy" style={{ marginTop: '10px', fontSize: '0.92rem' }}>
            Wallet {walletDisplay}
          </p>
        </SurfaceCard>
      }
    >
      {loadError ? <div className="error-banner">{loadError}</div> : null}

      <div className="split-grid">
        <div className="stack-grid">
          <SurfaceCard>
            <SectionTitle eyebrow="Profile" title="Owner identity" />
            {!user ? (
              <p className="muted-copy">Loading profile...</p>
            ) : (
              <div className="console-stat-grid">
                <div className="console-stat">
                  <div className="console-stat__label">Username</div>
                  <div className="console-stat__value">{user.username}</div>
                </div>
                <div className="console-stat">
                  <div className="console-stat__label">Email</div>
                  <div className="console-stat__value">{user.email ?? '--'}</div>
                </div>
                <div className="console-stat">
                  <div className="console-stat__label">Wallet</div>
                  <div className="console-stat__value mono-copy">{walletDisplay}</div>
                </div>
                <div className="console-stat">
                  <div className="console-stat__label">CHIP Balance</div>
                  <div className="console-stat__value">
                    {user.chipBalance !== undefined ? user.chipBalance.toLocaleString() : '--'}
                  </div>
                </div>
              </div>
            )}
          </SurfaceCard>

          <SurfaceCard tone="spotlight">
            <SectionTitle eyebrow="Session" title="Current auth posture" />
            <div className="console-list">
              <div className="console-row-card">
                <div className="console-row-card__body">
                  <div className="console-row-card__title">
                    <h3>Web session</h3>
                    <StatusBadge label="Active" tone="success" />
                  </div>
                  <p className="console-row-card__copy">
                    Access token storage remains centralized in the shared helper,
                    including compatibility with the older dashboard token key.
                  </p>
                </div>
              </div>
              <div className="console-row-card">
                <div className="console-row-card__body">
                  <div className="console-row-card__title">
                    <h3>Agent registration</h3>
                    <StatusBadge label="Wallet Signature" tone="accent" />
                  </div>
                  <p className="console-row-card__copy">
                    The registration flow below still requests a wallet signature
                    before creating a new agent card.
                  </p>
                </div>
              </div>
            </div>
          </SurfaceCard>
        </div>

        <AgentRegistrationPanel />
      </div>
    </ConsoleShell>
  );
}

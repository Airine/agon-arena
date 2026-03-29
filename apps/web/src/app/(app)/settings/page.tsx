'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ConsoleShell,
  FormCard,
  SectionTitle,
  StatusBadge,
  SurfaceCard,
} from '@/components/chrome';
import { api, clearSession, isLoggedIn, type UserInfo } from '@/lib/api';

interface AgentInfo {
  id: string;
  name: string;
  metadata?: Record<string, unknown> | null;
}

function AgentRegistrationPanel() {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [capabilities, setCapabilities] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [registered, setRegistered] = useState<AgentInfo | null>(null);

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    setLoading(true);
    try {
      const capList = capabilities
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);

      const result = await api.post<{ agent: AgentInfo }>('/agents', {
        name,
        description: description || undefined,
        metadata: {
          capabilities: capList,
          createdVia: 'owner-console',
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
      eyebrow="Owner Draft"
      title="Create an agent profile without runtime networking"
      description="Public webhook URLs are no longer required. Owners can draft metadata here, while live runtimes should self-bootstrap from the For Agents entry."
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
              placeholder="My Strategy Agent"
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
              placeholder="An autonomous agent tuned for repeated strategic decision-making..."
            />
          </div>

          <div className="form-field">
            <label className="form-label">Capabilities</label>
            <input
              type="text"
              value={capabilities}
              onChange={(e) => setCapabilities(e.target.value)}
              className="text-input"
              placeholder="decision-making, execution, risk-management"
            />
          </div>

          {error ? <div className="error-banner">{error}</div> : null}

          <div className="surface-card surface-card--console surface-card--padded">
            <div className="section-title__eyebrow">Runtime path</div>
            <p className="muted-copy" style={{ marginTop: '8px' }}>
              Autonomous runtimes should use the agent skill and wallet-signed
              access flow from the login page Quick Start. This owner form only
              stores metadata and does not provision live runtime connectivity.
            </p>
          </div>

          <button type="submit" disabled={loading} className="button-primary" style={{ width: '100%' }}>
            {loading ? 'Saving...' : 'Create Profile'}
          </button>
        </form>
      )}
    </FormCard>
  );
}

export default function SettingsPage() {
  const router = useRouter();
  const [user, setUser] = useState<UserInfo | null>(null);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    if (!isLoggedIn()) {
      router.replace('/login');
      return;
    }

    api.get<UserInfo>('/auth/me')
      .then(setUser)
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : 'Failed to load profile';
        setLoadError(message);
      });
  }, [router]);

  function handleLogout() {
    clearSession();
    router.replace('/login');
  }

  const walletDisplay = user?.walletAddress
    ? `${user.walletAddress.slice(0, 6)}...${user.walletAddress.slice(-4)}`
    : '--';

  return (
    <ConsoleShell
      section="settings"
      title="Settings"
      eyebrow="Owner Console"
      description="Profile, wallet, and agent registration settings now live in the same owner workspace language as the dashboard."
      actions={
        <button onClick={handleLogout} className="button-ghost">
          Logout
        </button>
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
                    <h3>Runtime identity</h3>
                    <StatusBadge label="Wallet Signature" tone="accent" />
                  </div>
                  <p className="console-row-card__copy">
                    Owner drafts created here stay metadata-only. Live runtimes
                    self-bootstrap via the agent skill CLI, where a wallet
                    signature binds the permanent agent identity.
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

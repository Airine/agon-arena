'use client';

import { useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { BrandShell, FormCard } from '@/components/chrome';
import { api, saveSession, type TokenPair, type UserInfo } from '@/lib/api';
import {
  AGENT_INSTALL_COMMAND,
  AGENT_ONE_LINE_PROMPT,
  AGENT_OPTIONAL_SMOKE_TEST_COMMAND,
} from '@/lib/agent-onboarding';

interface EthereumProvider {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
}

declare global {
  interface Window {
    ethereum?: EthereumProvider;
  }
}

function buildSiweMessage(address: string, nonce: string): string {
  const domain = window.location.hostname;
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

function EmailCodeForm({
  mode,
  initialInviteCode = '',
  onSuccess,
}: {
  mode: 'signin' | 'register';
  initialInviteCode?: string;
  onSuccess: () => void;
}) {
  const isRegister = mode === 'register';
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [inviteCode, setInviteCode] = useState(initialInviteCode);
  const [showInviteField, setShowInviteField] = useState(isRegister || initialInviteCode.length > 0);
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'request' | 'verify'>('request');
  const [devCode, setDevCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  async function handleRequestCode(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const result = await api.post<{ sent: boolean; expiresIn: number; devCode?: string }>(
        '/auth/email/request-code',
        {
          email,
          purpose: 'login',
          ...(inviteCode.trim() ? { inviteCode: inviteCode.trim().toUpperCase() } : {}),
        },
      );
      setDevCode(result.devCode ?? '');
      setStep('verify');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send code');
    } finally {
      setLoading(false);
    }
  }

  async function handleVerifyCode(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const result = await api.post<TokenPair & { user: UserInfo }>('/auth/email/verify', {
        email,
        code,
        ...(isRegister && username.trim() ? { username: username.trim() } : {}),
        ...(inviteCode.trim() ? { inviteCode: inviteCode.trim().toUpperCase() } : {}),
      });
      saveSession(result);
      setSuccess(true);
      setTimeout(onSuccess, 800);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Verification failed';
      if (message.toLowerCase().includes('invite')) {
        setShowInviteField(true);
      }
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  if (success) {
    return <div className="success-banner">Signed in. Redirecting...</div>;
  }

  return (
    <form onSubmit={step === 'request' ? handleRequestCode : handleVerifyCode} className="field-grid">
      {isRegister ? (
        <div className="form-field">
          <label className="form-label">Username <span className="muted-copy">(optional)</span></label>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            minLength={3}
            maxLength={50}
            className="text-input"
            placeholder="coolagent"
          />
        </div>
      ) : null}

      <div className="form-field">
        <label className="form-label">Email</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          disabled={step === 'verify'}
          className="text-input"
          placeholder="you@example.com"
        />
      </div>

      {showInviteField ? (
        <div className="form-field">
          <label className="form-label">Invite / Referral Code <span className="muted-copy">(optional)</span></label>
          <input
            type="text"
            value={inviteCode}
            onChange={(e) => setInviteCode(e.target.value)}
            className="text-input"
            placeholder="AGON-XXXX-XXXX"
            maxLength={20}
          />
        </div>
      ) : null}

      {step === 'verify' ? (
        <div className="form-field">
          <label className="form-label">Verification Code</label>
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]{6}"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            required
            className="text-input"
            placeholder="123456"
          />
          {devCode ? (
            <p className="muted-copy" style={{ marginTop: '8px', fontSize: '0.85rem' }}>
              Dev code: <span className="mono-copy">{devCode}</span>
            </p>
          ) : null}
        </div>
      ) : null}

      {error ? <div className="error-banner">{error}</div> : null}

      <button type="submit" disabled={loading} className="button-primary" style={{ width: '100%' }}>
        {loading
          ? step === 'request' ? 'Sending code...' : 'Verifying...'
          : step === 'request' ? 'Send Code' : isRegister ? 'Create Account' : 'Sign In'}
      </button>

      {step === 'verify' ? (
        <button
          type="button"
          className="button-ghost"
          onClick={() => {
            setStep('request');
            setCode('');
            setDevCode('');
            setError('');
          }}
          style={{ width: '100%' }}
        >
          Use a different email
        </button>
      ) : null}
    </form>
  );
}

const AGENT_PROMPT = `Read the Agon Arena agent skill at:
https://agon.win/.well-known/agon-agent-skill.txt

Then do exactly this:
  ${AGENT_ONE_LINE_PROMPT}

Practice arenas are the public self-serve path right now. Serious tiers are curated.`;

const AGENT_CLI = `# Install the CLI
${AGENT_INSTALL_COMMAND}

# Run the full onboarding + turn loop
agon +play --practice --decision-cmd "<your decision script>"

# Optional validation
${AGENT_OPTIONAL_SMOKE_TEST_COMMAND}`;

function AgentQuickStart() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'prompt' | 'cli'>('prompt');
  const [copied, setCopied] = useState(false);

  const code = tab === 'prompt' ? AGENT_PROMPT : AGENT_CLI;

  function handleCopy() {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  }

  return (
    <div className="agent-qs">
      <button className="agent-qs__toggle" onClick={() => setOpen((v) => !v)} type="button">
        <span className="agent-qs__label">
          <span className="agent-qs__dot" />
          Autonomous Agent?
        </span>
        <span className="agent-qs__hint">
          One prompt to enter the arena {open ? '↑' : '↓'}
        </span>
      </button>

      {open && (
        <div className="agent-qs__body">
          <p className="agent-qs__description">
            Agents are first-class citizens. Send a prompt to your LLM runtime or run the
            install command — the skill handles wallet creation, signed credentials, and
            arena entry automatically.
          </p>

          <div className="pill-row">
            {(['prompt', 'cli'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={`pill-button ${tab === t ? 'pill-button--active' : ''}`}
              >
                {t === 'prompt' ? 'Prompt your agent' : 'CLI install'}
              </button>
            ))}
          </div>

          <div className="agent-qs__code-wrap">
            <code className="agent-qs__code">{code}</code>
            <button className="agent-qs__copy" onClick={handleCopy} type="button">
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

type SignInTab = 'siwe' | 'email';

function LoginPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const mode = searchParams.get('mode');
  const isRegister = mode === 'register';
  const initialInviteCode = (searchParams.get('inviteCode') ?? searchParams.get('ref') ?? '').toUpperCase();

  const [signInTab, setSignInTab] = useState<SignInTab>('siwe');

  function handleSignInSuccess() {
    router.replace('/dashboard');
  }

  function handleRegisterSuccess() {
    router.replace('/dashboard');
  }

  if (isRegister) {
    return (
      <BrandShell compact>
        <section className="auth-shell">
          <div className="auth-shell__story surface-card surface-card--brand surface-card--padded">
            <p className="brand-kicker">Agon Arena</p>
            <h1 className="auth-shell__title">Build<br />your fleet.</h1>
            <div className="auth-shell__rule" />
            <p className="auth-shell__lead">
              Create the owner account. Deploy agents.
              Let them compete and earn on your behalf.
            </p>
          </div>

          <FormCard
            title="Create your account"
            footer={
              <p className="muted-copy" style={{ fontSize: '0.92rem' }}>
                Already registered?{' '}
                <button
                  onClick={() => router.push('/login')}
                  style={{
                    background: 'none',
                    border: 'none',
                    padding: 0,
                    color: 'var(--gold)',
                    cursor: 'pointer',
                    font: 'inherit',
                    fontSize: 'inherit',
                  }}
                >
                  Sign in instead
                </button>
                .
              </p>
            }
          >
            <div className="pill-row" style={{ marginBottom: '18px' }}>
              <button
                onClick={() => router.replace('/login')}
                className="pill-button"
                type="button"
              >
                Sign In
              </button>
              <button
                className="pill-button pill-button--active"
                type="button"
                disabled
              >
                Create Account
              </button>
            </div>

            <EmailCodeForm
              mode="register"
              initialInviteCode={initialInviteCode}
              onSuccess={handleRegisterSuccess}
            />
          </FormCard>
        </section>
        <AgentQuickStart />
      </BrandShell>
    );
  }

  return (
    <BrandShell compact>
      <section className="auth-shell">
        <div className="auth-shell__story surface-card surface-card--brand surface-card--padded">
          <p className="brand-kicker">Agon Arena</p>
          <h1 className="auth-shell__title">Enter<br />the arena.</h1>
          <div className="auth-shell__rule" />
          <p className="auth-shell__lead">
            Fund autonomous agents. Claim the upside.
            No micromanagement required.
          </p>
        </div>

        <FormCard
          title="Welcome back"
          footer={
            <p className="muted-copy" style={{ fontSize: '0.92rem' }}>
              No account yet?{' '}
              <button
                onClick={() => router.push('/login?mode=register')}
                style={{
                  background: 'none',
                  border: 'none',
                  padding: 0,
                  color: 'var(--gold)',
                  cursor: 'pointer',
                  font: 'inherit',
                  fontSize: 'inherit',
                }}
              >
                Create one
              </button>
              .
            </p>
          }
        >
          <div className="pill-row" style={{ marginBottom: '18px' }}>
            <button
              className="pill-button pill-button--active"
              type="button"
              disabled
            >
              Sign In
            </button>
            <button
              onClick={() => router.replace('/login?mode=register')}
              className="pill-button"
              type="button"
            >
              Create Account
            </button>
          </div>

          <div className="pill-row" style={{ marginBottom: '18px' }}>
            {(['siwe', 'email'] as SignInTab[]).map((item) => (
              <button
                key={item}
                onClick={() => setSignInTab(item)}
                className={`pill-button ${signInTab === item ? 'pill-button--active' : ''}`}
                type="button"
              >
                {item === 'siwe' ? 'Wallet (SIWE)' : 'Email Code'}
              </button>
            ))}
          </div>

          {signInTab === 'siwe' ? (
            <SiweTab onSuccess={handleSignInSuccess} />
          ) : (
            <EmailCodeForm
              mode="signin"
              initialInviteCode={initialInviteCode}
              onSuccess={handleSignInSuccess}
            />
          )}
        </FormCard>
      </section>
      <AgentQuickStart />
    </BrandShell>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginPageInner />
    </Suspense>
  );
}

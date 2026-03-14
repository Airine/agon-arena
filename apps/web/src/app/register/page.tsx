'use client';

import Link from 'next/link';
import { useState } from 'react';
import { BrandShell, FormCard, StatusBadge } from '../../components/chrome';
import { api } from '../../lib/api';

const benefits = [
  'Start with a cleaner front door but keep the existing auth and API behavior intact.',
  'Register an owner account, then move directly into the arena, ladder, or owner console.',
  'Optional invite codes still work and continue to award the extra CHIP boost.',
];

export default function RegisterPage() {
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await api.post('/auth/register', {
        username,
        email,
        password,
        ...(inviteCode.trim() ? { inviteCode: inviteCode.trim().toUpperCase() } : {}),
      });
      setSuccess(true);
      setTimeout(() => {
        window.location.href = '/login';
      }, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <BrandShell compact>
      <section className="auth-shell">
        <div className="auth-shell__story surface-card surface-card--brand surface-card--padded">
          <p className="brand-kicker">Owner Onboarding</p>
          <h1 className="auth-shell__title">Create the account behind your agents.</h1>
          <p className="auth-shell__lead">
            This is the calmer version of the original onboarding flow: same
            backend behavior, cleaner surface, better separation between brand
            entry and operational pages.
          </p>

          <div className="page-stack">
            <StatusBadge label="1000 CHIP Signup" tone="warning" />
            <StatusBadge label="Invite Bonus Supported" tone="accent" />
          </div>

          <div className="auth-shell__notes">
            {benefits.map((item) => (
              <div key={item} className="auth-shell__note">
                {item}
              </div>
            ))}
          </div>
        </div>

        <FormCard
          eyebrow="Account Creation"
          title="Open your owner workspace"
          description="Create a login first. Agent registration and console access follow immediately after."
          footer={
            <p className="muted-copy" style={{ fontSize: '0.92rem' }}>
              Already registered?{' '}
              <Link href="/login" style={{ color: 'var(--accent-blue)' }}>
                Sign in instead
              </Link>
              .
            </p>
          }
        >
          {success ? (
            <div className="success-banner">Account created. Redirecting to sign in...</div>
          ) : (
            <form onSubmit={handleSubmit} className="field-grid">
              <div className="form-field">
                <label className="form-label">Username</label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                  minLength={3}
                  maxLength={50}
                  className="text-input"
                  placeholder="coolagent"
                />
              </div>

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
                  minLength={6}
                  className="text-input"
                  placeholder="••••••••"
                />
              </div>

              <div className="form-field">
                <label className="form-label">Invite Code (optional)</label>
                <input
                  type="text"
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value)}
                  className="text-input"
                  placeholder="AGON-XXXX-XXXX"
                  maxLength={20}
                />
              </div>

              {error ? <div className="error-banner">{error}</div> : null}

              <button type="submit" disabled={loading} className="button-primary" style={{ width: '100%' }}>
                {loading ? 'Creating account...' : 'Create Account'}
              </button>
            </form>
          )}
        </FormCard>
      </section>
    </BrandShell>
  );
}

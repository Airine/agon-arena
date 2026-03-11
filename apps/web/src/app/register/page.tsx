'use client';

import { useState } from 'react';
import { api } from '../../lib/api';

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
        <h1 style={{ fontSize: '1.75rem', marginBottom: '0.25rem' }}>Create Account</h1>
        <p style={{ color: 'var(--muted)', marginBottom: '1.5rem', fontSize: '0.9rem' }}>
          Join Agon Arena — get 1,000 CHIP on signup
        </p>

        {success ? (
          <div
            style={{
              padding: '1rem',
              background: '#14532d33',
              border: '1px solid #22c55e44',
              borderRadius: '8px',
              color: '#22c55e',
              textAlign: 'center',
            }}
          >
            Account created! Redirecting to login…
          </div>
        ) : (
          <form
            onSubmit={handleSubmit}
            style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <label style={{ fontSize: '0.875rem', color: 'var(--muted)' }}>Username</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                minLength={3}
                maxLength={50}
                style={inputStyle}
                placeholder="coolagent"
              />
            </div>

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
                minLength={6}
                style={inputStyle}
                placeholder="••••••••"
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <label style={{ fontSize: '0.875rem', color: 'var(--muted)' }}>
                Invite Code{' '}
                <span style={{ fontSize: '0.8rem', opacity: 0.6 }}>(optional — +500 CHIP)</span>
              </label>
              <input
                type="text"
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value)}
                style={inputStyle}
                placeholder="AGON-XXXX-XXXX"
                maxLength={20}
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
              {loading ? 'Creating account…' : 'Create Account'}
            </button>

            <p style={{ fontSize: '0.875rem', color: 'var(--muted)', textAlign: 'center' }}>
              Already have an account?{' '}
              <a href="/login" style={{ color: 'var(--accent)' }}>
                Sign in
              </a>
            </p>
          </form>
        )}
      </div>
    </main>
  );
}

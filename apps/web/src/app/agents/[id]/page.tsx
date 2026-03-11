'use client';

import { useEffect, useState } from 'react';
import { use } from 'react';

interface AgentDetail {
  id: string;
  name: string;
  description: string | null;
  ownerId: string;
  avatarUrl: string | null;
  version: string;
  metadata: Record<string, unknown> | null;
  eloRating: number;
  handsPlayed: number;
  handsWon: number;
  totalChipsWon: number;
  isActive: boolean;
  createdAt: string;
}

const API_URL =
  (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_API_URL) ||
  'http://localhost:4000';

function StatCard({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div
      style={{
        padding: '16px 20px',
        background: 'var(--card-bg)',
        border: '1px solid var(--border)',
        borderRadius: '8px',
      }}
    >
      <div style={{ fontSize: '11px', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px' }}>
        {label}
      </div>
      <div style={{ fontSize: '22px', fontWeight: 700, color: color ?? 'var(--fg)' }}>
        {value}
      </div>
    </div>
  );
}

export default function AgentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [agent, setAgent] = useState<AgentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    fetch(`${API_URL}/agents/${id}`)
      .then((r) => {
        if (r.status === 404) {
          setNotFound(true);
          return null;
        }
        return r.json();
      })
      .then((data: AgentDetail | null) => {
        if (data) setAgent(data);
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [id]);

  const winRate =
    agent && agent.handsPlayed > 0
      ? ((agent.handsWon / agent.handsPlayed) * 100).toFixed(1) + '%'
      : '—';

  return (
    <div style={{ padding: '2rem', maxWidth: '780px', margin: '0 auto' }}>
      <a
        href="/agents"
        style={{ color: 'var(--muted)', fontSize: '13px', display: 'block', marginBottom: '20px' }}
      >
        ← Agent Plaza
      </a>

      {loading && (
        <div style={{ textAlign: 'center', color: 'var(--muted)', padding: '48px' }}>
          Loading agent…
        </div>
      )}

      {notFound && !loading && (
        <div
          style={{
            padding: '16px',
            background: '#2d1a1a',
            border: '1px solid #742a2a',
            borderRadius: '8px',
            color: '#fc8181',
          }}
        >
          Agent not found.
        </div>
      )}

      {agent && (
        <>
          {/* Agent header */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '20px',
              marginBottom: '28px',
              padding: '20px',
              background: 'var(--card-bg)',
              border: '1px solid var(--border)',
              borderRadius: '12px',
            }}
          >
            {/* Avatar */}
            <div
              style={{
                width: '64px',
                height: '64px',
                borderRadius: '50%',
                background: '#1a2b40',
                border: '2px solid var(--border)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '22px',
                fontWeight: 700,
                color: 'var(--fg)',
                flexShrink: 0,
                overflow: 'hidden',
              }}
            >
              {agent.avatarUrl ? (
                <img
                  src={agent.avatarUrl}
                  alt={agent.name}
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
              ) : (
                agent.name.slice(0, 1).toUpperCase()
              )}
            </div>

            {/* Info */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                <h1 style={{ fontSize: '22px', fontWeight: 700, color: 'var(--fg)', margin: 0 }}>
                  {agent.name}
                </h1>
                <span
                  style={{
                    fontSize: '11px',
                    padding: '2px 8px',
                    borderRadius: '4px',
                    background: agent.isActive ? '#1a4731' : '#2d3748',
                    color: agent.isActive ? '#68d391' : 'var(--muted)',
                    border: `1px solid ${agent.isActive ? '#2d8b5a' : 'var(--border)'}`,
                    fontWeight: 600,
                  }}
                >
                  {agent.isActive ? 'ACTIVE' : 'INACTIVE'}
                </span>
                <span
                  style={{
                    fontSize: '11px',
                    padding: '2px 8px',
                    borderRadius: '4px',
                    background: '#1a2b40',
                    color: 'var(--muted)',
                    border: '1px solid var(--border)',
                  }}
                >
                  v{agent.version}
                </span>
              </div>
              {agent.description && (
                <p style={{ color: 'var(--muted)', fontSize: '14px', margin: '6px 0 0' }}>
                  {agent.description}
                </p>
              )}
              <div style={{ fontSize: '12px', color: 'var(--muted)', marginTop: '8px' }}>
                Joined {new Date(agent.createdAt).toLocaleDateString()}
              </div>
            </div>

            {/* ELO */}
            <div
              style={{
                textAlign: 'center',
                padding: '12px 20px',
                background: '#1a1a2e',
                borderRadius: '8px',
                border: '1px solid #4a5568',
                flexShrink: 0,
              }}
            >
              <div style={{ fontSize: '10px', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '1px' }}>
                ELO Rating
              </div>
              <div style={{ fontSize: '28px', fontWeight: 700, color: '#f6e05e', lineHeight: 1.2 }}>
                {agent.eloRating}
              </div>
            </div>
          </div>

          {/* Stats grid */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
              gap: '12px',
              marginBottom: '24px',
            }}
          >
            <StatCard label="Hands Played" value={agent.handsPlayed.toLocaleString()} />
            <StatCard label="Hands Won" value={agent.handsWon.toLocaleString()} color="#68d391" />
            <StatCard label="Win Rate" value={winRate} color="#63b3ed" />
            <StatCard
              label="Total Chips Won"
              value={`$${agent.totalChipsWon.toLocaleString()}`}
              color="#f6ad55"
            />
          </div>

          {/* Metadata */}
          {agent.metadata && Object.keys(agent.metadata).length > 0 && (
            <div
              style={{
                padding: '16px 20px',
                background: 'var(--card-bg)',
                border: '1px solid var(--border)',
                borderRadius: '8px',
              }}
            >
              <div style={{ fontSize: '12px', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '10px' }}>
                Metadata
              </div>
              <pre
                style={{
                  margin: 0,
                  fontSize: '12px',
                  color: 'var(--fg)',
                  background: 'none',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all',
                }}
              >
                {JSON.stringify(agent.metadata, null, 2)}
              </pre>
            </div>
          )}
        </>
      )}
    </div>
  );
}

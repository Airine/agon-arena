import Link from 'next/link';
import { MarketShell } from '@/components/chrome';

export default function PortfolioPage() {
  return (
    <MarketShell>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: 'calc(100vh - 64px)',
          gap: '16px',
          textAlign: 'center',
          padding: '48px',
        }}
      >
        <div className="status-badge status-badge--neutral" style={{ marginBottom: '8px' }}>
          Coming Soon
        </div>
        <h1
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 'clamp(2.4rem, 5vw, 4rem)',
            fontWeight: 400,
            letterSpacing: '0.02em',
            lineHeight: 0.95,
            textTransform: 'uppercase',
          }}
        >
          Portfolio
        </h1>
        <p className="muted-copy" style={{ maxWidth: '420px', marginTop: '12px' }}>
          Track your agent positions, ownership stakes, and historical performance across all arenas.
        </p>
        <Link href="/markets" className="button-secondary" style={{ marginTop: '8px' }}>
          Browse Markets
        </Link>
      </div>
    </MarketShell>
  );
}

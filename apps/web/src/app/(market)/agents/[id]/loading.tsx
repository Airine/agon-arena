import { MarketShell } from '@/components/chrome';

export default function AgentProfileLoading() {
  return (
    <MarketShell>
      <div className="agent-profile">
        {/* Back link placeholder */}
        <div className="agent-profile__skeleton-bar" style={{ width: 80, height: 14 }} />

        {/* Hero skeleton */}
        <div className="agent-profile__hero">
          <div className="agent-profile__hero-left">
            <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
              <div className="agent-profile__skeleton-bar" style={{ width: 72, height: 22, borderRadius: 999 }} />
              <div className="agent-profile__skeleton-bar" style={{ width: 56, height: 22, borderRadius: 999 }} />
            </div>
            <div className="agent-profile__skeleton-bar" style={{ width: 260, height: 48, marginBottom: 12 }} />
            <div className="agent-profile__skeleton-bar" style={{ width: 200, height: 14, marginBottom: 8 }} />
            <div className="agent-profile__skeleton-bar" style={{ width: 140, height: 14 }} />
          </div>
        </div>

        {/* Stats row skeleton */}
        <div className="agent-profile__stats">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="agent-profile__stat-card">
              <div className="agent-profile__skeleton-bar" style={{ width: 80, height: 11, marginBottom: 12 }} />
              <div className="agent-profile__skeleton-bar" style={{ width: 100, height: 32, marginBottom: 8 }} />
              <div className="agent-profile__skeleton-bar" style={{ width: 60, height: 10 }} />
            </div>
          ))}
        </div>

        {/* History table skeleton */}
        <div className="agent-profile__section">
          <div style={{ marginBottom: 20 }}>
            <div className="agent-profile__skeleton-bar" style={{ width: 90, height: 10, marginBottom: 8 }} />
            <div className="agent-profile__skeleton-bar" style={{ width: 160, height: 24 }} />
          </div>
          <div className="agent-profile__history-table">
            {/* Header row */}
            <div className="agent-profile__history-head">
              {['Arena', 'Result', 'Chips', 'Date'].map((col) => (
                <span key={col} style={{ opacity: 0 }}>{col}</span>
              ))}
            </div>
            {/* Body rows */}
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="agent-profile__history-row">
                <div className="agent-profile__skeleton-bar" style={{ width: '70%', height: 13 }} />
                <div className="agent-profile__skeleton-bar" style={{ width: 36, height: 13 }} />
                <div className="agent-profile__skeleton-bar" style={{ width: 48, height: 13, marginLeft: 'auto' }} />
                <div className="agent-profile__skeleton-bar" style={{ width: 72, height: 13, marginLeft: 'auto' }} />
              </div>
            ))}
          </div>
        </div>

        {/* Strategy skeleton */}
        <div className="agent-profile__strategy">
          <div style={{ marginBottom: 20 }}>
            <div className="agent-profile__skeleton-bar" style={{ width: 90, height: 10, marginBottom: 8 }} />
            <div className="agent-profile__skeleton-bar" style={{ width: 140, height: 24 }} />
          </div>
          <div className="agent-profile__skeleton-bar" style={{ height: 140, borderRadius: 10 }} />
        </div>
      </div>
    </MarketShell>
  );
}

import { MarketShell } from '@/components/chrome';

export default function PortfolioLoading() {
  return (
    <MarketShell>
      <div className="portfolio">
        {/* Page header */}
        <div className="portfolio__header">
          <div className="portfolio__skeleton-bar" style={{ width: 160, height: 40 }} />
          <div className="portfolio__skeleton-bar" style={{ width: 240, height: 14, marginTop: 8 }} />
        </div>

        {/* Stat strip skeleton */}
        <div className="portfolio__skeleton-stats">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="portfolio__skeleton-stat-card">
              <div className="portfolio__skeleton-bar portfolio__skeleton-bar--label" />
              <div className="portfolio__skeleton-bar portfolio__skeleton-bar--value" />
            </div>
          ))}
        </div>

        {/* Table skeleton */}
        <div className="portfolio__section">
          <div className="portfolio__skeleton-table">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="portfolio__skeleton-row" />
            ))}
          </div>
        </div>
      </div>
    </MarketShell>
  );
}

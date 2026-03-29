'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

export type ConsoleSection = 'dashboard' | 'arenas' | 'agents' | 'settings';

// ---------------------------------------------------------------------------
// BrandShell — auth pages (glow + grain backdrop, no nav — TopNav handles nav)
// ---------------------------------------------------------------------------

export function BrandShell({
  children,
  compact = false,
}: {
  children: ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={cx('brand-shell', compact && 'brand-shell--compact')}>
      <div className="brand-shell__glow brand-shell__glow--top" />
      <div className="brand-shell__glow brand-shell__glow--bottom" />
      <div className="brand-shell__grain" />
      <div className="brand-shell__body">{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ConsoleShell — owner dashboard / system pages
// ---------------------------------------------------------------------------

export function ConsoleShell({
  section: _section,
  title,
  description,
  eyebrow,
  actions,
  children,
}: {
  section: ConsoleSection;
  title: string;
  description?: ReactNode;
  eyebrow?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="console-shell">
      <main className="console-main">
        <PageHeader
          eyebrow={eyebrow}
          title={title}
          description={description}
          actions={actions}
        />
        <div className="console-main__content">{children}</div>
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// MarketShell — public market / arena pages
// ---------------------------------------------------------------------------

export interface MarketShellProps {
  children: ReactNode;
}

export function MarketShell({ children }: MarketShellProps) {
  return (
    <div className="market-shell">
      <div className="market-shell__grain" />
      <main className="market-shell__main">{children}</main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PageHeader
// ---------------------------------------------------------------------------

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="console-page-header">
      <div className="console-page-header__copy">
        {eyebrow ? <p className="console-page-header__eyebrow">{eyebrow}</p> : null}
        <h1 className="console-page-header__title">{title}</h1>
        {description ? (
          <div className="console-page-header__description">{description}</div>
        ) : null}
      </div>
      {actions ? <div className="console-page-header__actions">{actions}</div> : null}
    </header>
  );
}

export function SurfaceCard({
  className,
  tone = 'console',
  padded = true,
  children,
}: {
  className?: string;
  tone?: 'console' | 'brand' | 'spotlight';
  padded?: boolean;
  children: ReactNode;
}) {
  return (
    <section
      className={cx(
        'surface-card',
        `surface-card--${tone}`,
        padded && 'surface-card--padded',
        className,
      )}
    >
      {children}
    </section>
  );
}

export function MetricCard({
  label,
  value,
  description,
  href,
}: {
  label: string;
  value: ReactNode;
  description?: ReactNode;
  href?: string;
}) {
  const content = (
    <article className={cx('metric-card', href && 'metric-card--interactive')}>
      <div className="metric-card__label">{label}</div>
      <div className="metric-card__value">{value}</div>
      {description ? <div className="metric-card__description">{description}</div> : null}
    </article>
  );

  if (href) {
    return (
      <Link href={href} className="metric-card__link">
        {content}
      </Link>
    );
  }

  return content;
}

export function StatusBadge({
  label,
  tone = 'neutral',
}: {
  label: string;
  tone?: 'neutral' | 'success' | 'accent' | 'warning' | 'danger';
}) {
  return <span className={cx('status-badge', `status-badge--${tone}`)}>{label}</span>;
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-state__mark">AA</div>
      <h2 className="empty-state__title">{title}</h2>
      <div className="empty-state__description">{description}</div>
      {action ? <div className="empty-state__action">{action}</div> : null}
    </div>
  );
}

export function FormCard({
  title,
  eyebrow,
  description,
  children,
  footer,
}: {
  title: ReactNode;
  eyebrow?: string;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <SurfaceCard tone="console" className="form-card">
      {eyebrow ? <div className="form-card__eyebrow">{eyebrow}</div> : null}
      <div className="form-card__title">{title}</div>
      {description ? <div className="form-card__description">{description}</div> : null}
      <div className="form-card__body">{children}</div>
      {footer ? <div className="form-card__footer">{footer}</div> : null}
    </SurfaceCard>
  );
}

export function EntityAvatar({
  label,
  imageUrl,
  size = 'md',
}: {
  label: string;
  imageUrl?: string | null;
  size?: 'sm' | 'md' | 'lg';
}) {
  return (
    <div className={cx('entity-avatar', `entity-avatar--${size}`)}>
      {imageUrl ? (
        <img src={imageUrl} alt={label} className="entity-avatar__image" />
      ) : (
        <span className="entity-avatar__label">{label.slice(0, 2).toUpperCase()}</span>
      )}
    </div>
  );
}

export function SectionTitle({
  eyebrow,
  title,
  action,
}: {
  eyebrow?: string;
  title: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="section-title">
      <div>
        {eyebrow ? <div className="section-title__eyebrow">{eyebrow}</div> : null}
        <h2 className="section-title__text">{title}</h2>
      </div>
      {action ? <div className="section-title__action">{action}</div> : null}
    </div>
  );
}

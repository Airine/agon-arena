import Link from 'next/link';
import type { ReactNode } from 'react';

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

export type ConsoleSection = 'dashboard' | 'arenas' | 'agents' | 'settings';

export interface ConsoleNavItem {
  href: string;
  label: string;
  active?: boolean;
  meta?: string;
}

export interface ConsoleNavGroup {
  label: string;
  items: ConsoleNavItem[];
}

const RAIL_ITEMS: Array<{
  section: ConsoleSection;
  href: string;
  label: string;
  mark: string;
}> = [
  { section: 'dashboard', href: '/dashboard', label: 'Dashboard', mark: 'DB' },
  { section: 'arenas', href: '/arenas', label: 'Arenas', mark: 'AR' },
  { section: 'agents', href: '/agents', label: 'Agents', mark: 'AG' },
  { section: 'settings', href: '/settings', label: 'Settings', mark: 'ST' },
];

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

      <header className="brand-topbar">
        <Link href="/" className="brand-topbar__mark" aria-label="Agon Arena Home">
          <span className="brand-mark">AA</span>
          <span className="brand-topbar__title">Agon Arena</span>
        </Link>

        <nav className="brand-topbar__nav" aria-label="Primary">
          <Link href="/arenas">Live Arenas</Link>
          <Link href="/agents">Agents</Link>
          <Link href="/for-agents">For Agents</Link>
          <Link href="/dashboard" className="brand-topbar__nav-cta">Console →</Link>
        </nav>
      </header>

      <div className="brand-shell__body">{children}</div>
    </div>
  );
}

export function ConsoleShell({
  section,
  title,
  description,
  eyebrow,
  actions,
  sidebarGroups,
  sidebarFooter,
  children,
}: {
  section: ConsoleSection;
  title: string;
  description?: ReactNode;
  eyebrow?: string;
  actions?: ReactNode;
  sidebarGroups: ConsoleNavGroup[];
  sidebarFooter?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="console-shell">
      <aside className="console-sidebar" aria-label="Page navigation">
        <div className="console-sidebar__header">
          <Link href="/" className="console-sidebar__brand" aria-label="Agon Arena Home">
            <span className="console-sidebar__brand-mark">AA</span>
            <span className="console-sidebar__brand-name">Agon Arena</span>
          </Link>
          <p className="console-sidebar__eyebrow">Web4 Workspace</p>
          <h2 className="console-sidebar__title">Agon Control</h2>
          <p className="console-sidebar__copy">
            Monitor live arenas, coordinate agents, and manage owner capital from one board.
          </p>
        </div>

        <div className="console-sidebar__groups">
          {sidebarGroups.map((group) => (
            <section key={group.label} className="console-sidebar__group">
              <div className="console-sidebar__group-label">{group.label}</div>
              <div className="console-sidebar__group-items">
                {group.items.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cx(
                      'console-sidebar__link',
                      item.active && 'console-sidebar__link--active',
                    )}
                    aria-current={item.active ? 'page' : undefined}
                  >
                    <span>{item.label}</span>
                    {item.meta ? (
                      <span className="console-sidebar__link-meta">{item.meta}</span>
                    ) : null}
                  </Link>
                ))}
              </div>
            </section>
          ))}
        </div>

        {sidebarFooter ? (
          <div className="console-sidebar__footer">{sidebarFooter}</div>
        ) : null}
      </aside>

      <main className="console-main">
        <div className="console-mobile-nav">
          <div className="console-mobile-nav__rail">
            {RAIL_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={cx(
                  'console-mobile-nav__chip',
                  item.section === section && 'console-mobile-nav__chip--active',
                )}
              >
                {item.label}
              </Link>
            ))}
          </div>

          <div className="console-mobile-nav__context">
            {sidebarGroups.flatMap((group) =>
              group.items.filter((item) => item.active).map((item) => (
                <span key={item.href} className="console-mobile-nav__context-pill">
                  {group.label} / {item.label}
                </span>
              )),
            )}
          </div>
        </div>

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

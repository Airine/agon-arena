'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV_ITEMS = [
  { href: '/internal', label: 'Command Center' },
  { href: '/internal/alpha', label: 'Alpha Pipeline' },
  { href: '/internal/release-gate', label: 'Release Gate' },
];

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

export function InternalNav() {
  const pathname = usePathname();

  return (
    <nav className="internal-nav">
      <div className="internal-nav__eyebrow">Internal Ops</div>
      <div className="internal-nav__items">
        {NAV_ITEMS.map((item) => {
          const isActive =
            pathname === item.href || pathname.startsWith(`${item.href}/`);

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cx('internal-nav__link', isActive && 'internal-nav__link--active')}
            >
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

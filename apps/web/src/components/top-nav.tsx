'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useLang } from '@/lib/useLang';

const NO_NAV_PREFIXES = ['/internal'];

const NAV_LINKS = [
  { href: '/markets', label: 'Markets' },
  { href: '/leaderboard', label: 'Leaderboard' },
  { href: '/agents', label: 'Agents' },
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/settings', label: 'Settings' },
];

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

export function TopNav() {
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);
  const [lang, toggleLang] = useLang();
  const isLanding = pathname === '/';

  // Persist scroll listener for the lifetime of the app — never remounts
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Re-read scroll position when the route changes (scroll resets to 0 on navigation)
  useEffect(() => {
    setScrolled(window.scrollY > 20);
  }, [pathname]);

  if (NO_NAV_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return null;
  }

  return (
    <nav className={cx('unified-nav', scrolled && 'unified-nav--scrolled')}>
      <div className="unified-nav__inner">
        <Link href="/" className="unified-nav__logo">
          AGON ARENA
        </Link>
        <div className="unified-nav__links">
          {NAV_LINKS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cx(pathname.startsWith(item.href) && 'unified-nav__link--active')}
            >
              {item.label}
            </Link>
          ))}
        </div>
        <div className="unified-nav__right">
          {isLanding && (
            <button onClick={toggleLang} className="unified-nav__lang">
              {lang === 'en' ? '中文' : 'EN'}
            </button>
          )}
          <Link href="/login" className="unified-nav__signin">
            Sign In
          </Link>
        </div>
      </div>
    </nav>
  );
}

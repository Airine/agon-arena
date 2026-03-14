import type { ConsoleNavGroup, ConsoleSection } from './chrome';

export function buildConsoleNav(
  section: ConsoleSection,
  detail?: { label: string; meta?: string },
): ConsoleNavGroup[] {
  const groups: ConsoleNavGroup[] = [
    {
      label: 'Workspace',
      items: [
        { href: '/dashboard', label: 'Owner Dashboard', active: section === 'dashboard' },
        { href: '/arenas', label: 'Arena Lobby', active: section === 'arenas' && !detail },
        { href: '/agents', label: 'Agent Plaza', active: section === 'agents' && !detail },
        { href: '/settings', label: 'Settings', active: section === 'settings' },
      ],
    },
    {
      label: 'Flows',
      items: [
        { href: '/register', label: 'Register Agent' },
        { href: '/login', label: 'Sign In' },
      ],
    },
  ];

  if (detail) {
    groups.unshift({
      label: 'Current Surface',
      items: [
        {
          href: section === 'arenas' ? '/arenas' : '/agents',
          label: detail.label,
          meta: detail.meta,
          active: true,
        },
      ],
    });
  }

  return groups;
}

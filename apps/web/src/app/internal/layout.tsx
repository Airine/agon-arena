import type { ReactNode } from 'react';
import { InternalNav } from './_components/internal-nav';

export const dynamic = 'force-dynamic';

export default function InternalLayout({ children }: { children: ReactNode }) {
  return (
    <div className="console-shell">
      <div className="console-main">
        <div className="internal-layout">
          <aside className="internal-layout__sidebar">
            <InternalNav />
          </aside>
          <section className="internal-layout__content">{children}</section>
        </div>
      </div>
    </div>
  );
}

import { Bebas_Neue, DM_Sans, JetBrains_Mono, Syne } from 'next/font/google';
import type React from 'react';
import '../globals.css';

const dmSans = DM_Sans({ subsets: ['latin'], variable: '--font-dm' });
const syne = Syne({ subsets: ['latin'], variable: '--font-syne' });
const jetbrainsMono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-jetbrains', weight: ['400', '500', '600', '700'] });
const bebasNeue = Bebas_Neue({ subsets: ['latin'], variable: '--font-bebas', weight: ['400'] });

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`${dmSans.variable} ${syne.variable} ${jetbrainsMono.variable} ${bebasNeue.variable}`}
         style={{ fontFamily: 'var(--font-sans)', minHeight: '100vh' }}>
      {children}
    </div>
  );
}

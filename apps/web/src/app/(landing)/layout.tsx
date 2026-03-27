import { Bebas_Neue, DM_Sans, JetBrains_Mono, Syne } from 'next/font/google';
import type React from 'react';
import './landing.css';

const bebasNeue = Bebas_Neue({ subsets: ['latin'], weight: '400', variable: '--font-bebas' });
const syne = Syne({ subsets: ['latin'], variable: '--font-syne' });
const jetbrainsMono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-jetbrains' });
const dmSans = DM_Sans({ subsets: ['latin'], variable: '--font-dm' });

export default function LandingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`landing-root ${bebasNeue.variable} ${syne.variable} ${jetbrainsMono.variable} ${dmSans.variable}`}>
      {children}
    </div>
  );
}

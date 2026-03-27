import { Bebas_Neue, DM_Sans, JetBrains_Mono, Syne } from 'next/font/google';
import type { Metadata } from 'next';
import type React from 'react';

const dmSans = DM_Sans({ subsets: ['latin'], variable: '--font-dm' });
const syne = Syne({ subsets: ['latin'], variable: '--font-syne' });
const jetbrainsMono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-jetbrains', weight: ['400', '500', '600', '700'] });
const bebasNeue = Bebas_Neue({ subsets: ['latin'], variable: '--font-bebas', weight: ['400'] });

export const metadata: Metadata = {
  title: 'Agon Arena - AI Agent Competition Platform',
  description: 'A Web4-native platform where autonomous agents compete, earn, and share upside with their owners.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${dmSans.variable} ${syne.variable} ${jetbrainsMono.variable} ${bebasNeue.variable}`} data-scroll-behavior="smooth">
      <body>{children}</body>
    </html>
  );
}

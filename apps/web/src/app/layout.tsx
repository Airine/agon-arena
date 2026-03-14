import type { Metadata } from 'next';
import { IBM_Plex_Mono, Manrope, Newsreader } from 'next/font/google';
import type React from 'react';
import './globals.css';

const manrope = Manrope({
  subsets: ['latin'],
  variable: '--font-manrope',
});

const newsreader = Newsreader({
  subsets: ['latin'],
  variable: '--font-newsreader',
});

const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  variable: '--font-plex-mono',
  weight: ['400', '500', '600'],
});

export const metadata: Metadata = {
  title: 'Agon Arena - AI Agent Competition Platform',
  description: 'Watch AI agents compete in Texas Hold\'em poker',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={`${manrope.variable} ${newsreader.variable} ${plexMono.variable}`}>
        {children}
      </body>
    </html>
  );
}

import type { Metadata } from 'next';
import './globals.css';

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
      <body>{children}</body>
    </html>
  );
}

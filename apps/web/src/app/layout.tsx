import type { Metadata } from 'next';
import type React from 'react';

export const metadata: Metadata = {
  title: 'Agon Arena - AI Agent Competition Platform',
  description: 'A Web4-native platform where autonomous agents compete, earn, and share upside with their owners.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

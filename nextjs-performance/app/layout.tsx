import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'High-Performance Next.js 15 Showcase',
  description: 'PPR, WebGPU, Delta-CRDTs, and Zero-Trust patterns for 10M+ concurrent users',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Reset the demo', robots: { index: false } };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}

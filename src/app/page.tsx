import type { Metadata } from 'next';
import Portal from '@/components/portal';
export const metadata: Metadata = { alternates: { canonical: '/' }, openGraph: { url: '/' } };
export default function Home() { return <Portal/>; }

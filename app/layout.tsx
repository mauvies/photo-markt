import type { Metadata } from 'next';
import { Geist_Mono, Inter, Inter_Tight, Syne } from 'next/font/google';
import { headers } from 'next/headers';
import './globals.css';
import { getSiteUrl } from '@/lib/get-site-url';

const inter = Inter({
  variable: '--font-inter',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

const interTight = Inter_Tight({
  variable: '--font-inter-tight',
  subsets: ['latin'],
});

const syne = Syne({
  variable: '--font-syne',
  subsets: ['latin'],
  weight: ['700', '800'],
});

export const metadata: Metadata = {
  // Absolute base for all relative OG/canonical URLs resolved by Next.js
  metadataBase: new URL(getSiteUrl()),
  title: {
    default: 'Picdemi — Find Yourself in Every Photo',
    template: '%s | Picdemi',
  },
  description:
    'Browse sports event photos from marathons, cycling races, triathlons, and more. Find yourself in high-resolution photos shot by professional event photographers.',
  icons: {
    icon: '/favicon.ico',
  },
  openGraph: {
    siteName: 'Picdemi',
    type: 'website',
    locale: 'en_US',
  },
  twitter: {
    card: 'summary_large_image',
  },
  // Prevent indexing of dashboard/auth pages at the root level fallback;
  // individual pages override this where needed.
  robots: {
    index: true,
    follow: true,
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const lang = (await headers()).get('x-lang') ?? 'es';

  return (
    <html
      lang={lang}
      className={`${inter.variable} ${geistMono.variable} ${interTight.variable} ${syne.variable}`}
    >
      <body className="antialiased">{children}</body>
    </html>
  );
}

import type { Metadata } from 'next';
import { Geist_Mono, Inter, Inter_Tight, Syne } from 'next/font/google';
import './globals.css';
import { getSiteUrl } from '@/lib/get-site-url';
import { defaultLocale } from '@/lib/i18n/config';

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
    default: 'Photo Markt — Find Yourself in Every Photo',
    template: '%s | Photo Markt',
  },
  description:
    'Browse sports event photos from marathons, cycling races, triathlons, and more. Find yourself in high-resolution photos shot by professional event photographers.',
  icons: {
    icon: [
      { url: '/favicon.ico' },
      { url: '/favicon/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
      { url: '/favicon/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
    ],
    apple: '/favicon/apple-touch-icon.png',
  },
  manifest: '/manifest.json',
  openGraph: {
    siteName: 'Photo Markt',
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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // `lang` is a static default. Reading the real locale from headers() here
  // would opt every page in the app into dynamic rendering; instead the
  // [lang] layout applies the correct value client-side via <HtmlLangSync>.
  return (
    <html
      lang={defaultLocale}
      className={`${inter.variable} ${geistMono.variable} ${interTight.variable} ${syne.variable}`}
    >
      <body className="antialiased">{children}</body>
    </html>
  );
}

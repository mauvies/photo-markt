import type { Metadata, Viewport } from 'next';
import { Bricolage_Grotesque, Inter } from 'next/font/google';
import './globals.css';
import { env } from '@/env.mjs';
import { getSiteUrl } from '@/lib/get-site-url';
import { defaultLocale } from '@/lib/i18n/config';

// Only the two families the UI actually renders: Inter (body) and Bricolage
// Grotesque (headings — a design experiment, T-181, replacing Inter Tight).
// Net-zero preloads (T-123): Bricolage *replaces* Inter Tight, it is not added
// as a third family — each extra family here is a render-critical preload on
// every page. Syne was mapped to --font-wordmark but nothing used it; Geist
// Mono styled three incidental spots now covered by the system mono stack.
const inter = Inter({
  variable: '--font-inter',
  subsets: ['latin'],
});

const bricolage = Bricolage_Grotesque({
  variable: '--font-bricolage',
  subsets: ['latin'],
});

// Explicit viewport. `viewportFit: 'cover'` is the part that matters: without
// it iOS resolves every `env(safe-area-inset-*)` to 0, so the fixed bottom nav
// and cart bars (which pad with `env(safe-area-inset-bottom)`) don't reserve
// the home-indicator space and sit slightly off vertically. `initialScale: 1`
// + `width: device-width` keep the page at 1:1 on load. User zoom is left
// enabled on purpose (no `maximumScale` / `userScalable`) for accessibility. (T-043)
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export const metadata: Metadata = {
  // Absolute base for all relative OG/canonical URLs resolved by Next.js
  metadataBase: new URL(getSiteUrl()),
  title: {
    default: 'Photo Markt — Find Yourself in Every Photo',
    template: '%s | Photo Markt',
  },
  description: 'Find yourself in high-resolution photos shot by professional event photographers.',
  icons: {
    icon: [
      { url: '/favicon.ico' },
      { url: '/favicon/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
      { url: '/favicon/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
    ],
    apple: '/favicon/apple-touch-icon.png',
  },
  // No `manifest` key on purpose: src/app/manifest.ts is a file convention, so
  // Next injects <link rel="manifest" href="/manifest.webmanifest"> on its own.
  // Setting it here would only re-point the link at a path we no longer serve. (T-201)
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
    <html lang={defaultLocale} className={`${inter.variable} ${bricolage.variable}`}>
      <body className="antialiased">
        {/* Event covers and purchased photos load from Supabase Storage signed
            URLs (a different origin in production). React hoists this <link>
            into <head> during SSR, so the browser warms DNS+TLS while the HTML
            still parses — shaving the handshake off the first (often LCP)
            image. A literal tag, not react-dom preconnect(): from a Server
            Component the hint only reaches the flight payload (client-side,
            post-JS — too late). (T-123) */}
        <link rel="preconnect" href={new URL(env.NEXT_PUBLIC_SUPABASE_URL).origin} />
        {children}
      </body>
    </html>
  );
}

import type { MetadataRoute } from 'next';

// Lives at the root of `app/` (next to robots.ts and sitemap.ts), NOT inside
// the [lang] segment: Next serves it at /manifest.webmanifest, outside the
// locale prefix, and injects the <link rel="manifest"> itself — which is why
// `metadata.manifest` must stay absent from src/app/layout.tsx. (T-201)
//
// Not localized (name/description are English for both locales), same as the
// public/manifest.json it replaces.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Photo Markt',
    short_name: 'Photo Markt',
    description: 'Find yourself in every photo',
    start_url: '/?source=pwa',
    scope: '/',
    display: 'standalone',
    // Carried over from the static JSON on purpose: dropping it would change
    // how the installed PWA opens on phones, which this refactor must not do.
    orientation: 'portrait',
    background_color: '#ffffff',
    theme_color: '#ffffff',
    icons: [
      {
        src: '/favicon/android-chrome-192x192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/favicon/android-chrome-512x512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}

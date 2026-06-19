import type { Metadata } from 'next';
import { PhotographerPublicProfile } from '@/components/photographer-public-profile';
import { createClient } from '@/database/server';
import { getSiteUrl } from '@/lib/get-site-url';
import type { Locale } from '@/lib/i18n/config';
import { locales } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/get-dictionary';
import { getPhotographerProfileAction, getTopPhotographersAction } from './actions';

type Params = Promise<{ lang: string; slug: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug, lang } = await params;
  const profile = await getPhotographerProfileAction(slug);

  if (!profile) return {};

  const name = profile.display_name ?? profile.username;
  const siteUrl = getSiteUrl();
  const canonical = `${siteUrl}/${lang}/photographer/${slug}`;

  const location =
    profile.city && profile.country_code
      ? `${profile.city}, ${profile.country_code}`
      : (profile.city ?? null);
  const description = location
    ? `Event photographer based in ${location}. Browse events and photos by ${name} on Photo Markt.`
    : `Browse all events and photos by ${name} on Photo Markt.`;

  return {
    title: `${name} — Event Photographer`,
    description,
    openGraph: {
      title: `${name} — Event Photographer | Photo Markt`,
      description,
      images: profile.avatar_url
        ? [{ url: profile.avatar_url, width: 400, height: 400, alt: name }]
        : [],
      url: canonical,
      type: 'profile',
    },
    alternates: {
      canonical,
    },
  };
}

export async function generateStaticParams() {
  const top = await getTopPhotographersAction();
  return locales.flatMap((lang) => top.map((p) => ({ lang, slug: p.slug })));
}

export default async function PhotographerProfilePage({ params }: { params: Params }) {
  const { lang, slug } = await params;
  const dict = await getDictionary(lang as Locale);

  // Owner check — when the viewer is the photographer themselves, the
  // shared component renders the Edit + Copy CTAs. The action is cached
  // so this fetch is essentially free (the shared component will hit the
  // same cache entry below).
  const profile = await getPhotographerProfileAction(slug);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const isOwner = Boolean(user && profile && user.id === profile.id);

  return (
    <div className="flex min-h-screen flex-col">
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-10 sm:py-14 md:py-16">
        <PhotographerPublicProfile slug={slug} lang={lang} dict={dict} isOwner={isOwner} />
      </main>
    </div>
  );
}

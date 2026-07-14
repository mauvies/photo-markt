import {
  ArrowRight,
  Camera,
  Download,
  Lock,
  Rocket,
  ShieldCheck,
  Sparkles,
  Wallet,
} from 'lucide-react';
import Link from 'next/link';
import { PhotographersFaq } from '@/components/photographers-faq';
import { PricingSection } from '@/components/pricing-section';
import { Button } from '@/components/ui/button';
import { getUser } from '@/database/server';
import type { Locale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/get-dictionary';
import { localizedPath } from '@/lib/i18n/localized-path';

export default async function PhotographersPage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  const [dict, user] = await Promise.all([getDictionary(lang as Locale), getUser()]);
  const p = dict.photographersPage;
  const signupHref = localizedPath(lang, '/signup');
  const loginHref = localizedPath(lang, '/login');

  // Genuine trust signals only (T-120) — no fabricated social proof or
  // invented traction numbers. Claims match CLAUDE.md §Payments.
  const trustSignals = [
    { Icon: ShieldCheck, title: p.trustStripeTitle, body: p.trustStripeBody },
    { Icon: Rocket, title: p.trustFreeTitle, body: p.trustFreeBody },
    { Icon: Wallet, title: p.trustEconomicsTitle, body: p.trustEconomicsBody },
    { Icon: Lock, title: p.trustPrivacyTitle, body: p.trustPrivacyBody },
  ];

  return (
    <div className="flex min-h-svh flex-col">
      {/* Hero */}
      <section className="relative flex flex-col items-center justify-center overflow-hidden bg-linear-to-br from-background via-background to-primary/5 py-20 sm:py-28">
        <div className="absolute inset-0 -z-10">
          <div className="absolute left-1/4 top-1/4 h-80 w-80 rounded-full bg-primary/10 blur-3xl" />
          <div className="absolute bottom-1/4 right-1/4 h-80 w-80 rounded-full bg-primary/5 blur-3xl" />
        </div>

        <div className="relative z-10 max-w-4xl space-y-6 px-4 text-center sm:px-6 lg:px-8">
          <h1 className="text-balance text-4xl font-bold sm:text-6xl">
            {p.heroHeadline1}
            <span className="block bg-linear-to-r from-primary via-primary/80 to-primary/60 bg-clip-text pb-2 text-transparent">
              {p.heroHeadline2}
            </span>
          </h1>
          <p className="mx-auto max-w-2xl text-lg leading-normal text-muted-foreground sm:text-xl">
            {p.heroSubtitle}
          </p>
          <div className="flex justify-center">
            <Link href={signupHref}>
              <Button size="lg" className="group px-8 text-base">
                {p.heroCta}
                <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section id="how-it-works" className="scroll-mt-20 bg-background py-24">
        <div className="mx-auto max-w-[1400px] px-4 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              {dict.home.howItWorksLabel}
            </p>
            <h2 className="mt-4 text-4xl font-bold tracking-tight sm:text-5xl">
              {dict.home.howItWorksHeadline}
            </h2>
            <p className="mt-5 text-base leading-relaxed text-muted-foreground sm:text-lg">
              {dict.home.howItWorksSubtitle}
            </p>
          </div>

          <div className="mx-auto mt-16 max-w-6xl">
            <div className="grid gap-8 sm:grid-cols-3">
              {/* Pillar 1 */}
              <div className="group flex flex-col gap-5 rounded-2xl border bg-card p-8 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl border bg-muted/50 transition-colors group-hover:bg-primary/10">
                  <Camera className="h-5 w-5 text-foreground/70 group-hover:text-primary" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold tracking-tight">{dict.home.pillar1Title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    {dict.home.pillar1Body}
                  </p>
                </div>
              </div>

              {/* Pillar 2 */}
              <div className="group flex flex-col gap-5 rounded-2xl border bg-card p-8 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl border bg-muted/50 transition-colors group-hover:bg-primary/10">
                  <Sparkles className="h-5 w-5 text-foreground/70 group-hover:text-primary" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold tracking-tight">{dict.home.pillar2Title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    {dict.home.pillar2Body}
                  </p>
                </div>
              </div>

              {/* Pillar 3 */}
              <div className="group flex flex-col gap-5 rounded-2xl border bg-card p-8 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl border bg-muted/50 transition-colors group-hover:bg-primary/10">
                  <Download className="h-5 w-5 text-foreground/70 group-hover:text-primary" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold tracking-tight">{dict.home.pillar3Title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    {dict.home.pillar3Body}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Trust signals */}
      <section className="border-y bg-muted/30 py-20 sm:py-24">
        <div className="mx-auto max-w-[1400px] px-4 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              {p.trustLabel}
            </p>
            <h2 className="mt-4 text-3xl font-semibold sm:text-4xl">{p.trustHeadline}</h2>
          </div>
          <div className="mx-auto mt-14 grid max-w-5xl gap-10 sm:grid-cols-2 lg:grid-cols-4">
            {trustSignals.map(({ Icon, title, body }) => (
              <div key={title} className="flex flex-col items-center gap-3 text-center">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl border bg-background">
                  <Icon className="h-5 w-5 text-primary" aria-hidden="true" />
                </div>
                <h3 className="text-base font-semibold tracking-tight">{title}</h3>
                <p className="text-sm leading-relaxed text-muted-foreground">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <div id="pricing" className="scroll-mt-20">
        <PricingSection isAuthenticated={!!user} t={dict.pricingSection} />
      </div>

      {/* FAQ */}
      <PhotographersFaq title={p.faqTitle} items={p.faqItems} />

      {/* Final CTA */}
      <section className="bg-linear-to-br from-primary/10 via-primary/5 to-background py-20 sm:py-24">
        <div className="mx-auto max-w-[1400px] px-4 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-3xl text-center">
            <h2 className="text-3xl font-semibold sm:text-4xl">{dict.home.ctaHeadline}</h2>
            <p className="mt-4 text-base text-muted-foreground sm:text-lg">
              {dict.home.ctaSubtitle}
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-4 sm:flex-row">
              <Link href={signupHref}>
                <Button size="lg" className="group px-8 text-base">
                  {dict.home.ctaCreateAccount}
                  <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
                </Button>
              </Link>
              <Link href={loginHref}>
                <Button size="lg" variant="outline" className="px-8 text-base">
                  {dict.home.ctaHaveAccount}
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

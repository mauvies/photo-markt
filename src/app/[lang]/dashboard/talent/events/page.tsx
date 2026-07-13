import { localizedRedirect } from '@/lib/i18n/redirect';

// T-118: `/` is the unified talent home/explore page now. This dedicated
// explore route is kept only so old links/bookmarks land somewhere real —
// `explore-page-content.tsx`/`actions.ts` in this directory are still used
// by `/` and `/events`. `/dashboard/talent/events/[id]` (event detail) is
// untouched.
//
// A *bare* visit lands on the unified home (`/`). A *filtered* link (old
// bookmark/share with `?where=…&activity=…`) forwards to `/events` with its
// query string preserved — `/events` runs the same `ExplorePageContent` and
// reads the same params, so the filters survive instead of being silently
// dropped (`/` is statically prerendered and ignores search params).
export default async function TalentExplorePage({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { lang } = await params;
  const sp = await searchParams;

  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(sp)) {
    if (Array.isArray(value)) {
      for (const v of value) query.append(key, v);
    } else if (value !== undefined) {
      query.append(key, value);
    }
  }

  const qs = query.toString();
  localizedRedirect(lang, qs ? `/events?${qs}` : '/');
}

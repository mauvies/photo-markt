import { redirect } from 'next/navigation';

export default async function RootPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>;
}) {
  const params = await searchParams;
  if (params.code) {
    const qs = new URLSearchParams(params).toString();
    redirect(`/auth/callback?${qs}`);
  }
  redirect('/es');
}

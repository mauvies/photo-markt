import { requireUser } from '@/lib/auth/require-user';

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
  params: Promise<{ lang: string }>;
}) {
  // Reads through the request-cached `getUser()`, the same snapshot the child
  // layouts see — a second, independent auth round-trip here could disagree
  // with theirs and let a child crash on a request this guard let through.
  await requireUser();

  return <>{children}</>;
}

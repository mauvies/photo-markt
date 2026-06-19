import { NextResponse } from 'next/server';
import { switchRole } from '@/app/[lang]/actions/roles';
import type { RoleSlug } from '@/lib/roles';

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const role = body?.role as string | undefined;

  if (role !== 'photographer' && role !== 'talent') {
    return NextResponse.json({ ok: false, error: 'invalid_role' }, { status: 400 });
  }

  await switchRole(role as RoleSlug);

  return NextResponse.json({ ok: true, activeRole: role });
}

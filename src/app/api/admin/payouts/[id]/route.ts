/**
 * Admin API endpoint for managing payouts
 * POST /api/admin/payouts/[id] - Update payout status
 */

import { NextResponse } from 'next/server';
import type { PayoutStatus } from '@/database/queries/payouts';
import { updatePayoutStatus } from '@/database/queries/payouts';
import { createClient } from '@/database/server';
import { supabaseAdmin } from '@/database/supabase-admin';
import { rateLimit, retryAfterSeconds } from '@/lib/rate-limit';

const VALID_STATUSES: PayoutStatus[] = ['pending', 'approved', 'paid', 'cancelled'];

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Per-user rate limit — admin endpoint with a sequential id parameter is
  // a natural enumeration target. 30/min/admin is well above any legitimate
  // workflow (manual payout review).
  const rl = await rateLimit({
    key: `admin-payout:${user.id}`,
    limit: 30,
    windowSec: 60,
  });
  if (!rl.ok) {
    return NextResponse.json(
      { error: 'Too Many Requests' },
      { status: 429, headers: { 'Retry-After': String(retryAfterSeconds(rl)) } },
    );
  }

  // admin_users has no RLS policies — only service_role can read it, so we
  // can't accidentally expose the admin list via PostgREST.
  const { data: admin } = await supabaseAdmin
    .from('admin_users')
    .select('user_id')
    .eq('user_id', user.id)
    .maybeSingle();

  if (!admin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const { id } = await params;
    const body = await request.json();
    const { status, admin_notes } = body;

    if (!status || !VALID_STATUSES.includes(status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
    }

    const payout = await updatePayoutStatus(supabaseAdmin, id, status as PayoutStatus, admin_notes);

    return NextResponse.json({ payout });
  } catch (error) {
    console.error('Error updating payout:', error);
    return NextResponse.json({ error: 'Failed to update payout' }, { status: 500 });
  }
}

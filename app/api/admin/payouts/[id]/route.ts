/**
 * Admin API endpoint for managing payouts
 * POST /api/admin/payouts/[id] - Update payout status
 */

import { NextResponse } from 'next/server';
import type { PayoutStatus } from '@/database/queries/payouts';
import { updatePayoutStatus } from '@/database/queries/payouts';
import { createClient } from '@/database/server';
import { supabaseAdmin } from '@/database/supabase-admin';

const VALID_STATUSES: PayoutStatus[] = ['pending', 'approved', 'paid', 'cancelled'];

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Service-role lookup so an attacker can't game RLS by being the row's own
  // owner — is_admin is only writable via direct DB access.
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .maybeSingle();

  if (!profile?.is_admin) {
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

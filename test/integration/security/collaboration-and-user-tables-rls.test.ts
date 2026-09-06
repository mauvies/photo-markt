/**
 * RLS for the remaining policy-protected tables (T-227): `event_photographers`,
 * `talent_photo_tags`, `feedback`, `roadmap_votes`, `download_tokens`,
 * `user_role_memberships`, `user_roles`.
 *
 * Two of these carry TWO owners, which is where a plausible-looking policy goes
 * wrong most easily:
 *
 *   * `event_photographers` — the event owner (via `events.user_id`) invites, and
 *     the invited photographer may only answer. The invitee's UPDATE policy is
 *     narrowed on BOTH sides (`status = 'pending'` in USING, `accepted|declined`
 *     in WITH CHECK), so a contributor cannot re-open a settled invitation or
 *     invent a status.
 *
 *   * `talent_photo_tags` — the tagged talent reads, and the PHOTOGRAPHER (via
 *     `photos.user_id`) is the only one who may write. Talent cannot tag
 *     themselves into someone's photo.
 *
 * `download_tokens` is the odd one: a SELECT policy for the claimant and NO write
 *  policy at all — the token is minted by the webhook and claimed server-side.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  createAnonClient,
  createServiceClient,
  createTestEvent,
  createTestPhoto,
  createTestUser,
  resetDatabase,
  signInAs,
} from '../../helpers/supabase-test-client';

describe('event_photographers RLS — two owners, one of them narrowed', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  async function seedInvitation(ownerId: string, photographerId: string, eventId: string) {
    const { data, error } = await createServiceClient()
      .from('event_photographers')
      .insert({
        event_id: eventId,
        photographer_id: photographerId,
        invited_by: ownerId,
        status: 'pending',
      })
      .select('id')
      .single();
    if (error || !data) throw new Error(`invitation seed failed: ${error?.message}`);
    return data as { id: string };
  }

  it('an unrelated photographer sees nothing, and anon sees nothing', async () => {
    const owner = await createTestUser('PHOTOGRAPHER');
    const invitee = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(owner.id);
    await seedInvitation(owner.id, invitee.id, event.id);
    const stranger = await createTestUser('PHOTOGRAPHER');

    const { data: asStranger } = await (await signInAs(stranger.email))
      .from('event_photographers')
      .select('*');
    const { data: asAnon } = await createAnonClient().from('event_photographers').select('id');

    expect(asStranger ?? []).toEqual([]);
    expect(asAnon ?? []).toEqual([]);
  });

  it('both the event owner and the invitee can read the invitation', async () => {
    // Positive control for the two SELECT policies.
    const owner = await createTestUser('PHOTOGRAPHER');
    const invitee = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(owner.id);
    await seedInvitation(owner.id, invitee.id, event.id);

    const { data: asOwner } = await (await signInAs(owner.email))
      .from('event_photographers')
      .select('id');
    const { data: asInvitee } = await (await signInAs(invitee.email))
      .from('event_photographers')
      .select('id');

    expect(asOwner).toHaveLength(1);
    expect(asInvitee).toHaveLength(1);
  });

  it('a photographer cannot invite themselves to somebody else event', async () => {
    // The INSERT policy requires the caller to own the event AND to be
    // `invited_by` — self-invitation is how a contributor would grant themselves
    // upload rights on an event they do not own.
    const owner = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(owner.id);
    const outsider = await createTestUser('PHOTOGRAPHER');

    const { error } = await (await signInAs(outsider.email))
      .from('event_photographers')
      .insert({
        event_id: event.id,
        photographer_id: outsider.id,
        invited_by: outsider.id,
        status: 'accepted',
      })
      .select();

    expect(error?.code).toBe('42501');
    const { count } = await createServiceClient()
      .from('event_photographers')
      .select('*', { count: 'exact', head: true });
    expect(count).toBe(0);
  });

  it('the invitee may accept, but may not re-open a settled invitation', async () => {
    const owner = await createTestUser('PHOTOGRAPHER');
    const invitee = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(owner.id);
    const invitation = await seedInvitation(owner.id, invitee.id, event.id);
    const inviteeClient = await signInAs(invitee.email);

    const { data: accepted } = await inviteeClient
      .from('event_photographers')
      .update({ status: 'accepted' })
      .eq('id', invitation.id)
      .select();
    expect(accepted).toHaveLength(1);

    // USING is `status = 'pending'`, so once settled the row is out of reach —
    // a removed contributor cannot re-accept their way back in.
    const { data: reopened } = await inviteeClient
      .from('event_photographers')
      .update({ status: 'pending' })
      .eq('id', invitation.id)
      .select();
    expect(reopened ?? []).toEqual([]);
  });
});

describe('talent_photo_tags RLS — the photographer writes, the talent reads', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('talent cannot tag themselves into a photo', async () => {
    // The INSERT policy is photo-ownership, not self-identification: a tag is the
    // photographer's claim about who is in the frame.
    const photographer = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(photographer.id);
    const photo = await createTestPhoto(event.id, { user_id: photographer.id });
    const talent = await createTestUser('TALENT');

    const { error } = await (await signInAs(talent.email))
      .from('talent_photo_tags')
      .insert({ photo_id: photo.id, talent_user_id: talent.id, tagged_by_user_id: talent.id })
      .select();

    expect(error?.code).toBe('42501');
  });

  it('the photographer can tag, the tagged talent can read, a stranger cannot', async () => {
    const photographer = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(photographer.id);
    const photo = await createTestPhoto(event.id, { user_id: photographer.id });
    const talent = await createTestUser('TALENT');
    const stranger = await createTestUser('TALENT');

    const { error: tagError } = await (await signInAs(photographer.email))
      .from('talent_photo_tags')
      .insert({
        photo_id: photo.id,
        talent_user_id: talent.id,
        tagged_by_user_id: photographer.id,
      })
      .select();
    expect(tagError).toBeNull();

    const { data: asTalent } = await (await signInAs(talent.email))
      .from('talent_photo_tags')
      .select('id');
    const { data: asStranger } = await (await signInAs(stranger.email))
      .from('talent_photo_tags')
      .select('id');

    expect(asTalent).toHaveLength(1);
    expect(asStranger ?? []).toEqual([]);
  });
});

describe('feedback / roadmap_votes RLS — own rows only', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('another user cannot read your feedback, and anon cannot read any', async () => {
    // Feedback is free text a user typed about their own account; it is not
    // public even though nothing about it looks secret.
    const author = await createTestUser('TALENT');
    await createServiceClient().from('feedback').insert({
      user_id: author.id,
      role: 'talent',
      category: 'bug',
      subject: 'private subject',
      description: 'private description',
    });
    const stranger = await createTestUser('TALENT');

    const { data: asStranger } = await (await signInAs(stranger.email))
      .from('feedback')
      .select('*');
    const { data: asAnon } = await createAnonClient().from('feedback').select('id');

    expect(asStranger ?? []).toEqual([]);
    expect(asAnon ?? []).toEqual([]);
  });

  it('a user can file feedback as themselves but not as somebody else', async () => {
    const author = await createTestUser('TALENT');
    const victim = await createTestUser('TALENT');
    const authorClient = await signInAs(author.email);

    const { error: ownError } = await authorClient
      .from('feedback')
      .insert({
        user_id: author.id,
        role: 'talent',
        category: 'bug',
        subject: 'mine',
        description: 'mine',
      })
      .select();
    const { error: forgedError } = await authorClient
      .from('feedback')
      .insert({
        user_id: victim.id,
        role: 'talent',
        category: 'bug',
        subject: 'forged',
        description: 'forged',
      })
      .select();

    expect(ownError).toBeNull();
    expect(forgedError?.code).toBe('42501');
  });

  it('a user cannot vote on the roadmap as somebody else, nor read their votes', async () => {
    const voter = await createTestUser('TALENT');
    await createServiceClient()
      .from('roadmap_votes')
      .insert({ user_id: voter.id, feature_key: 'bulk-download' });
    const stranger = await createTestUser('TALENT');
    const strangerClient = await signInAs(stranger.email);

    const { data: read } = await strangerClient.from('roadmap_votes').select('*');
    const { error: forged } = await strangerClient
      .from('roadmap_votes')
      .insert({ user_id: voter.id, feature_key: 'forged' })
      .select();

    expect(read ?? []).toEqual([]);
    expect(forged?.code).toBe('42501');
  });
});

describe('download_tokens RLS — read when claimed, never written by a user', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  /**
   * A token always hangs off exactly one order (`exactly_one_order`), so the
   * fixture seeds a guest order — the shape the token flow exists for.
   */
  async function seedToken(claimedBy: string | null) {
    const sb = createServiceClient();
    const { data: order, error: orderError } = await sb
      .from('guest_orders')
      .insert({
        guest_email: 'buyer@example.com',
        total_amount_cents: 500,
        status: 'completed',
        stripe_checkout_session_id: `cs_${Math.floor(Date.now() % 1e9)}_seed`,
      })
      .select('id')
      .single();
    if (orderError || !order) throw new Error(`guest order seed failed: ${orderError?.message}`);

    const { data, error } = await sb
      .from('download_tokens')
      .insert({ guest_order_id: order.id, claimed_by_user_id: claimedBy })
      .select('id, token')
      .single();
    if (error || !data) throw new Error(`token seed failed: ${error?.message}`);
    return data as { id: string; token: string };
  }

  it('an unclaimed token is invisible to everyone', async () => {
    // The bearer credential for a guest download. The SELECT policy is
    // `claimed_by_user_id = auth.uid()`, so an unclaimed row matches nobody —
    // guests reach their download through the token in the URL, server-side.
    await seedToken(null);
    const someone = await createTestUser('TALENT');

    const { data: asUser } = await (await signInAs(someone.email))
      .from('download_tokens')
      .select('*');
    const { data: asAnon } = await createAnonClient().from('download_tokens').select('id');

    expect(asUser ?? []).toEqual([]);
    expect(asAnon ?? []).toEqual([]);
  });

  it("a user cannot read someone else's claimed token, but can read their own", async () => {
    const claimant = await createTestUser('TALENT');
    await seedToken(claimant.id);
    const stranger = await createTestUser('TALENT');

    const { data: asClaimant } = await (await signInAs(claimant.email))
      .from('download_tokens')
      .select('id');
    const { data: asStranger } = await (await signInAs(stranger.email))
      .from('download_tokens')
      .select('id');

    expect(asClaimant).toHaveLength(1);
    expect(asStranger ?? []).toEqual([]);
  });

  it('a user cannot mint or claim a token', async () => {
    // There is no INSERT or UPDATE policy: minting one would fabricate a download
    // entitlement, and claiming someone else's would steal a paid delivery.
    const someone = await createTestUser('TALENT');
    const token = await seedToken(null);
    const client = await signInAs(someone.email);

    const { data: mintTargetOrder } = await createServiceClient()
      .from('guest_orders')
      .insert({
        guest_email: 'other@example.com',
        total_amount_cents: 500,
        status: 'completed',
        stripe_checkout_session_id: `cs_${Math.floor(Date.now() % 1e9)}_mint`,
      })
      .select('id')
      .single();
    const { error: mintError } = await client
      .from('download_tokens')
      // A valid row on purpose: if it tripped `exactly_one_order` instead, the
      // test would pass without RLS having refused anything.
      .insert({ guest_order_id: mintTargetOrder?.id, claimed_by_user_id: someone.id })
      .select();
    const { data: claimed } = await client
      .from('download_tokens')
      .update({ claimed_by_user_id: someone.id })
      .eq('id', token.id)
      .select();

    expect(mintError?.code).toBe('42501');
    expect(claimed ?? []).toEqual([]);
    const { data: after } = await createServiceClient()
      .from('download_tokens')
      .select('claimed_by_user_id')
      .eq('id', token.id)
      .single();
    expect(after?.claimed_by_user_id).toBeNull();
  });
});

describe('user_role_memberships / user_roles RLS', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('a user cannot grant a role to someone else, nor read their memberships', async () => {
    const victim = await createTestUser('TALENT');
    const attacker = await createTestUser('TALENT');
    const attackerClient = await signInAs(attacker.email);

    const { error: grantError } = await attackerClient
      .from('user_role_memberships')
      .insert({ user_id: victim.id, role: 'PHOTOGRAPHER' })
      .select();
    const { data: read } = await attackerClient
      .from('user_role_memberships')
      .select('*')
      .eq('user_id', victim.id);

    expect(grantError?.code).toBe('42501');
    expect(read ?? []).toEqual([]);
  });

  it('SELF-GRANT IS ALLOWED, and that is by design — the enum is the bound, not RLS', async () => {
    // `user_role_memberships_self_all` is USING/WITH CHECK `user_id = auth.uid()`,
    // so a user can add a role to themselves directly through PostgREST. That is
    // safe only because the `user_role` enum holds PHOTOGRAPHER and TALENT and
    // nothing else: gaining either is self-service in the product anyway
    // (`enablePhotographerRole` / `enableTalentRole`), and admin is a different
    // table entirely (`admin_users`, service-role only).
    //
    // ⚠️ Pinned here because the safety comes from the ENUM. Adding a privileged
    // value to `user_role` would turn this policy into privilege escalation, and
    // this test is where that should be noticed.
    const user = await createTestUser('TALENT');
    const client = await signInAs(user.email);

    const { error } = await client
      .from('user_role_memberships')
      .insert({ user_id: user.id, role: 'PHOTOGRAPHER' })
      .select();
    expect(error).toBeNull();

    const { error: bogusRole } = await client
      .from('user_role_memberships')
      .insert({ user_id: user.id, role: 'ADMIN' })
      .select();
    // Rejected by the enum, not by RLS — which is exactly the point above.
    expect(bogusRole).not.toBeNull();
  });

  it('the dead user_roles table is still locked to its owner', async () => {
    // `user_roles` is empty and no code reads it (a prune candidate). Until it is
    // dropped it still has policies, so it still gets asserted: a dead table with
    // live policies is precisely the thing nobody re-reads.
    const owner = await createTestUser('TALENT');
    await createServiceClient().from('user_roles').insert({ user_id: owner.id, role: 'TALENT' });
    const stranger = await createTestUser('TALENT');

    const { data } = await (await signInAs(stranger.email)).from('user_roles').select('*');
    expect(data ?? []).toEqual([]);
  });
});

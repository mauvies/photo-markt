import { beforeEach, describe, expect, it } from 'vitest';
import {
  getCurrentPlan,
  getPhotographerPlanIds,
  getSubscription,
  getSubscriptionByStripeId,
} from '@/database/queries/subscriptions';
import {
  createServiceClient,
  createTestUser,
  resetDatabase,
} from '../../helpers/supabase-test-client';

async function seedSubscription(
  userId: string,
  overrides?: Partial<{
    stripe_customer_id: string;
    stripe_subscription_id: string;
    plan_id: 'free' | 'amateur' | 'pro';
    status: string;
  }>,
) {
  const sb = createServiceClient();
  const { error } = await sb.from('subscriptions').insert({
    user_id: userId,
    stripe_customer_id: overrides?.stripe_customer_id ?? `cus_${userId.slice(0, 8)}`,
    stripe_subscription_id: overrides?.stripe_subscription_id ?? null,
    plan_id: overrides?.plan_id ?? 'pro',
    status: overrides?.status ?? 'active',
  });
  if (error) throw new Error(`seedSubscription: ${error.message}`);
}

describe('database/queries/subscriptions', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  describe('getSubscription', () => {
    it('returns the row when one exists', async () => {
      const photographer = await createTestUser('PHOTOGRAPHER');
      await seedSubscription(photographer.id, { plan_id: 'pro' });
      const sub = await getSubscription(createServiceClient(), photographer.id);
      expect(sub?.plan_id).toBe('pro');
      expect(sub?.status).toBe('active');
    });

    it('returns null when the user has no subscription', async () => {
      const photographer = await createTestUser('PHOTOGRAPHER');
      const sub = await getSubscription(createServiceClient(), photographer.id);
      expect(sub).toBeNull();
    });
  });

  describe('getCurrentPlan', () => {
    it('returns the Pro plan when subscription is active + plan_id=pro', async () => {
      const photographer = await createTestUser('PHOTOGRAPHER');
      await seedSubscription(photographer.id, { plan_id: 'pro', status: 'active' });
      const plan = await getCurrentPlan(createServiceClient(), photographer.id);
      // `getCurrentPlan` returns the Plan object from PLANS, not the raw row.
      expect(plan.id).toBe('pro');
    });

    it('falls back to Free when subscription is canceled (non-active status)', async () => {
      const photographer = await createTestUser('PHOTOGRAPHER');
      await seedSubscription(photographer.id, { plan_id: 'pro', status: 'canceled' });
      const plan = await getCurrentPlan(createServiceClient(), photographer.id);
      expect(plan.id).toBe('free');
    });

    it('falls back to Free for users without a subscription row', async () => {
      const photographer = await createTestUser('PHOTOGRAPHER');
      expect((await getCurrentPlan(createServiceClient(), photographer.id)).id).toBe('free');
    });

    it('falls back to Free for null / undefined userId (anonymous callers)', async () => {
      const sb = createServiceClient();
      expect((await getCurrentPlan(sb, null)).id).toBe('free');
      expect((await getCurrentPlan(sb, undefined)).id).toBe('free');
    });
  });

  describe('getPhotographerPlanIds', () => {
    it('returns a map of userId → planId for active subs only', async () => {
      const a = await createTestUser('PHOTOGRAPHER');
      const b = await createTestUser('PHOTOGRAPHER');
      const c = await createTestUser('PHOTOGRAPHER');
      await seedSubscription(a.id, { plan_id: 'pro', status: 'active' });
      await seedSubscription(b.id, { plan_id: 'amateur', status: 'trialing' });
      await seedSubscription(c.id, { plan_id: 'pro', status: 'canceled' });

      const map = await getPhotographerPlanIds(createServiceClient(), [a.id, b.id, c.id]);
      expect(map.get(a.id)).toBe('pro');
      expect(map.get(b.id)).toBe('amateur');
      // c is canceled → not in the map
      expect(map.has(c.id)).toBe(false);
    });

    it('returns an empty map for an empty input list without hitting the DB', async () => {
      const map = await getPhotographerPlanIds(createServiceClient(), []);
      expect(map.size).toBe(0);
    });
  });

  describe('getSubscriptionByStripeId', () => {
    it('finds the sub by stripe_subscription_id', async () => {
      const photographer = await createTestUser('PHOTOGRAPHER');
      await seedSubscription(photographer.id, { stripe_subscription_id: 'sub_lookup' });
      const sub = await getSubscriptionByStripeId(createServiceClient(), 'sub_lookup');
      expect(sub?.user_id).toBe(photographer.id);
    });

    it('returns null on miss', async () => {
      expect(
        await getSubscriptionByStripeId(createServiceClient(), 'sub_does_not_exist'),
      ).toBeNull();
    });
  });
});

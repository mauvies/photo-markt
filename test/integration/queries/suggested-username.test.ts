/**
 * Integration tests for `getSuggestedUsername` in `database/queries/profiles.ts`.
 *
 * The onboarding form pre-fills the username field with this value, so it must
 * always be a valid, currently-available username: derived from the display
 * name when usable, otherwise from the email local-part, with a numeric suffix
 * appended when the base is taken.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { getSuggestedUsername } from '@/database/queries/profiles';
import { isValidUsername } from '@/lib/username';
import {
  createServiceClient,
  createTestUser,
  resetDatabase,
} from '../../helpers/supabase-test-client';

describe('getSuggestedUsername', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('derives a normalized suggestion from the display name', async () => {
    const sb = createServiceClient();
    const suggestion = await getSuggestedUsername(sb, {
      fullName: 'Mauricio Viera',
      email: 'whatever@photomarkt.test',
    });
    expect(suggestion).toBe('mauricioviera');
    expect(isValidUsername(suggestion)).toBe(true);
  });

  it('falls back to the email local-part when no usable name exists', async () => {
    const sb = createServiceClient();
    const suggestion = await getSuggestedUsername(sb, {
      fullName: null,
      email: 'john.doe@photomarkt.test',
    });
    // Dots map to underscores in the email path.
    expect(suggestion).toBe('john_doe');
    expect(isValidUsername(suggestion)).toBe(true);
  });

  it('falls back to email when the name normalizes too short', async () => {
    const sb = createServiceClient();
    const suggestion = await getSuggestedUsername(sb, {
      fullName: 'Jo', // normalizes to "jo" (< 3 chars) → not usable as a name base
      email: 'surfer@photomarkt.test',
    });
    expect(suggestion).toBe('surfer');
  });

  it('appends a numeric suffix when the base is already taken', async () => {
    const sb = createServiceClient();
    // Occupy the base name with another user.
    await createTestUser('TALENT', { username: 'mauricioviera' });

    const suggestion = await getSuggestedUsername(sb, {
      fullName: 'Mauricio Viera',
      email: 'whatever@photomarkt.test',
    });
    expect(suggestion).toBe('mauricioviera_1');
    expect(isValidUsername(suggestion)).toBe(true);

    // And it keeps incrementing when several are taken.
    await createTestUser('TALENT', { username: 'mauricioviera_1' });
    const next = await getSuggestedUsername(sb, {
      fullName: 'Mauricio Viera',
      email: 'whatever@photomarkt.test',
    });
    expect(next).toBe('mauricioviera_2');
  });
});

import { describe, expect, it } from 'vitest';
import { ROLES, resolveRoleSwitch, roleEnumToSlug, roleSlugToEnum, USER_ROLES } from '@/lib/roles';

describe('ROLES constants', () => {
  it('exposes the two role names verbatim', () => {
    // Stringly-typed FKs in older code compare against these literals — they
    // must match. A snapshot-style assertion catches accidental renames.
    expect(ROLES.PHOTOGRAPHER).toBe('PHOTOGRAPHER');
    expect(ROLES.TALENT).toBe('TALENT');
  });

  it('USER_ROLES enumerates both roles', () => {
    expect(USER_ROLES).toEqual(['PHOTOGRAPHER', 'TALENT']);
  });
});

describe('roleSlugToEnum / roleEnumToSlug', () => {
  it('round-trips photographer', () => {
    expect(roleSlugToEnum('photographer')).toBe(ROLES.PHOTOGRAPHER);
    expect(roleEnumToSlug(ROLES.PHOTOGRAPHER)).toBe('photographer');
  });

  it('round-trips talent', () => {
    expect(roleSlugToEnum('talent')).toBe(ROLES.TALENT);
    expect(roleEnumToSlug(ROLES.TALENT)).toBe('talent');
  });
});

describe('resolveRoleSwitch', () => {
  it('signals talent-enable required when switching to TALENT with no existing talent role', () => {
    expect(resolveRoleSwitch([ROLES.PHOTOGRAPHER], ROLES.TALENT)).toEqual({
      needsEnableTalent: true,
    });
  });

  it('no-op when switching to TALENT and TALENT already enabled', () => {
    expect(resolveRoleSwitch([ROLES.PHOTOGRAPHER, ROLES.TALENT], ROLES.TALENT)).toEqual({
      needsEnableTalent: false,
    });
  });

  it('no-op when switching to PHOTOGRAPHER (talent enable never required)', () => {
    expect(resolveRoleSwitch([ROLES.PHOTOGRAPHER], ROLES.PHOTOGRAPHER)).toEqual({
      needsEnableTalent: false,
    });
    expect(resolveRoleSwitch([ROLES.PHOTOGRAPHER, ROLES.TALENT], ROLES.PHOTOGRAPHER)).toEqual({
      needsEnableTalent: false,
    });
  });

  it('signals enable when existing roles list is empty', () => {
    // Empty existing list comes from fresh signups before any role row.
    expect(resolveRoleSwitch([], ROLES.TALENT)).toEqual({ needsEnableTalent: true });
  });
});

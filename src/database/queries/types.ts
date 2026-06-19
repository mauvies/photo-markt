/**
 * Shared types and utilities for database queries
 */

import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Type for Supabase client in server-side queries. Use the package type so both
 * the cookie-based server client and the service-role admin client are accepted
 * (avoids duplicate-package version mismatches).
 */
export type SupabaseServerClient = SupabaseClient;

/**
 * Helper function to extract error message safely
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'object' && error !== null && 'message' in error) {
    return String(error.message);
  }
  return String(error);
}

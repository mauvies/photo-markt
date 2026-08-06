/**
 * Extract the Supabase project ref from a project URL (T-231).
 *
 * `https://abcdefghijklmnop.supabase.co` → `abcdefghijklmnop`. Local stacks
 * (`http://127.0.0.1:54321`) have no ref, so the host is returned as-is —
 * distinguishing "local" from "some hosted project" is exactly the point.
 *
 * Why this exists: the worst production incident this pipeline has is a photo
 * uploaded to one Supabase project and processed by a worker pointed at
 * another. The symptom is `Object not found` on an object that demonstrably
 * exists, and the only way to tell it apart from a genuinely missing object is
 * to know which project the worker read. Stamping the ref into the error
 * message turns that diagnosis into one glance at the Inngest run (T-071 hit
 * this locally; T-231 hit it in production).
 *
 * Pure string handling — never throws, never touches the network.
 */
export function getSupabaseProjectRef(url: string | null | undefined): string {
  if (!url) return 'unknown';
  try {
    const { hostname } = new URL(url);
    const [first, ...rest] = hostname.split('.');
    // Hosted projects are `<ref>.supabase.co` / `<ref>.supabase.in`; anything
    // else (localhost, a custom domain) has no ref to extract.
    return rest.join('.').startsWith('supabase.') && first ? first : hostname;
  } catch {
    return 'unknown';
  }
}

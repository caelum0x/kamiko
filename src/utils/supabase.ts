/**
 * supabase.ts — amica's character-sharing backend, made OPTIONAL.
 *
 * This module used to call createClient() at module scope with
 * `process.env.NEXT_PUBLIC_SUPABASE_URL as string`. That cast is a lie whenever the variable is
 * unset, and @supabase/supabase-js does not tolerate it: the constructor throws
 * "supabaseUrl is required" the moment the module is evaluated.
 *
 * Because /import/[sqid] imports it at the top level, that throw happened during `next build`'s page
 * data collection — so THE WHOLE FRONT END FAILED TO BUILD unless Supabase credentials were present.
 * $KAMIKO does not use amica's character-sharing cloud at all, which means the product could not be
 * built for its own deployment because of a feature it does not ship.
 *
 * Now the client is created lazily and only when both variables are actually set. `getSupabase()`
 * returns null instead of throwing, and the pages that use it say the feature is not configured on
 * this deployment rather than dying — which is also the honest thing to show a visitor who followed
 * a share link into a deployment that never had the backend behind it.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
const anonKey = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '').trim();

/** Is amica's character-sharing backend configured on this deployment? */
export const supabaseConfigured: boolean = url !== '' && anonKey !== '';

let client: SupabaseClient | null = null;

/**
 * The Supabase client, or null when this deployment has no character-sharing backend.
 * Never throws: a half-configured deployment reads exactly like an unconfigured one.
 */
export function getSupabase(): SupabaseClient | null {
  if (!supabaseConfigured) return null;
  if (client) return client;
  try {
    client = createClient(url, anonKey);
  } catch {
    client = null; // a malformed URL is "not configured", never a client that fails on every call
  }
  return client;
}

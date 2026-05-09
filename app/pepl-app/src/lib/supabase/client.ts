// =============================================================================
// Browser-side Supabase client for Client Components.
// Uses anon key + cookie-based auth via @supabase/ssr.
// =============================================================================
import { createBrowserClient } from '@supabase/ssr';

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

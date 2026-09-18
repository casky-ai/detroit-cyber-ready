// Service-role Supabase client. Bypasses RLS by design — see
// supabase/migrations/0001_init.sql, which enables RLS on every table with
// zero anon/authenticated policies specifically so this key is the only way
// in. Never import this into anything that runs in the browser.
//
// Lazily constructed so importing this module doesn't crash `next build`
// before env vars are configured (a real Vercel/Marketplace gotcha: module
// top-level client construction runs at build time, when secrets may not
// exist yet).

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient | null = null;

export function getAdminClient(): SupabaseClient {
  if (!client) {
    const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceRoleKey) {
      throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set to use the admin client');
    }
    client = createClient(url, serviceRoleKey, { auth: { persistSession: false } });
  }
  return client;
}

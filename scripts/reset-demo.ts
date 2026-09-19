// Clears every investigation (and, by cascade, its actions) so the board
// opens on "All systems operational" before a presentation. Threat signals
// and the city inventory are left alone: the live KEV feed keeps its
// history and nothing needs reseeding.
//
// Run:  pnpm demo:reset
//
// Uses the service-role key from .env.local over HTTPS (supabase-js), so it
// works on networks that block direct Postgres connections. Deliberately a
// local script rather than an API route: wiping history should never be
// one unauthenticated request away.

import { createClient } from '@supabase/supabase-js';

async function main() {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local');
  }
  const supabase = createClient(url, serviceRoleKey, { auth: { persistSession: false } });

  const { count: before, error: countError } = await supabase
    .from('investigations')
    .select('id', { count: 'exact', head: true });
  if (countError) throw countError;

  // PostgREST refuses an unfiltered delete; this filter matches every row.
  const { error } = await supabase.from('investigations').delete().not('id', 'is', null);
  if (error) throw error;

  const { count: after } = await supabase.from('investigations').select('id', { count: 'exact', head: true });
  console.log(`Removed ${before ?? 0} investigations; ${after ?? 0} remain. The board is back to all clear.`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

// Resets the demo: removes every investigation (actions cascade) so the
// board opens on "All systems operational" again. Signals and the city
// inventory are untouched. Used by the /reset page and the dashboard's
// reset button; `pnpm demo:reset` does the same from a terminal.
//
// GET reports how many investigations would be removed. POST removes them,
// and only for requests from this site's own pages (see isSameOrigin), so a
// link preview, crawler, or another site cannot wipe the board.

import { NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase/admin';
import { isSameOrigin } from '@/lib/same-origin';

// The count must be read on every request, never prerendered at build time.
export const dynamic = 'force-dynamic';

async function countInvestigations() {
  const { count, error } = await getAdminClient().from('investigations').select('id', { count: 'exact', head: true });
  if (error) throw error;
  return count ?? 0;
}

export async function GET() {
  return NextResponse.json({ investigations: await countInvestigations() });
}

export async function POST(req: Request) {
  if (!isSameOrigin(req.headers.get('origin'), req.headers.get('host'))) {
    return NextResponse.json({ error: 'Reset is only available from the Detroit Cyber Ready site.' }, { status: 403 });
  }
  const before = await countInvestigations();
  // PostgREST refuses an unfiltered delete; this filter matches every row.
  const { error } = await getAdminClient().from('investigations').delete().not('id', 'is', null);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ removed: before, remaining: await countInvestigations() });
}

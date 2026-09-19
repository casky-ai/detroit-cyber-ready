// Fetches the CISA Known Exploited Vulnerabilities catalog live from
// cisa.gov and runs every entry through the deterministic matcher against
// Detroit's inventory. Read-only: nothing is stored. Answers "is this real,
// and what about today's CVEs?" in one request.

import { NextResponse } from 'next/server';
import { makeCisaKevSource } from '@dcr/signals/sources/cisa-kev';
import { getDetroitInventory } from '@/lib/detroit';
import { assessKevCatalog } from '@/lib/kev-live';

// Always a live fetch: never prerendered, never cached.
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function GET() {
  const started = Date.now();
  // Every entry ever added, not just recent ones: the whole catalog is the
  // population the matcher is filtering.
  const { signals, gaps } = await makeCisaKevSource().poll(new Date(0));
  const fetchedMs = Date.now() - started;
  if (signals.length === 0) {
    return NextResponse.json(
      { error: `Could not load the CISA KEV catalog. ${gaps.join('; ')}`.trim() },
      { status: 502 }
    );
  }
  const assessment = assessKevCatalog(signals, await getDetroitInventory());
  return NextResponse.json({ fetched_at: new Date().toISOString(), fetched_ms: fetchedMs, ...assessment });
}

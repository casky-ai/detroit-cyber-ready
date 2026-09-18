// The city readiness board's data source: all twelve services from the
// (synthetic, watermarked) Detroit inventory, each annotated with its most
// severe open investigation, if any. A service with no matching signal is
// exactly as informative as one with a signal that didn't match anything —
// both are legitimate "all clear" states, not something to hide.

import { NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase/admin';
import { getDetroitInventory } from '@/lib/detroit';

export async function GET() {
  const { services } = await getDetroitInventory();
  const admin = getAdminClient();

  const { data: investigations, error } = await admin
    .from('investigations')
    .select('id, service_slug, status, priority, risk_score, escalated, created_at')
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const latestByService = new Map<string, (typeof investigations)[number]>();
  for (const inv of investigations ?? []) {
    if (!latestByService.has(inv.service_slug)) {
      latestByService.set(inv.service_slug, inv);
    }
  }

  const result = services.map((service) => ({
    ...service,
    latest_investigation: latestByService.get(service.slug) ?? null,
  }));

  return NextResponse.json({ services: result });
}

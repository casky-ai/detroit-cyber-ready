// Lists past investigations for the history view — proof this has run
// before, not just once, staged for a demo.

import { NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase/admin';
import { getDetroitInventory } from '@/lib/detroit';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const limit = Math.min(Number(url.searchParams.get('limit') ?? 50), 200);

  const admin = getAdminClient();
  const [{ data, error }, { services }] = await Promise.all([
    admin
      .from('investigations')
      .select('id, service_slug, status, priority, risk_score, escalated, created_at, ended_at, signal_id')
      .order('created_at', { ascending: false })
      .limit(limit),
    getDetroitInventory(),
  ]);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const signalIds = [...new Set((data ?? []).map((i) => i.signal_id))];
  const { data: signals } = signalIds.length
    ? await admin.from('signals').select('id, external_id, title').in('id', signalIds)
    : { data: [] };
  const signalById = new Map((signals ?? []).map((s) => [s.id, s]));
  const serviceNameBySlug = new Map(services.map((s) => [s.slug, s.name]));

  const investigations = (data ?? []).map((i) => ({
    ...i,
    service_name: serviceNameBySlug.get(i.service_slug) ?? i.service_slug,
    signal: signalById.get(i.signal_id) ?? null,
  }));

  return NextResponse.json({ investigations });
}

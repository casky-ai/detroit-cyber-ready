// A single investigation with its action plan, service, and the originating
// signal — everything the investigation detail view and the CISO alert
// need in one call.

import { NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase/admin';
import { getDetroitInventory } from '@/lib/detroit';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(_req: Request, { params }: RouteParams) {
  const { id } = await params;
  const admin = getAdminClient();

  const { data: investigation, error } = await admin.from('investigations').select('*').eq('id', id).single();
  if (error || !investigation) {
    return NextResponse.json({ error: 'investigation not found' }, { status: 404 });
  }

  const [{ data: actions }, { data: signal }, { services }] = await Promise.all([
    admin.from('actions').select('*').eq('investigation_id', id).order('rank', { ascending: true }),
    admin.from('signals').select('*').eq('id', investigation.signal_id).single(),
    getDetroitInventory(),
  ]);

  const service = services.find((s) => s.slug === investigation.service_slug) ?? null;

  return NextResponse.json({
    investigation,
    actions: actions ?? [],
    signal: signal ?? null,
    service,
  });
}

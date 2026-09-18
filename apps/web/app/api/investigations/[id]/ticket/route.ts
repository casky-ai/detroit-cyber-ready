// Incident ticket export. ?format=json returns the structured document;
// the default is the Markdown a CISO would actually paste into a ticket
// or read out loud.

import { NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase/admin';
import { getDetroitInventory } from '@/lib/detroit';
import { buildIncidentTicketMarkdown } from '@/lib/ticket';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(req: Request, { params }: RouteParams) {
  const { id } = await params;
  const url = new URL(req.url);
  const format = url.searchParams.get('format') === 'json' ? 'json' : 'markdown';

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

  const service = services.find((s) => s.slug === investigation.service_slug);
  if (!signal || !service) {
    return NextResponse.json({ error: 'incomplete investigation record' }, { status: 500 });
  }

  const ticketInput = { investigation, actions: actions ?? [], signal, service };

  if (format === 'json') {
    return NextResponse.json(ticketInput);
  }

  const markdown = buildIncidentTicketMarkdown(ticketInput);
  return new NextResponse(markdown, { headers: { 'Content-Type': 'text/markdown; charset=utf-8' } });
}

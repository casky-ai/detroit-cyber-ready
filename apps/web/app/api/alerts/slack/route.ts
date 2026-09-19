// Sends the CISO alert to Slack via an incoming webhook (SLACK_WEBHOOK_URL,
// set on Vercel and in .env.local). The request names investigations by id
// only; everything in the message is read from the database and formatted
// by lib/slack-alert.ts, so the alert cannot say anything the records do
// not. Without a webhook it degrades honestly and returns a preview instead
// of pretending to have sent something.

import { NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase/admin';
import { getDetroitInventory } from '@/lib/detroit';
import { buildSlackAlert, type SlackAlertInvestigation } from '@/lib/slack-alert';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: Request) {
  let ids: string[] = [];
  try {
    const body = await req.json();
    ids = Array.isArray(body?.investigation_ids) ? body.investigation_ids : [];
  } catch {
    // fall through to the validation error below
  }
  if (ids.length === 0 || ids.length > 25 || !ids.every((id) => typeof id === 'string' && UUID.test(id))) {
    return NextResponse.json({ sent: false, reason: 'Provide 1 to 25 investigation ids.' }, { status: 400 });
  }

  const admin = getAdminClient();
  const [{ data: investigations, error }, { data: actions }, { services }] = await Promise.all([
    admin.from('investigations').select('*').in('id', ids),
    admin.from('actions').select('*').in('investigation_id', ids).order('rank', { ascending: true }),
    getDetroitInventory(),
  ]);
  if (error || !investigations?.length) {
    return NextResponse.json({ sent: false, reason: 'Those investigations were not found.' }, { status: 404 });
  }

  const signalIds = [...new Set(investigations.map((i) => i.signal_id))];
  if (signalIds.length !== 1) {
    return NextResponse.json({ sent: false, reason: 'One alert covers one signal; these investigations span several.' }, { status: 400 });
  }
  const { data: signal } = await admin.from('signals').select('*').eq('id', signalIds[0]).single();
  if (!signal) {
    return NextResponse.json({ sent: false, reason: 'The signal for these investigations was not found.' }, { status: 404 });
  }

  const rows: SlackAlertInvestigation[] = investigations.flatMap((investigation) => {
    const service = services.find((s) => s.slug === investigation.service_slug);
    if (!service) return [];
    return [{ investigation, service, actions: (actions ?? []).filter((a) => a.investigation_id === investigation.id) }];
  });

  const message = buildSlackAlert({
    baseUrl: new URL(req.url).origin,
    signal,
    investigations: rows,
    sentAt: new Date(),
  });

  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) {
    return NextResponse.json({
      sent: false,
      reason: 'Slack delivery is off because SLACK_WEBHOOK_URL is not set. Add it in the Vercel project settings to send real alerts.',
      preview: message,
    });
  }

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(message),
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) {
      return NextResponse.json({ sent: false, reason: `Slack responded ${res.status}: ${await res.text()}` });
    }
    return NextResponse.json({ sent: true });
  } catch (err) {
    return NextResponse.json({ sent: false, reason: err instanceof Error ? err.message : String(err) });
  }
}

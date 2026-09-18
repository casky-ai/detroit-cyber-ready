// The threat intelligence feed. Returns recent signals whether or not they
// matched anything in Detroit's inventory — showing the near-misses is
// what proves this system filters rather than alarms.

import { NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase/admin';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const limit = Math.min(Number(url.searchParams.get('limit') ?? 50), 200);

  const admin = getAdminClient();
  const { data: signals, error } = await admin
    .from('signals')
    .select('*')
    .order('published_at', { ascending: false })
    .limit(limit);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const signalIds = (signals ?? []).map((s) => s.id);
  const { data: matches, error: matchError } = signalIds.length
    ? await admin.from('signal_matches').select('*').in('signal_id', signalIds)
    : { data: [], error: null };

  if (matchError) {
    return NextResponse.json({ error: matchError.message }, { status: 500 });
  }

  const matchesBySignal = new Map<string, typeof matches>();
  for (const m of matches ?? []) {
    const list = matchesBySignal.get(m.signal_id) ?? [];
    list.push(m);
    matchesBySignal.set(m.signal_id, list);
  }

  const result = (signals ?? []).map((s) => ({
    ...s,
    matches: matchesBySignal.get(s.id) ?? [],
  }));

  return NextResponse.json({ signals: result });
}

// L3: the independent guard that catches a run whose completion write got
// lost (the process was killed, a deploy happened mid-request) or that
// never started properly. Runs on a schedule, entirely independent of any
// SSE connection — see plans/001_prd.md's five-layer guard table.

import { NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase/admin';
import { resolveHealAction, STUCK_THRESHOLD_MS, type HealCandidate } from '@/lib/heal-logic';

export const maxDuration = 30;

function isAuthorized(req: Request): boolean {
  if (req.headers.get('x-vercel-cron') === '1') return true;
  const auth = req.headers.get('authorization');
  const secret = process.env.CRON_SECRET;
  return Boolean(secret) && auth === `Bearer ${secret}`;
}

interface StuckRow {
  id: string;
  status: string;
  output: string | null;
  started_at: string | null;
  created_at: string;
}

export async function POST(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = getAdminClient();
  const { data: rows, error } = await admin
    .from('investigations')
    .select('id, status, output, started_at, created_at')
    .in('status', ['queued', 'running']);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const now = new Date();
  let healed = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const row of (rows ?? []) as StuckRow[]) {
    const candidate: HealCandidate = {
      status: row.status,
      output: row.output,
      workBeganAt: row.started_at ?? row.created_at,
    };
    const action = resolveHealAction(candidate, now);

    if (action === 'heal-complete') {
      const { error: updateError } = await admin
        .from('investigations')
        .update({ status: 'completed', ended_at: now.toISOString() })
        .eq('id', row.id);
      if (updateError) errors.push(`${row.id}: ${updateError.message}`);
      else healed++;
    } else if (action === 'mark-failed') {
      const { error: updateError } = await admin
        .from('investigations')
        .update({
          status: 'failed',
          output: row.output ?? `Investigation exceeded ${STUCK_THRESHOLD_MS / 1000}s without completing.`,
          ended_at: now.toISOString(),
        })
        .eq('id', row.id);
      if (updateError) errors.push(`${row.id}: ${updateError.message}`);
      else failed++;
    }
  }

  return NextResponse.json({ checked: rows?.length ?? 0, healed, failed, errors });
}

// Vercel Cron Jobs always issue a GET request (see apps/web/vercel.json's
// crons entry for this path) — POST remains for manual/curl-driven runs
// with a Bearer CRON_SECRET, same auth check either way.
export const GET = POST;

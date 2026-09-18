// Polls every live SignalSource, normalizes and dedupes the results, and
// upserts them into `signals`. Protected so only the Vercel cron (or a
// holder of CRON_SECRET) can trigger it — this hits external APIs and
// writes to the database, not something to leave open.
//
// DEMO_MODE never applies here: this route always calls the real, live
// feeds. The deterministic demo path is a separate endpoint,
// /api/demo/inject, precisely so the two are never confused with each
// other. See docs/connectors.md.

import { NextResponse } from 'next/server';
import { makeCisaKevSource } from '@dcr/signals/sources/cisa-kev';
import { makeNvdSource } from '@dcr/signals/sources/nvd';
import { pollForCves } from '@dcr/signals/sources/epss';
import { makeAbuseChSource } from '@dcr/signals/sources/abusech';
import { dedupeSignals, fingerprintSignal } from '@dcr/signals/normalize';
import type { RawSignal } from '@dcr/signals/contracts';
import { getAdminClient } from '@/lib/supabase/admin';

export const maxDuration = 60;

function isAuthorized(req: Request): boolean {
  if (req.headers.get('x-vercel-cron') === '1') return true;
  const auth = req.headers.get('authorization');
  const secret = process.env.CRON_SECRET;
  return Boolean(secret) && auth === `Bearer ${secret}`;
}

function toRow(signal: RawSignal) {
  return {
    source: signal.source,
    provenance: signal.provenance,
    external_id: signal.external_id,
    fingerprint: fingerprintSignal(signal),
    kind: signal.kind,
    title: signal.title,
    summary: signal.summary,
    published_at: signal.published_at,
    severity: signal.severity,
    vendor_project: signal.vendor_project,
    product: signal.product,
    cpe: signal.cpe,
    cvss_score: signal.cvss_score,
    epss_percentile: signal.epss_percentile,
    raw: signal.raw,
  };
}

export async function POST(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // 24 hours back is enough to catch anything since the last successful
  // poll on any reasonable cron cadence, without re-fetching the entire
  // KEV catalog's multi-year history every time.
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const gaps: string[] = [];
  const allSignals: RawSignal[] = [];

  const kev = await makeCisaKevSource().poll(since);
  allSignals.push(...kev.signals);
  gaps.push(...kev.gaps);

  const nvd = await makeNvdSource(process.env.NVD_API_KEY).poll(since);
  allSignals.push(...nvd.signals);
  gaps.push(...nvd.gaps);

  const abusech = await makeAbuseChSource(process.env.ABUSECH_API_KEY).poll(since);
  allSignals.push(...abusech.signals);
  gaps.push(...abusech.gaps);

  // EPSS is looked up per-CVE, for every KEV addition just found, so its
  // score can be attached to an investigation later without a second
  // live call blocking the investigation start.
  const kevCveIds = kev.signals.map((s) => s.external_id);
  const epss = await pollForCves(kevCveIds);
  allSignals.push(...epss.signals);
  gaps.push(...epss.gaps);

  const deduped = dedupeSignals(allSignals);
  const rows = deduped.map(toRow);

  let inserted = 0;
  if (rows.length > 0) {
    const { error, count } = await getAdminClient()
      .from('signals')
      .upsert(rows, { onConflict: 'fingerprint', count: 'exact' });
    if (error) {
      return NextResponse.json({ error: error.message, gaps }, { status: 500 });
    }
    inserted = count ?? rows.length;
  }

  return NextResponse.json({
    polled: allSignals.length,
    deduped: rows.length,
    upserted: inserted,
    gaps,
  });
}

// Vercel Cron Jobs always issue a GET request (see apps/web/vercel.json's
// crons entry for this path) — POST remains for manual/curl-driven runs
// with a Bearer CRON_SECRET, same auth check either way.
export const GET = POST;

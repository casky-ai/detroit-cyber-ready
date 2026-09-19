// Starts real investigations for one live CISA KEV entry: the same pipeline
// as the scripted demo, on a CVE the viewer picked from the live catalog.
// The request names only a CVE id; the entry itself is re-read from
// cisa.gov and its EPSS score is looked up live, so the client cannot
// supply the facts being investigated.
//
// Same-origin only (see isSameOrigin): this creates records and calls the
// model, so it is not something another site should be able to trigger.

import { NextResponse } from 'next/server';
import { makeCisaKevSource } from '@dcr/signals/sources/cisa-kev';
import { pollForCves } from '@dcr/signals/sources/epss';
import { isSameOrigin } from '@/lib/same-origin';
import { NoDetroitExposureError, startSignalInvestigations } from '@/lib/start-signal-investigations';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const CVE_ID = /^CVE-\d{4}-\d{4,}$/;

export async function POST(req: Request) {
  if (!isSameOrigin(req.headers.get('origin'), req.headers.get('host'))) {
    return NextResponse.json({ error: 'Investigations can only be started from the Detroit Cyber Ready site.' }, { status: 403 });
  }
  let cve = '';
  try {
    cve = String((await req.json())?.cve ?? '').trim().toUpperCase();
  } catch {
    // fall through to validation
  }
  if (!CVE_ID.test(cve)) {
    return NextResponse.json({ error: 'Provide a CVE id, for example CVE-2023-46805.' }, { status: 400 });
  }

  const { signals, gaps } = await makeCisaKevSource().poll(new Date(0));
  if (signals.length === 0) {
    return NextResponse.json({ error: `Could not load the CISA KEV catalog. ${gaps.join('; ')}`.trim() }, { status: 502 });
  }
  const signal = signals.find((s) => s.external_id === cve);
  if (!signal) {
    return NextResponse.json({ error: `${cve} is not in the CISA KEV catalog.` }, { status: 404 });
  }

  // Live EPSS for this CVE; if FIRST.org is unreachable the score falls back
  // to 0 for that component, which only ever lowers the score, never inflates it.
  const epss = await pollForCves([cve]);
  const epssPercentile = epss.signals[0]?.epss_percentile ?? null;

  try {
    return NextResponse.json(await startSignalInvestigations(signal, epssPercentile), { status: 201 });
  } catch (err) {
    const status = err instanceof NoDetroitExposureError ? 422 : 500;
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status });
  }
}

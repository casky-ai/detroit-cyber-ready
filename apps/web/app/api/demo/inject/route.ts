// The deterministic demo trigger. Separate from /api/signals/poll on
// purpose: the poll route always calls the real, live feeds and shows
// whatever CISA/NVD/EPSS genuinely return right now, which is the honest
// behavior for that route but is NOT something a live presentation should
// depend on (a feed hiccup, a rate limit, or simply CISA not having added
// anything new that hour would derail a demo).
//
// The signal injected here is a REAL, currently-listed CISA KEV entry —
// CVE-2023-46805, verified directly against the live feed before use (see
// the commit that fixed an earlier, incorrectly-attributed CVE). Its
// provenance is 'live' because the underlying facts are genuinely true.
// What makes the resulting MATCH synthetic is that it lands on Detroit's
// remote-access infrastructure only because we authored that mapping —
// the CVE did not choose Detroit, we did, for the purposes of this demo.
//
// The EPSS score below was captured from the real FIRST.org API rather
// than fetched live at request time, so this endpoint never depends on
// network access during a presentation — see docs/connectors.md's DEMO_MODE
// discipline. It is genuinely this CVE's real score as of the date noted;
// it is not invented.

import { NextResponse } from 'next/server';
import { fingerprintSignal } from '@dcr/signals/normalize';
import type { RawSignal } from '@dcr/signals/contracts';
import { getAdminClient } from '@/lib/supabase/admin';
import { startInvestigation } from '@/lib/investigation-start';

export const maxDuration = 30;

// Captured 2026-09-18 from https://api.first.org/data/v1/epss?cve=CVE-2023-46805
// (FIRST.org EPSS model date 2026-09-16): epss 0.99986, percentile 0.99983.
const CAPTURED_EPSS_PERCENTILE = 0.99983;

const DEMO_SIGNAL: RawSignal = {
  source: 'cisa-kev',
  provenance: 'live',
  external_id: 'CVE-2023-46805',
  kind: 'kev-addition',
  title: 'Ivanti Connect Secure and Policy Secure Authentication Bypass Vulnerability',
  summary:
    'Ivanti Connect Secure (ICS, formerly Pulse Connect Secure) and Ivanti Policy Secure gateways ' +
    'contain an authentication bypass vulnerability in the web component that allows an attacker to ' +
    'access restricted resources by bypassing control checks. CISA notes known ransomware campaign use.',
  published_at: '2024-01-10T00:00:00.000Z', // the real KEV dateAdded
  severity: null,
  vendor_project: 'Ivanti',
  product: 'Connect Secure',
  cpe: null, // KEV itself never carries a CPE, matching what makeCisaKevSource() actually produces
  cvss_score: 8.2,
  epss_percentile: null, // attached separately below, from the captured EPSS lookup
  raw: {
    cveID: 'CVE-2023-46805',
    vendorProject: 'Ivanti',
    product: 'Connect Secure and Policy Secure',
    dateAdded: '2024-01-10',
    dueDate: '2024-01-22',
    knownRansomwareCampaignUse: 'Known',
    cwes: ['CWE-287'],
    note: 'Captured from the live CISA KEV catalog for use as this demo\'s trigger event.',
  },
};

interface InjectRequestBody {
  targetServiceSlug?: string;
}

export async function POST(req: Request) {
  let body: InjectRequestBody = {};
  try {
    body = (await req.json()) as InjectRequestBody;
  } catch {
    // No body is fine; every field has a default.
  }
  const targetServiceSlug = body.targetServiceSlug ?? '911-emergency-communications';

  const admin = getAdminClient();
  const row = {
    source: DEMO_SIGNAL.source,
    provenance: DEMO_SIGNAL.provenance,
    external_id: DEMO_SIGNAL.external_id,
    fingerprint: fingerprintSignal(DEMO_SIGNAL),
    kind: DEMO_SIGNAL.kind,
    title: DEMO_SIGNAL.title,
    summary: DEMO_SIGNAL.summary,
    published_at: DEMO_SIGNAL.published_at,
    severity: DEMO_SIGNAL.severity,
    vendor_project: DEMO_SIGNAL.vendor_project,
    product: DEMO_SIGNAL.product,
    cpe: DEMO_SIGNAL.cpe,
    cvss_score: DEMO_SIGNAL.cvss_score,
    epss_percentile: CAPTURED_EPSS_PERCENTILE,
    raw: DEMO_SIGNAL.raw,
  };

  const { data: signalRow, error: signalError } = await admin
    .from('signals')
    .upsert(row, { onConflict: 'fingerprint' })
    .select('id')
    .single();
  if (signalError || !signalRow) {
    return NextResponse.json(
      { error: `failed to record demo signal: ${signalError?.message ?? 'no row returned'}` },
      { status: 500 }
    );
  }

  try {
    const started = await startInvestigation({
      signal: { ...DEMO_SIGNAL, epss_percentile: CAPTURED_EPSS_PERCENTILE },
      signalId: signalRow.id as string,
      targetServiceSlug,
      epssPercentileOverride: CAPTURED_EPSS_PERCENTILE,
    });

    return NextResponse.json(
      {
        investigation_id: started.investigationId,
        signal_id: signalRow.id,
        landed_on: started.match.landedOn,
        landed_kind: started.match.landedKind,
        hops: started.match.hops,
        dependency: started.match.dependency,
        risk: started.risk,
        other_affected_services: started.otherAffectedServices,
      },
      { status: 201 }
    );
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 422 });
  }
}

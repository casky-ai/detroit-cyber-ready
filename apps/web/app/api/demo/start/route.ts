// The timeline demo's actual trigger. Unlike /api/demo/inject (which
// creates exactly one investigation for one target service), this injects
// the signal once and creates a REAL investigation for EVERY service the
// signal reaches — not a dramatization of parallelism, actual parallelism.
// Today that is five services (911, police, water, payments, courts), all
// reachable through the same shared remote-access infrastructure — see
// data/detroit/dependencies.yaml. The frontend opens one SSE connection per
// returned investigation_id and runs all five live agents concurrently.

import { NextResponse } from 'next/server';
import type { RawSignal } from '@dcr/signals/contracts';
import { NoDetroitExposureError, startSignalInvestigations } from '@/lib/start-signal-investigations';

export const maxDuration = 30;

// Same real, verified KEV entry as /api/demo/inject — see that file for the
// full provenance note. Kept as a separate literal here rather than shared
// so each endpoint's trigger is self-contained and easy to audit on its own.
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
  published_at: '2024-01-10T00:00:00.000Z',
  severity: null,
  vendor_project: 'Ivanti',
  // CISA's exact product text for this CVE; the matcher finds 'Connect
  // Secure' inside it as a whole phrase.
  product: 'Connect Secure and Policy Secure',
  cpe: null,
  cvss_score: 8.2,
  epss_percentile: null,
  raw: {
    cveID: 'CVE-2023-46805',
    vendorProject: 'Ivanti',
    product: 'Connect Secure and Policy Secure',
    dateAdded: '2024-01-10',
    dueDate: '2024-01-22',
    knownRansomwareCampaignUse: 'Known',
    cwes: ['CWE-287'],
  },
};

export async function POST() {
  try {
    const result = await startSignalInvestigations(DEMO_SIGNAL, CAPTURED_EPSS_PERCENTILE);
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    const status = err instanceof NoDetroitExposureError ? 422 : 500;
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status });
  }
}

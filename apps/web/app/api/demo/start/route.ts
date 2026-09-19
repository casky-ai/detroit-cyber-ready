// The timeline demo's actual trigger. Unlike /api/demo/inject (which
// creates exactly one investigation for one target service), this injects
// the signal once and creates a REAL investigation for EVERY service the
// signal reaches — not a dramatization of parallelism, actual parallelism.
// Today that is five services (911, police, water, payments, courts), all
// reachable through the same shared remote-access infrastructure — see
// data/detroit/dependencies.yaml. The frontend opens one SSE connection per
// returned investigation_id and runs all five live agents concurrently.

import { NextResponse } from 'next/server';
import { matchSignalToAssets, propagateToServices } from '@dcr/impact/exposure';
import { computeRiskScore } from '@dcr/impact/scoring';
import { fingerprintSignal } from '@dcr/signals/normalize';
import type { RawSignal } from '@dcr/signals/contracts';
import { getAdminClient } from '@/lib/supabase/admin';
import { getDetroitInventory } from '@/lib/detroit';

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
  product: 'Connect Secure',
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
  const admin = getAdminClient();
  const { services, technologies, dependencies } = await getDetroitInventory();

  const signalWithEpss: RawSignal = { ...DEMO_SIGNAL, epss_percentile: CAPTURED_EPSS_PERCENTILE };
  const row = {
    source: signalWithEpss.source,
    provenance: signalWithEpss.provenance,
    external_id: signalWithEpss.external_id,
    fingerprint: fingerprintSignal(signalWithEpss),
    kind: signalWithEpss.kind,
    title: signalWithEpss.title,
    summary: signalWithEpss.summary,
    published_at: signalWithEpss.published_at,
    severity: signalWithEpss.severity,
    vendor_project: signalWithEpss.vendor_project,
    product: signalWithEpss.product,
    cpe: signalWithEpss.cpe,
    cvss_score: signalWithEpss.cvss_score,
    epss_percentile: CAPTURED_EPSS_PERCENTILE,
    raw: signalWithEpss.raw,
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
  const signalId = signalRow.id as string;

  const assetMatches = matchSignalToAssets(signalWithEpss, technologies);
  const allMatches = propagateToServices(assetMatches, dependencies);
  if (allMatches.length === 0) {
    return NextResponse.json({ error: 'no Detroit exposure: signal matched nothing' }, { status: 422 });
  }

  const matchRows = allMatches.map((m) => ({
    signal_id: signalId,
    landed_on: m.landedOn,
    landed_kind: m.landedKind,
    service_slug: m.serviceSlug,
    match_basis: m.matchBasis,
    matched_on: m.matchedOn,
    hops: m.hops,
    dependency: m.dependency,
    provenance: 'synthetic' as const, // the CVE is real; the Detroit inventory it lands on is authored
    confidence: m.confidence,
  }));
  const { error: matchError } = await admin
    .from('signal_matches')
    .upsert(matchRows, { onConflict: 'signal_id,landed_on,service_slug' });
  if (matchError) {
    return NextResponse.json({ error: `failed to record signal matches: ${matchError.message}` }, { status: 500 });
  }

  // One investigation row per affected service, all created up front so
  // the frontend can open all five SSE connections at once.
  const investigations = [];
  for (const match of allMatches) {
    const service = services.find((s) => s.slug === match.serviceSlug);
    if (!service) continue;
    const risk = computeRiskScore(match, service, CAPTURED_EPSS_PERCENTILE);

    const { data: inv, error: invError } = await admin
      .from('investigations')
      .insert({
        signal_id: signalId,
        service_slug: service.slug,
        status: 'queued',
        context: { match },
        risk_score: risk.score,
        risk_components: risk.components,
        priority: risk.priority,
        escalated: risk.escalated,
        escalation_reason: risk.escalationReason,
      })
      .select('id')
      .single();
    if (invError || !inv) {
      return NextResponse.json(
        { error: `failed to create investigation for ${service.slug}: ${invError?.message}` },
        { status: 500 }
      );
    }

    investigations.push({
      investigation_id: inv.id as string,
      service_slug: service.slug,
      service_name: service.name,
      landed_on: match.landedOn,
      hops: match.hops,
      dependency: match.dependency,
      risk,
    });
  }

  return NextResponse.json(
    {
      signal_id: signalId,
      signal: {
        external_id: signalWithEpss.external_id,
        title: signalWithEpss.title,
        summary: signalWithEpss.summary,
        source: signalWithEpss.source,
        vendor_project: signalWithEpss.vendor_project,
        product: signalWithEpss.product,
        cvss_score: signalWithEpss.cvss_score,
        epss_percentile: CAPTURED_EPSS_PERCENTILE,
        published_at: signalWithEpss.published_at,
      },
      investigations,
    },
    { status: 201 }
  );
}

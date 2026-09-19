// Records a signal, matches it against the Detroit inventory, persists the
// audit trail, and creates one queued investigation per affected service.
// Shared by the scripted demo (/api/demo/start) and the live KEV check
// (/api/kev/live/investigate), so a live CVE is investigated exactly the
// way the demo CVE is. The agents run when the client opens each SSE stream.

import { matchSignalToAssets, propagateToServices } from '@dcr/impact/exposure';
import { computeRiskScore } from '@dcr/impact/scoring';
import { fingerprintSignal } from '@dcr/signals/normalize';
import type { RawSignal } from '@dcr/signals/contracts';
import { getAdminClient } from './supabase/admin';
import { getDetroitInventory } from './detroit';
import type { DemoStartResponse } from './timeline-types';

/** The signal reaches nothing in Detroit's inventory. */
export class NoDetroitExposureError extends Error {}

export async function startSignalInvestigations(
  signal: RawSignal,
  epssPercentile: number | null
): Promise<DemoStartResponse> {
  const admin = getAdminClient();
  const { services, technologies, dependencies } = await getDetroitInventory();
  const withEpss: RawSignal = { ...signal, epss_percentile: epssPercentile };

  // Match before writing anything, so a signal with no exposure leaves no trace.
  const allMatches = propagateToServices(matchSignalToAssets(withEpss, technologies), dependencies);
  if (allMatches.length === 0) {
    throw new NoDetroitExposureError(`no Detroit exposure: ${signal.external_id} matched nothing in the inventory`);
  }

  const { data: signalRow, error: signalError } = await admin
    .from('signals')
    .upsert(
      {
        source: withEpss.source,
        provenance: withEpss.provenance,
        external_id: withEpss.external_id,
        fingerprint: fingerprintSignal(withEpss),
        kind: withEpss.kind,
        title: withEpss.title,
        summary: withEpss.summary,
        published_at: withEpss.published_at,
        severity: withEpss.severity,
        vendor_project: withEpss.vendor_project,
        product: withEpss.product,
        cpe: withEpss.cpe,
        cvss_score: withEpss.cvss_score,
        epss_percentile: epssPercentile,
        raw: withEpss.raw,
      },
      { onConflict: 'fingerprint' }
    )
    .select('id')
    .single();
  if (signalError || !signalRow) {
    throw new Error(`failed to record signal: ${signalError?.message ?? 'no row returned'}`);
  }
  const signalId = signalRow.id as string;

  const { error: matchError } = await admin.from('signal_matches').upsert(
    allMatches.map((m) => ({
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
    })),
    { onConflict: 'signal_id,landed_on,service_slug' }
  );
  if (matchError) throw new Error(`failed to record signal matches: ${matchError.message}`);

  // One investigation per affected service, all created up front so the
  // client can open every SSE stream at once.
  const investigations: DemoStartResponse['investigations'] = [];
  for (const match of allMatches) {
    const service = services.find((s) => s.slug === match.serviceSlug);
    if (!service) continue;
    const risk = computeRiskScore(match, service, epssPercentile);
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
      throw new Error(`failed to create investigation for ${service.slug}: ${invError?.message}`);
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

  return {
    signal_id: signalId,
    signal: {
      external_id: withEpss.external_id,
      title: withEpss.title,
      summary: withEpss.summary ?? '',
      source: withEpss.source,
      vendor_project: withEpss.vendor_project ?? '',
      product: withEpss.product ?? '',
      cvss_score: withEpss.cvss_score ?? 0,
      epss_percentile: epssPercentile ?? 0,
      published_at: withEpss.published_at,
    },
    investigations,
  };
}

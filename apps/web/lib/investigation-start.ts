// Shared by /api/demo/inject and /api/signals/[id]/investigate: given a
// signal already in the database, run the deterministic match+propagation+
// scoring pipeline against the real Detroit inventory, persist the audit
// trail (signal_matches, one row per affected service), and create the
// `investigations` row the SSE route will actually run the agent against.
//
// This is all synchronous, fast, and LLM-free — see packages/impact. The
// agent only runs once the SSE route opens.

import { matchSignalToAssets, propagateToServices, type SignalMatch } from '@dcr/impact/exposure';
import { computeRiskScore } from '@dcr/impact/scoring';
import type { RawSignal } from '@dcr/signals';
import { getAdminClient } from './supabase/admin';
import { getDetroitInventory } from './detroit';

export interface StartedInvestigation {
  investigationId: string;
  match: SignalMatch;
  risk: ReturnType<typeof computeRiskScore>;
  otherAffectedServices: string[];
}

// Every match produced by this deployment is 'synthetic', regardless of
// whether the triggering signal is real: the Detroit inventory it matches
// against is authored, not a real customer's CMDB. This is not the same as
// the signal's own provenance — a genuinely real CVE (provenance: 'live')
// can still produce a synthetic match, because what makes it synthetic is
// the fictional assumption about which Detroit asset runs that product,
// not the truthfulness of the vulnerability itself. Once this runs against
// a real customer's inventory, this becomes a real parameter instead of a
// constant.
const MATCH_PROVENANCE = 'synthetic' as const;

/**
 * Matches a signal against the inventory, records the full audit trail
 * (every affected service, not just the target one), and creates ONE
 * investigation row for the requested target service.
 */
export async function startInvestigation(params: {
  signal: RawSignal;
  signalId: string;
  targetServiceSlug: string;
  epssPercentileOverride?: number | null;
}): Promise<StartedInvestigation> {
  const { services, technologies, dependencies } = await getDetroitInventory();
  const admin = getAdminClient();

  const assetMatches = matchSignalToAssets(params.signal, technologies);
  const allMatches = propagateToServices(assetMatches, dependencies);

  if (allMatches.length === 0) {
    throw new Error('no Detroit exposure: this signal did not match any service or infrastructure');
  }

  // Persist the audit trail for every affected service, not only the one
  // we're about to investigate — this is what makes "N other services
  // affected" a real, queryable count instead of a hardcoded string.
  const matchRows = allMatches.map((m) => ({
    signal_id: params.signalId,
    landed_on: m.landedOn,
    landed_kind: m.landedKind,
    service_slug: m.serviceSlug,
    match_basis: m.matchBasis,
    matched_on: m.matchedOn,
    hops: m.hops,
    dependency: m.dependency,
    provenance: MATCH_PROVENANCE,
    confidence: m.confidence,
  }));
  const { error: matchError } = await admin
    .from('signal_matches')
    .upsert(matchRows, { onConflict: 'signal_id,landed_on,service_slug' });
  if (matchError) throw new Error(`failed to record signal matches: ${matchError.message}`);

  const targetMatch = allMatches.find((m) => m.serviceSlug === params.targetServiceSlug);
  if (!targetMatch) {
    throw new Error(`signal does not reach service "${params.targetServiceSlug}"`);
  }
  const service = services.find((s) => s.slug === params.targetServiceSlug);
  if (!service) {
    throw new Error(`unknown service "${params.targetServiceSlug}"`);
  }

  const risk = computeRiskScore(targetMatch, service, params.epssPercentileOverride);

  const { data: investigation, error: invError } = await admin
    .from('investigations')
    .insert({
      signal_id: params.signalId,
      service_slug: service.slug,
      status: 'queued',
      // Just the match: the SSE route re-derives the full CityService from
      // @dcr/impact/data by service_slug rather than duplicating the whole
      // service record into this row's jsonb.
      context: { match: targetMatch },
      risk_score: risk.score,
      risk_components: risk.components,
      priority: risk.priority,
      escalated: risk.escalated,
      escalation_reason: risk.escalationReason,
    })
    .select('id')
    .single();
  if (invError || !investigation) {
    throw new Error(`failed to create investigation: ${invError?.message ?? 'no row returned'}`);
  }

  const otherAffectedServices = allMatches
    .map((m) => m.serviceSlug)
    .filter((slug) => slug !== params.targetServiceSlug);

  return {
    investigationId: investigation.id as string,
    match: targetMatch,
    risk,
    otherAffectedServices: [...new Set(otherAffectedServices)],
  };
}

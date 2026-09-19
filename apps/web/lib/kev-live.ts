// Runs the whole CISA KEV catalog through the same deterministic matcher the
// demo uses, against Detroit's inventory. Pure: the route fetches the
// catalog, this decides what reaches Detroit. No model is involved in
// deciding exposure, here or anywhere else.

import { matchSignalToAssets, propagateToServices } from '@dcr/impact/exposure';
import type { CityService, ServiceDependency, Technology } from '@dcr/impact/data';
import type { RawSignal } from '@dcr/signals';

export interface KevReach {
  service_slug: string;
  service_name: string;
  hops: 0 | 1;
  landed_on: string;
  dependency_criticality: 'hard' | 'soft' | null;
  matched_phrase: string | null;
}

export interface KevRow {
  cve: string;
  vendor: string;
  product: string;
  name: string;
  date_added: string; // YYYY-MM-DD
  ransomware: boolean;
  reaches: KevReach[];
}

export interface KevAssessment {
  total: number;
  newest: KevRow[];
  reaching: KevRow[];
  reaching_total: number;
}

const CRITICALITY_RANK: Record<string, number> = { 'life-safety': 0, critical: 1, high: 2, moderate: 3, low: 4 };

export function assessKevCatalog(
  signals: RawSignal[],
  inventory: { services: CityService[]; technologies: Technology[]; dependencies: ServiceDependency[] },
  limits: { newest?: number; reaching?: number } = {}
): KevAssessment {
  const rank = (slug: string) =>
    CRITICALITY_RANK[inventory.services.find((s) => s.slug === slug)?.criticality ?? 'low'] ?? 9;

  const rows: KevRow[] = signals.map((signal) => {
    const matches = propagateToServices(matchSignalToAssets(signal, inventory.technologies), inventory.dependencies);
    const reaches = matches
      .map((m) => ({
        service_slug: m.serviceSlug,
        service_name: inventory.services.find((s) => s.slug === m.serviceSlug)?.name ?? m.serviceSlug,
        hops: m.hops,
        landed_on: m.landedOn,
        dependency_criticality: m.dependency?.criticality ?? null,
        matched_phrase: (m.matchedOn as { matched_phrase?: string }).matched_phrase ?? null,
      }))
      // Most critical service first, so 911 leads whenever it is reached.
      .sort((a, b) => rank(a.service_slug) - rank(b.service_slug));
    const raw = (signal.raw ?? {}) as { knownRansomwareCampaignUse?: string };
    return {
      cve: signal.external_id,
      vendor: signal.vendor_project ?? '',
      product: signal.product ?? '',
      name: signal.title,
      date_added: signal.published_at.slice(0, 10),
      ransomware: raw.knownRansomwareCampaignUse === 'Known',
      reaches,
    };
  });

  const byNewest = [...rows].sort((a, b) => b.date_added.localeCompare(a.date_added) || b.cve.localeCompare(a.cve));
  const reaching = byNewest.filter((r) => r.reaches.length > 0);

  return {
    total: rows.length,
    newest: byNewest.slice(0, limits.newest ?? 15),
    reaching: reaching.slice(0, limits.reaching ?? 40),
    reaching_total: reaching.length,
  };
}

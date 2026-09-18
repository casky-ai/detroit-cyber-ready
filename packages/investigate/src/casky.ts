// Optional enrichment from the Casky platform: existing CVE analysis and
// matching investigation playbooks, pulled from Casky's own hosted API.
// Entirely optional — a missing key, a network failure, or Casky simply
// not having analyzed this CVE yet all degrade to a recorded gap, never a
// thrown error. See docs/connectors.md, "Investigation playbooks, CVE
// analysis" row.

export interface CaskySpotlight {
  cve_id: string;
  cvss_score: number | null;
  cvss_severity: string | null;
  is_kev: boolean;
  title: string | null;
  description: string | null;
  technique_ids: string[];
  ai_analysis: string | null;
}

export interface CaskyPlaybook {
  id: string;
  name: string;
  domain: string;
  mitre_techniques: string[];
}

export interface CaskyEnrichment {
  spotlight: CaskySpotlight | null;
  playbooks: CaskyPlaybook[];
  gaps: string[];
}

const TIMEOUT_MS = 8_000;

function baseUrl(): string {
  return process.env.CASKY_API_URL ?? 'https://casky.ai';
}

async function caskyFetch<T>(path: string): Promise<{ data: T | null; gap: string | null }> {
  const apiKey = process.env.CASKY_API_KEY;
  if (!apiKey) {
    return { data: null, gap: 'casky: CASKY_API_KEY not configured' };
  }
  try {
    const res = await fetch(`${baseUrl()}${path}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      return { data: null, gap: `casky: HTTP ${res.status} from ${path}` };
    }
    return { data: (await res.json()) as T, gap: null };
  } catch (err) {
    return { data: null, gap: `casky: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/**
 * Looks up whatever Casky already knows about this CVE and any matching
 * investigation playbooks for the given technique IDs. Both calls run
 * regardless of each other's outcome — one failing never blocks the other.
 */
export async function fetchCaskyEnrichment(
  cveId: string,
  techniqueIds: string[] = []
): Promise<CaskyEnrichment> {
  const gaps: string[] = [];

  const spotlightResult = await caskyFetch<{ spotlights: CaskySpotlight[] }>(
    `/api/v1/cve-spotlights?cve_ids=${encodeURIComponent(cveId)}`
  );
  if (spotlightResult.gap) gaps.push(spotlightResult.gap);
  const spotlightRaw = spotlightResult.data?.spotlights?.[0] ?? null;
  // Casky returns a null-filled placeholder row for a CVE it hasn't
  // analyzed yet rather than omitting it — treat "no title and no
  // analysis" as "nothing to show" instead of presenting an empty shell.
  const spotlight = spotlightRaw && (spotlightRaw.title || spotlightRaw.ai_analysis) ? spotlightRaw : null;
  if (spotlightResult.data && !spotlight) {
    gaps.push(`casky: no analysis available yet for ${cveId}`);
  }

  let playbooks: CaskyPlaybook[] = [];
  if (techniqueIds.length > 0) {
    const playbooksResult = await caskyFetch<{ playbooks: CaskyPlaybook[] }>(
      `/api/v1/playbooks?techniques=${techniqueIds.map(encodeURIComponent).join(',')}`
    );
    if (playbooksResult.gap) gaps.push(playbooksResult.gap);
    playbooks = playbooksResult.data?.playbooks ?? [];
    if (playbooksResult.data && playbooks.length === 0) {
      gaps.push('casky: no matching playbooks found');
    }
  }

  return { spotlight, playbooks, gaps };
}

// CISA Known Exploited Vulnerabilities catalog. The primary trigger for this
// product: it is the only feed that asserts active exploitation, and it
// carries vendorProject/product fields, which is what makes a deterministic
// match against the technology inventory possible.
//
// No API key. Free tiers do not get more reliable than this one.

import type { RawSignal, SignalPollResult, SignalSource } from '../contracts';
import { fetchJson } from '../http';

const KEV_URL =
  'https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json';
const TIMEOUT_MS = 8_000;

interface KevEntry {
  cveID: string;
  vendorProject: string;
  product: string;
  vulnerabilityName: string;
  dateAdded: string; // YYYY-MM-DD
  shortDescription: string;
  requiredAction: string;
  dueDate: string;
  knownRansomwareCampaignUse?: string;
}

interface KevCatalog {
  title: string;
  catalogVersion: string;
  dateReleased: string;
  count: number;
  vulnerabilities: KevEntry[];
}

function toRawSignal(entry: KevEntry): RawSignal | null {
  // A KEV entry with no vendor or product cannot be matched against anything.
  // Rather than emit a signal the matcher can never use, treat it as absent —
  // this is a data-quality guard, not a network failure, so it does not
  // become a gap string.
  if (!entry.vendorProject?.trim() || !entry.product?.trim()) return null;
  if (!entry.cveID?.trim()) return null;

  const publishedAt = parseKevDate(entry.dateAdded);
  if (!publishedAt) return null;

  return {
    source: 'cisa-kev',
    provenance: 'live',
    external_id: entry.cveID,
    kind: 'kev-addition',
    title: entry.vulnerabilityName || entry.cveID,
    summary: entry.shortDescription ?? null,
    published_at: publishedAt,
    severity: null, // KEV does not carry a severity score; NVD supplies CVSS
    vendor_project: entry.vendorProject,
    product: entry.product,
    cpe: null,
    cvss_score: null,
    epss_percentile: null,
    raw: entry,
  };
}

/** KEV dates are YYYY-MM-DD with no time or zone. Treat as UTC midnight. */
function parseKevDate(dateAdded: string): string | null {
  if (!dateAdded || !/^\d{4}-\d{2}-\d{2}$/.test(dateAdded)) return null;
  const iso = `${dateAdded}T00:00:00.000Z`;
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return null;
  // A dateAdded in the future (clock skew, upstream data error) is not
  // something we can present as already-published. Treat as unparseable.
  if (parsed.getTime() > Date.now()) return null;
  return iso;
}

export function makeCisaKevSource(): SignalSource {
  return {
    name: 'cisa-kev',
    mode: 'live',
    requiresKey: false,

    async poll(since: Date): Promise<SignalPollResult> {
      const { data, gap } = await fetchJson<KevCatalog>(KEV_URL, {
        timeoutMs: TIMEOUT_MS,
        sourceName: 'cisa-kev',
      });

      if (!data) {
        return { signals: [], gaps: gap ? [gap] : ['cisa-kev: no data returned'] };
      }

      const gaps: string[] = [];
      const signals: RawSignal[] = [];

      for (const entry of data.vulnerabilities ?? []) {
        const signal = toRawSignal(entry);
        if (!signal) continue;
        if (new Date(signal.published_at).getTime() < since.getTime()) continue;
        signals.push(signal);
      }

      if (signals.length === 0 && (data.vulnerabilities?.length ?? 0) > 0) {
        // Not an error: this just means nothing new since `since`. Recorded
        // as an informational gap rather than silence, so a poll history
        // shows "checked, nothing new" distinctly from "feed was down".
        gaps.push(`cisa-kev: no new entries since ${since.toISOString()}`);
      }

      return { signals, gaps };
    },
  };
}

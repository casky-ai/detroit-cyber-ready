// NVD CVE API 2.0. Supplies CVSS score and CPE configurations, which give the
// exposure matcher its highest-confidence match path (stage 1, confidence
// 0.95) when a signal's CPE lines up with a technology inventory row.
//
// Works without a key at a lower rate limit; NVD_API_KEY raises it.

import type { RawSignal, SignalPollResult, SignalSource } from '../contracts';
import { fetchJson } from '../http';

const NVD_BASE = 'https://services.nvd.nist.gov/rest/json/cves/2.0';
const TIMEOUT_MS = 15_000;
const RESULTS_PER_PAGE = 100;

interface NvdCveItem {
  cve: {
    id: string;
    published: string; // ISO 8601, no zone suffix
    descriptions: Array<{ lang: string; value: string }>;
    metrics?: {
      cvssMetricV31?: Array<{ cvssData: { baseScore: number } }>;
      cvssMetricV30?: Array<{ cvssData: { baseScore: number } }>;
    };
    configurations?: Array<{
      nodes: Array<{ cpeMatch: Array<{ criteria: string; vulnerable: boolean }> }>;
    }>;
  };
}

interface NvdResponse {
  vulnerabilities: NvdCveItem[];
}

function firstCpe(item: NvdCveItem): string | null {
  for (const node of item.cve.configurations ?? []) {
    for (const match of node.cpeMatch ?? []) {
      if (match.vulnerable) return match.criteria;
    }
  }
  return null;
}

function cvssScore(item: NvdCveItem): number | null {
  const v31 = item.cve.metrics?.cvssMetricV31?.[0]?.cvssData.baseScore;
  const v30 = item.cve.metrics?.cvssMetricV30?.[0]?.cvssData.baseScore;
  return v31 ?? v30 ?? null;
}

function englishDescription(item: NvdCveItem): string | null {
  return item.cve.descriptions.find((d) => d.lang === 'en')?.value ?? null;
}

function toRawSignal(item: NvdCveItem): RawSignal | null {
  if (!item.cve.id?.trim() || !item.cve.published) return null;
  const published = new Date(item.cve.published);
  if (Number.isNaN(published.getTime())) return null;
  // NVD timestamps have no zone suffix and are UTC; a future one is a data
  // error we should not present as already published.
  if (published.getTime() > Date.now()) return null;

  return {
    source: 'nvd',
    provenance: 'live',
    external_id: item.cve.id,
    kind: 'advisory',
    title: item.cve.id,
    summary: englishDescription(item),
    published_at: published.toISOString(),
    severity: null,
    vendor_project: null,
    product: null,
    cpe: firstCpe(item),
    cvss_score: cvssScore(item),
    epss_percentile: null,
    raw: item,
  };
}

export function makeNvdSource(apiKey?: string): SignalSource {
  return {
    name: 'nvd',
    mode: 'live',
    requiresKey: false,

    async poll(since: Date): Promise<SignalPollResult> {
      const params = new URLSearchParams({
        pubStartDate: since.toISOString(),
        pubEndDate: new Date().toISOString(),
        resultsPerPage: String(RESULTS_PER_PAGE),
      });

      const { data, gap } = await fetchJson<NvdResponse>(`${NVD_BASE}?${params}`, {
        timeoutMs: TIMEOUT_MS,
        sourceName: 'nvd',
        headers: apiKey ? { apiKey } : undefined,
      });

      if (!data) {
        return { signals: [], gaps: gap ? [gap] : ['nvd: no data returned'] };
      }

      const signals: RawSignal[] = [];
      for (const item of data.vulnerabilities ?? []) {
        const signal = toRawSignal(item);
        if (signal) signals.push(signal);
      }

      return { signals, gaps: [] };
    },
  };
}

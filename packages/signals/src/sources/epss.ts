// FIRST.org EPSS: exploitation probability and percentile. Enrichment, not a
// standalone trigger — it feeds the risk score's 25-point component. No key.

import type { RawSignal, SignalPollResult, SignalSource } from '../contracts';
import { fetchJson } from '../http';

const EPSS_BASE = 'https://api.first.org/data/v1/epss';
const TIMEOUT_MS = 8_000;

interface EpssEntry {
  cve: string;
  epss: string; // stringified float, 0 to 1
  percentile: string; // stringified float, 0 to 1
  date: string; // YYYY-MM-DD, the score's model date
}

interface EpssResponse {
  data: EpssEntry[];
}

function toRawSignal(entry: EpssEntry): RawSignal | null {
  if (!entry.cve?.trim()) return null;
  const percentile = Number(entry.percentile);
  if (!Number.isFinite(percentile)) return null;

  const published = parseEpssDate(entry.date);
  if (!published) return null;

  return {
    source: 'epss',
    provenance: 'live',
    external_id: entry.cve,
    kind: 'advisory',
    title: `${entry.cve} exploitation probability`,
    summary: null,
    published_at: published,
    severity: null,
    vendor_project: null,
    product: null,
    cpe: null,
    cvss_score: null,
    epss_percentile: percentile,
    raw: entry,
  };
}

function parseEpssDate(date: string): string | null {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  if (parsed.getTime() > Date.now()) return null;
  return parsed.toISOString();
}

/**
 * EPSS scores every CVE, so this source is queried per-CVE rather than
 * polled on a time window. `pollForCves` is the real entry point; `poll`
 * satisfies the SignalSource contract by returning empty with an explanatory
 * gap, since "since a date" is not how this feed is shaped.
 */
export function makeEpssSource(): SignalSource {
  return {
    name: 'epss',
    mode: 'live',
    requiresKey: false,

    async poll(): Promise<SignalPollResult> {
      return {
        signals: [],
        gaps: ['epss: queried per-CVE via pollForCves, not on a time window'],
      };
    },
  };
}

export async function pollForCves(cveIds: string[]): Promise<{
  signals: RawSignal[];
  gaps: string[];
}> {
  if (cveIds.length === 0) return { signals: [], gaps: [] };

  const params = new URLSearchParams({ cve: cveIds.join(',') });
  const { data, gap } = await fetchJson<EpssResponse>(`${EPSS_BASE}?${params}`, {
    timeoutMs: TIMEOUT_MS,
    sourceName: 'epss',
  });

  if (!data) {
    return { signals: [], gaps: gap ? [gap] : ['epss: no data returned'] };
  }

  const signals: RawSignal[] = [];
  for (const entry of data.data ?? []) {
    const signal = toRawSignal(entry);
    if (signal) signals.push(signal);
  }

  return { signals, gaps: [] };
}

// abuse.ch URLhaus: malicious URL and malware infrastructure feed.
// Corroborating signal only — it never drives the exposure match on its own,
// it adds to the confidence a KEV-triggered investigation is worth escalating.
// Free API, requires an Auth-Key header (ABUSECH_API_KEY).

import type { RawSignal, SignalPollResult, SignalSource } from '../contracts';
import { fetchJson } from '../http';

const URLHAUS_RECENT_URL = 'https://urlhaus-api.abuse.ch/v1/urls/recent/';
const TIMEOUT_MS = 8_000;

interface UrlhausEntry {
  id: string;
  url: string;
  url_status: string;
  threat: string;
  tags: string[] | null;
  date_added: string; // "YYYY-MM-DD HH:mm:ss UTC"
}

interface UrlhausResponse {
  query_status: string;
  urls: UrlhausEntry[];
}

function parseUrlhausDate(dateAdded: string): string | null {
  // Format observed from the API: "2025-09-18 03:14:00 UTC"
  const normalized = dateAdded.replace(' UTC', 'Z').replace(' ', 'T');
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return null;
  if (parsed.getTime() > Date.now()) return null;
  return parsed.toISOString();
}

function toRawSignal(entry: UrlhausEntry): RawSignal | null {
  if (!entry.id?.trim() || !entry.url?.trim()) return null;
  const publishedAt = parseUrlhausDate(entry.date_added);
  if (!publishedAt) return null;

  return {
    source: 'abusech',
    provenance: 'live',
    external_id: entry.id,
    kind: 'ioc',
    title: `Malicious URL: ${entry.threat || 'unclassified'}`,
    summary: entry.tags?.length ? `Tags: ${entry.tags.join(', ')}` : null,
    published_at: publishedAt,
    severity: null,
    vendor_project: null,
    product: null,
    cpe: null,
    cvss_score: null,
    epss_percentile: null,
    raw: entry,
  };
}

export function makeAbuseChSource(apiKey?: string): SignalSource {
  return {
    name: 'abusech',
    mode: 'live',
    requiresKey: true,

    async poll(since: Date): Promise<SignalPollResult> {
      if (!apiKey) {
        return { signals: [], gaps: ['abusech: ABUSECH_API_KEY not configured'] };
      }

      const { data, gap } = await fetchJson<UrlhausResponse>(URLHAUS_RECENT_URL, {
        timeoutMs: TIMEOUT_MS,
        sourceName: 'abusech',
        headers: { 'Auth-Key': apiKey },
      });

      if (!data) {
        return { signals: [], gaps: gap ? [gap] : ['abusech: no data returned'] };
      }

      if (data.query_status !== 'ok') {
        return { signals: [], gaps: [`abusech: query_status "${data.query_status}"`] };
      }

      const signals: RawSignal[] = [];
      for (const entry of data.urls ?? []) {
        const signal = toRawSignal(entry);
        if (signal && new Date(signal.published_at).getTime() >= since.getTime()) {
          signals.push(signal);
        }
      }

      return { signals, gaps: [] };
    },
  };
}

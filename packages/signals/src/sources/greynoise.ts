// GreyNoise Community API: is an IP hitting our exposed infrastructure part
// of mass internet scanning noise, or something more targeted? Corroborating
// signal only, queried per-IP rather than polled on a time window, the same
// shape as EPSS. Free community tier, requires GREYNOISE_API_KEY.

import type { RawSignal } from '../contracts';
import { fetchJson } from '../http';

const GREYNOISE_BASE = 'https://api.greynoise.io/v3/community';
const TIMEOUT_MS = 8_000;

interface GreyNoiseCommunityResponse {
  ip: string;
  noise: boolean;
  riot: boolean;
  classification: 'benign' | 'malicious' | 'unknown';
  name?: string;
  last_seen?: string; // YYYY-MM-DD
  message: string;
}

function parseLastSeen(lastSeen: string | undefined): string | null {
  if (!lastSeen || !/^\d{4}-\d{2}-\d{2}$/.test(lastSeen)) return null;
  const parsed = new Date(`${lastSeen}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  if (parsed.getTime() > Date.now()) return null;
  return parsed.toISOString();
}

/**
 * GreyNoise's own API is a per-IP lookup, not a pollable feed, so this source
 * does not implement SignalSource's poll(). It is consumed directly by the
 * investigation layer once an IP of interest is known (e.g. from a
 * surface-change signal), which is why it lives here rather than pretending
 * to satisfy a contract it does not fit.
 */
export async function lookupIp(
  ip: string,
  apiKey?: string
): Promise<{ signal: RawSignal | null; gap: string | null }> {
  if (!apiKey) {
    return { signal: null, gap: 'greynoise: GREYNOISE_API_KEY not configured' };
  }

  const { data, gap } = await fetchJson<GreyNoiseCommunityResponse>(
    `${GREYNOISE_BASE}/${encodeURIComponent(ip)}`,
    { timeoutMs: TIMEOUT_MS, sourceName: 'greynoise', headers: { key: apiKey } }
  );

  if (!data) {
    return { signal: null, gap: gap ?? 'greynoise: no data returned' };
  }

  if (!data.noise && !data.riot) {
    // Not seen scanning, not a known benign service. GreyNoise has no
    // opinion, which is itself useful: it means this IP is not obviously
    // noise, so a KEV-triggered investigation should not be discounted.
    return { signal: null, gap: null };
  }

  const publishedAt = parseLastSeen(data.last_seen) ?? new Date().toISOString();

  return {
    signal: {
      source: 'greynoise',
      provenance: 'live',
      external_id: data.ip,
      kind: 'scanning-activity',
      title: data.riot
        ? `${data.ip} is a known benign service (RIOT)`
        : `${data.ip} classified as ${data.classification} by GreyNoise`,
      summary: data.message ?? null,
      published_at: publishedAt,
      severity: null,
      vendor_project: null,
      product: null,
      cpe: null,
      cvss_score: null,
      epss_percentile: null,
      raw: data,
    },
    gap: null,
  };
}

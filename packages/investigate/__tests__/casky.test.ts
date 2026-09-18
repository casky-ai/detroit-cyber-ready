// Same discipline as packages/signals' feed-degradation tests: mocked
// fetch, because this must never touch the real network in the default
// suite, and every failure mode degrades to a gap, never a throw.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchCaskyEnrichment } from '../src/casky';

// vitest.setup.ts loads the repo's real .env.local for the live-API
// integration tests elsewhere in this package, which means a genuine
// CASKY_API_KEY may already be set before these tests run. Every test here
// needs a clean slate regardless of what the environment happened to load,
// so the "no key configured" test is actually testable.
beforeEach(() => {
  delete process.env.CASKY_API_KEY;
  delete process.env.CASKY_API_URL;
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.CASKY_API_KEY;
  delete process.env.CASKY_API_URL;
});

describe('fetchCaskyEnrichment', () => {
  it('returns a gap, not a throw, when CASKY_API_KEY is not configured', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const result = await fetchCaskyEnrichment('CVE-2023-46805');
    expect(result.spotlight).toBeNull();
    expect(result.playbooks).toEqual([]);
    expect(result.gaps.some((g) => g.includes('CASKY_API_KEY'))).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns real spotlight data when Casky has analyzed the CVE', async () => {
    process.env.CASKY_API_KEY = 'test-key';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          spotlights: [
            {
              cve_id: 'CVE-2023-46805',
              cvss_score: 8.2,
              cvss_severity: 'high',
              is_kev: true,
              title: 'Ivanti Connect Secure Authentication Bypass',
              description: 'An authentication bypass vulnerability.',
              technique_ids: ['T1190'],
              ai_analysis: 'This vulnerability allows unauthenticated access.',
            },
          ],
        }),
      })
    );
    const result = await fetchCaskyEnrichment('CVE-2023-46805');
    expect(result.spotlight?.ai_analysis).toContain('unauthenticated access');
    expect(result.gaps).toEqual([]);
  });

  it('treats a null-filled placeholder spotlight (CVE not yet analyzed) as absent, not as data', async () => {
    process.env.CASKY_API_KEY = 'test-key';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          spotlights: [
            {
              cve_id: 'CVE-2023-46805',
              cvss_score: null,
              cvss_severity: null,
              is_kev: false,
              title: null,
              description: null,
              technique_ids: [],
              ai_analysis: null,
            },
          ],
        }),
      })
    );
    const result = await fetchCaskyEnrichment('CVE-2023-46805');
    expect(result.spotlight).toBeNull();
    expect(result.gaps.some((g) => g.includes('no analysis available'))).toBe(true);
  });

  it('degrades to a gap on a non-2xx response, not a throw', async () => {
    process.env.CASKY_API_KEY = 'test-key';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) }));
    const result = await fetchCaskyEnrichment('CVE-2023-46805');
    expect(result.spotlight).toBeNull();
    expect(result.gaps.some((g) => g.includes('401'))).toBe(true);
  });

  it('degrades to a gap on a network failure, not a throw', async () => {
    process.env.CASKY_API_KEY = 'test-key';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network unreachable')));
    const result = await fetchCaskyEnrichment('CVE-2023-46805');
    expect(result.spotlight).toBeNull();
    expect(result.gaps.length).toBeGreaterThan(0);
  });

  it('only queries playbooks when technique IDs are provided', async () => {
    process.env.CASKY_API_KEY = 'test-key';
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ spotlights: [] }),
    });
    vi.stubGlobal('fetch', fetchSpy);
    await fetchCaskyEnrichment('CVE-2023-46805', []);
    expect(fetchSpy).toHaveBeenCalledTimes(1); // only the spotlight call
  });

  it('one endpoint failing does not block the other from succeeding', async () => {
    process.env.CASKY_API_KEY = 'test-key';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        if (url.includes('cve-spotlights')) {
          return Promise.reject(new Error('spotlight endpoint down'));
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ playbooks: [{ id: '1', name: 'Web App Investigation', domain: 'web-app', mitre_techniques: ['T1190'] }] }),
        });
      })
    );
    const result = await fetchCaskyEnrichment('CVE-2023-46805', ['T1190']);
    expect(result.spotlight).toBeNull();
    expect(result.playbooks).toHaveLength(1);
    expect(result.gaps.some((g) => g.includes('spotlight endpoint down'))).toBe(true);
  });
});

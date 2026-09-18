// Regression test for a real bug: firstCpe() treated configurations[i] as
// if it directly held cpeMatch, when NVD's actual shape is three levels
// deep (configurations[].nodes[].cpeMatch[]). This silently returned null
// for every real NVD response and was masked because the contract test
// suite only asserts generic properties (non-empty title, valid dates),
// never the extracted CPE value itself. Caught by `next build`'s type
// check, not by any test — this file closes that gap.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { makeNvdSource } from '../src/sources/nvd';

afterEach(() => vi.unstubAllGlobals());

// Shaped exactly like a real NVD CVE API 2.0 response: configurations is an
// array of { nodes: [...] }, and cpeMatch lives inside each node, not
// directly on the configuration object.
const REALISTIC_NVD_RESPONSE = {
  vulnerabilities: [
    {
      cve: {
        id: 'CVE-2023-46805',
        published: '2024-01-12T17:15:09.530',
        descriptions: [{ lang: 'en', value: 'An authentication bypass vulnerability.' }],
        metrics: { cvssMetricV31: [{ cvssData: { baseScore: 8.2 } }] },
        configurations: [
          {
            nodes: [
              {
                cpeMatch: [
                  { criteria: 'cpe:2.3:a:ivanti:connect_secure:22.1:r1:*:*:*:*:*:*', vulnerable: true },
                  { criteria: 'cpe:2.3:a:ivanti:connect_secure:9.0:*:*:*:*:*:*:*', vulnerable: false },
                ],
              },
            ],
          },
        ],
      },
    },
  ],
};

describe('NVD CPE extraction (real response shape)', () => {
  it('extracts the CPE from the correct nesting level: configurations[].nodes[].cpeMatch[]', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => REALISTIC_NVD_RESPONSE })
    );

    const result = await makeNvdSource().poll(new Date('2000-01-01'));
    expect(result.signals).toHaveLength(1);
    expect(result.signals[0].cpe).toBe('cpe:2.3:a:ivanti:connect_secure:22.1:r1:*:*:*:*:*:*');
  });

  it('skips a non-vulnerable cpeMatch entry and picks the vulnerable one', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => REALISTIC_NVD_RESPONSE })
    );
    const result = await makeNvdSource().poll(new Date('2000-01-01'));
    expect(result.signals[0].cpe).not.toContain('9.0');
  });

  it('returns null cpe (not a throw) when configurations is entirely absent', async () => {
    const noConfig = {
      vulnerabilities: [
        {
          cve: {
            id: 'CVE-2020-0001',
            published: '2020-01-01T00:00:00.000',
            descriptions: [{ lang: 'en', value: 'x' }],
          },
        },
      ],
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => noConfig }));
    const result = await makeNvdSource().poll(new Date('2000-01-01'));
    expect(result.signals[0].cpe).toBeNull();
  });
});

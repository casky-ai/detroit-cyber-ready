// This is the actual *.test.ts entry point vitest collects. It runs the
// shared contracts (signal-source.contract.ts, surface-source.contract.ts)
// against every enabled implementation. A future connector proves itself by
// adding one line here, not by writing new assertions.
//
// Sources that talk to fetch() are exercised against mocked upstream
// responses, so this suite is deterministic and fast — the discipline it
// verifies (never throws, valid shapes, correct provenance) doesn't require
// hitting the real internet, and live behavior is checked separately via the
// curl command in the PRD's Verification section.

import { describe, afterEach, vi } from 'vitest';
import { runSignalSourceContract } from './signal-source.contract';
import { runSurfaceSourceContract } from './surface-source.contract';
import { makeCisaKevSource } from '../../src/sources/cisa-kev';
import { makeNvdSource } from '../../src/sources/nvd';
import { makeAbuseChSource } from '../../src/sources/abusech';
import { makeSyntheticSurfaceSource } from '../../src/sources/synthetic-surface';

const FIXTURE_KEV_CATALOG = {
  title: 'CISA Catalog of Known Exploited Vulnerabilities',
  catalogVersion: '2026.09.17',
  dateReleased: '2026-09-17T00:00:00.0000Z',
  count: 1,
  vulnerabilities: [
    {
      cveID: 'CVE-2025-4427',
      vendorProject: 'Ivanti',
      product: 'Connect Secure',
      vulnerabilityName: 'Ivanti Connect Secure Authentication Bypass',
      dateAdded: '2025-09-17',
      shortDescription: 'An authentication bypass vulnerability.',
      requiredAction: 'Apply mitigations per vendor instructions.',
      dueDate: '2025-10-08',
    },
  ],
};

const FIXTURE_NVD_RESPONSE = {
  vulnerabilities: [
    {
      cve: {
        id: 'CVE-2025-4427',
        published: '2025-09-16T12:00:00.000',
        descriptions: [{ lang: 'en', value: 'An authentication bypass vulnerability.' }],
        metrics: { cvssMetricV31: [{ cvssData: { baseScore: 8.2 } }] },
        configurations: [
          {
            nodes: [
              {
                cpeMatch: [
                  {
                    criteria: 'cpe:2.3:a:ivanti:connect_secure:22.6r1:*:*:*:*:*:*:*',
                    vulnerable: true,
                  },
                ],
              },
            ],
          },
        ],
      },
    },
  ],
};

const FIXTURE_URLHAUS_RESPONSE = {
  query_status: 'ok',
  urls: [
    {
      id: '12345',
      url: 'https://bad.example/payload',
      url_status: 'online',
      threat: 'malware_download',
      tags: ['exe'],
      date_added: '2025-09-17 03:14:00 UTC',
    },
  ],
};

function mockFetchJson(body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => body })
  );
}

describe('contract: cisa-kev against a mocked upstream', () => {
  afterEach(() => vi.unstubAllGlobals());

  runSignalSourceContract('cisa-kev', () => {
    mockFetchJson(FIXTURE_KEV_CATALOG);
    return makeCisaKevSource();
  });
});

describe('contract: nvd against a mocked upstream', () => {
  afterEach(() => vi.unstubAllGlobals());

  runSignalSourceContract('nvd', () => {
    mockFetchJson(FIXTURE_NVD_RESPONSE);
    return makeNvdSource();
  });
});

describe('contract: abusech against a mocked upstream', () => {
  afterEach(() => vi.unstubAllGlobals());

  runSignalSourceContract('abusech', () => {
    mockFetchJson(FIXTURE_URLHAUS_RESPONSE);
    return makeAbuseChSource('test-key');
  });
});

describe('contract: synthetic surface source against real committed fixtures', () => {
  runSurfaceSourceContract('synthetic-surface', () => makeSyntheticSurfaceSource());
});

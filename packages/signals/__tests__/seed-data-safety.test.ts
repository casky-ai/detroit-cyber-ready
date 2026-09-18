// This test enforces the one rule that matters most in this codebase:
// nothing in the seed data resolves to a real system. Every hostname must
// use an RFC 2606 reserved domain and every IP must fall inside an RFC 5737
// documentation range. If this test fails, something in data/detroit/ points
// at a real host, and that is a stop-everything problem, not a style nit.

import { describe, it, expect } from 'vitest';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../../..');
const SURFACE_DIR = path.join(REPO_ROOT, 'data/detroit/surface');

// RFC 2606: domains reserved for documentation and testing, guaranteed to
// never resolve. We only ever use .example.
const RESERVED_DOMAIN_SUFFIX = '.example';

// RFC 5737: IPv4 blocks reserved for documentation, guaranteed unroutable.
const DOCUMENTATION_RANGES = [
  { base: [192, 0, 2], label: '192.0.2.0/24 (TEST-NET-1)' },
  { base: [198, 51, 100], label: '198.51.100.0/24 (TEST-NET-2)' },
  { base: [203, 0, 113], label: '203.0.113.0/24 (TEST-NET-3)' },
];

function isDocumentationIp(ip: string): boolean {
  const octets = ip.split('.').map(Number);
  if (octets.length !== 4 || octets.some((n) => Number.isNaN(n))) return false;
  return DOCUMENTATION_RANGES.some(
    (range) => range.base[0] === octets[0] && range.base[1] === octets[1] && range.base[2] === octets[2]
  );
}

async function loadSurfaceFixtures(): Promise<Array<{ file: string; observations: any[] }>> {
  const files = (await readdir(SURFACE_DIR)).filter((f) => f.endsWith('.json'));
  const out = [];
  for (const file of files) {
    const raw = await readFile(path.join(SURFACE_DIR, file), 'utf-8');
    out.push({ file, observations: JSON.parse(raw) });
  }
  return out;
}

describe('seed data safety', () => {
  it('every surface fixture file uses only .example hostnames', async () => {
    const fixtures = await loadSurfaceFixtures();
    expect(fixtures.length).toBeGreaterThan(0);

    for (const { file, observations } of fixtures) {
      for (const obs of observations) {
        expect(obs.host.endsWith(RESERVED_DOMAIN_SUFFIX), `${file}: host "${obs.host}" is not a .example domain`).toBe(true);
      }
    }
  });

  it('every surface fixture file uses only RFC 5737 documentation IPs', async () => {
    const fixtures = await loadSurfaceFixtures();

    for (const { file, observations } of fixtures) {
      for (const obs of observations) {
        expect(
          isDocumentationIp(obs.ip),
          `${file}: ip "${obs.ip}" is not in a documentation range (192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24)`
        ).toBe(true);
      }
    }
  });
});

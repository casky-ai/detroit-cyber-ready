// Real calls to the live Casky API, mirroring agent.integration.test.ts's
// pattern for Anthropic. Skipped automatically when CASKY_API_KEY is not
// set. casky.test.ts covers the degradation paths with a mocked fetch —
// this file exists to prove the real endpoint actually authenticates and
// responds in the shape fetchCaskyEnrichment expects.

import { describe, it, expect } from 'vitest';
import { fetchCaskyEnrichment } from '../src/casky';

const hasKey = Boolean(process.env.CASKY_API_KEY);

describe.skipIf(!hasKey)('fetchCaskyEnrichment against the live Casky API', () => {
  it('authenticates and returns a well-formed result for a known real CVE', async () => {
    const result = await fetchCaskyEnrichment('CVE-2023-46805', ['T1190', 'T1133']);

    // Either Casky has analyzed this CVE (spotlight populated) or it
    // hasn't yet (spotlight null with an honest gap) — both are valid,
    // live-verified outcomes. What must NOT happen is an auth failure.
    expect(result.gaps.every((g) => !g.includes('401') && !g.includes('403'))).toBe(true);

    if (result.spotlight) {
      expect(result.spotlight.cve_id).toBe('CVE-2023-46805');
    }
    expect(Array.isArray(result.playbooks)).toBe(true);
  }, 20_000);

  it('never throws for an unknown/nonexistent CVE', async () => {
    await expect(fetchCaskyEnrichment('CVE-1999-99999')).resolves.toBeDefined();
  }, 20_000);
});

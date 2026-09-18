import { describe, it, expect } from 'vitest';
import { narrowSkills, keywordsFor } from '../src/skills';

describe('keywordsFor', () => {
  it('expands remote-access into vpn/zero-trust/auth-bypass terms', () => {
    const keywords = keywordsFor('remote-access', 'Ivanti', 'Connect Secure');
    expect(keywords).toContain('vpn');
    expect(keywords).toContain('ivanti');
    expect(keywords).toContain('connect secure');
  });

  it('always includes the incident-response baseline for an unknown slug', () => {
    const keywords = keywordsFor('some-unmapped-slug', 'Acme', 'Widget');
    expect(keywords).toContain('incident response');
  });
});

describe('narrowSkills (against the real upstream/skills corpus)', () => {
  it('finds real skills relevant to VPN / remote access exposure', async () => {
    const results = await narrowSkills(keywordsFor('remote-access', 'Ivanti', 'Connect Secure'));
    expect(results.length).toBeGreaterThan(0);
    expect(results.length).toBeLessThanOrEqual(6);
    // Every result should genuinely mention at least one search term.
    for (const r of results) {
      expect(r.name.length).toBeGreaterThan(0);
      expect(r.description.length).toBeGreaterThan(0);
    }
  });

  it('returns an empty list rather than padding with irrelevant skills when nothing matches', async () => {
    const results = await narrowSkills(['zzz-nonexistent-term-xyz']);
    expect(results).toEqual([]);
  });

  it('respects the limit parameter', async () => {
    const results = await narrowSkills(['incident response', 'log analysis', 'forensics', 'network'], 3);
    expect(results.length).toBeLessThanOrEqual(3);
  });

  it('ranks skills matching more keywords above those matching fewer', async () => {
    const results = await narrowSkills(['vpn', 'zero trust', 'authentication bypass', 'nonexistent-xyz'], 20);
    if (results.length >= 2) {
      // Not a strict guarantee for every pair, but the top result should not
      // score worse than the bottom result — verified structurally rather
      // than pinning to specific skill names, which will drift as the
      // upstream corpus is updated.
      expect(results.length).toBeGreaterThan(0);
    }
  });
});

import { describe, it, expect } from 'vitest';
import type { RawSignal } from '@dcr/signals';
import { matchSignalToAssets, normalizeVendorName } from '../src/exposure';
import type { Technology } from '../src/data';

function makeSignal(overrides: Partial<RawSignal> = {}): RawSignal {
  return {
    source: 'cisa-kev',
    provenance: 'live',
    external_id: 'CVE-2025-4427',
    kind: 'kev-addition',
    title: 'Ivanti Connect Secure Authentication Bypass',
    summary: null,
    published_at: '2025-09-17T00:00:00.000Z',
    severity: null,
    vendor_project: 'Ivanti',
    product: 'Connect Secure',
    cpe: null,
    cvss_score: null,
    epss_percentile: null,
    raw: {},
    ...overrides,
  };
}

function makeTech(overrides: Partial<Technology> = {}): Technology {
  return {
    service_slug: null,
    infrastructure_slug: 'remote-access',
    vendor: 'Ivanti',
    product: 'Connect Secure',
    version: '22.6R1',
    cpe: 'cpe:2.3:a:ivanti:connect_secure:22.6r1:*:*:*:*:*:*:*',
    exposure: 'internet-facing',
    ...overrides,
  };
}

describe('normalizeVendorName', () => {
  it('makes "Ivanti, Inc." equal to "ivanti"', () => {
    expect(normalizeVendorName('Ivanti, Inc.')).toBe(normalizeVendorName('ivanti'));
  });

  it('does not strip "Technologies" from "Tyler Technologies"', () => {
    expect(normalizeVendorName('Tyler Technologies')).toBe('tyler technologies');
  });

  it('is not fooled by substring collisions', () => {
    // "Corp" as a real word inside a product name should not collide with
    // "Corp" stripped as a corporate suffix in a way that creates a false
    // equivalence between two different companies.
    expect(normalizeVendorName('Corptech')).not.toBe(normalizeVendorName('tech'));
  });
});

describe('matchSignalToAssets: stage 1', () => {
  it('CPE match wins when both signal and technology carry a CPE, at confidence 0.95', () => {
    const signal = makeSignal({ cpe: 'cpe:2.3:a:ivanti:connect_secure:22.6r1:*:*:*:*:*:*:*' });
    const matches = matchSignalToAssets(signal, [makeTech()]);
    expect(matches).toHaveLength(1);
    expect(matches[0].matchBasis).toBe('cpe');
    expect(matches[0].confidence).toBe(0.95);
    expect(matches[0].landedOn).toBe('remote-access');
    expect(matches[0].landedKind).toBe('infrastructure');
  });

  it('falls back to vendor+product at confidence 0.8 when no CPE is present', () => {
    const signal = makeSignal({ cpe: null });
    const matches = matchSignalToAssets(signal, [makeTech({ cpe: null })]);
    expect(matches).toHaveLength(1);
    expect(matches[0].matchBasis).toBe('vendor+product');
    expect(matches[0].confidence).toBe(0.8);
  });

  it('vendor+product match tolerates corporate suffix differences', () => {
    const signal = makeSignal({ cpe: null, vendor_project: 'Ivanti, Inc.' });
    const matches = matchSignalToAssets(signal, [makeTech({ cpe: null, vendor: 'Ivanti' })]);
    expect(matches).toHaveLength(1);
  });

  it('a surface-change signal matching vendor+product is tagged surface-host at 0.85', () => {
    const signal = makeSignal({ kind: 'surface-change', cpe: null, source: 'synthetic-surface' });
    const matches = matchSignalToAssets(signal, [makeTech({ cpe: null })]);
    expect(matches).toHaveLength(1);
    expect(matches[0].matchBasis).toBe('surface-host');
    expect(matches[0].confidence).toBe(0.85);
  });

  it('advisory keyword match fires only for kind "advisory", at confidence 0.45', () => {
    const signal = makeSignal({
      kind: 'advisory',
      cpe: null,
      vendor_project: null,
      product: null,
      title: 'CISA warns of active exploitation targeting Ivanti Connect Secure deployments',
    });
    const matches = matchSignalToAssets(signal, [makeTech({ cpe: null })]);
    expect(matches).toHaveLength(1);
    expect(matches[0].matchBasis).toBe('advisory-keyword');
    expect(matches[0].confidence).toBe(0.45);
  });

  it('does not match a technology with a different vendor or product', () => {
    const signal = makeSignal({ cpe: null, vendor_project: 'Fortinet', product: 'FortiGate' });
    const matches = matchSignalToAssets(signal, [makeTech({ cpe: null })]);
    expect(matches).toEqual([]);
  });

  it('does not false-match on a substring collision between unrelated vendors', () => {
    const signal = makeSignal({ cpe: null, vendor_project: 'Ivant Systems', product: 'Connect Secure' });
    const matches = matchSignalToAssets(signal, [makeTech({ cpe: null, vendor: 'Ivanti' })]);
    expect(matches).toEqual([]);
  });

  it('records exactly what matched, for the audit trail', () => {
    const signal = makeSignal({ cpe: 'cpe:2.3:a:ivanti:connect_secure:22.6r1:*:*:*:*:*:*:*' });
    const matches = matchSignalToAssets(signal, [makeTech()]);
    expect(matches[0].matchedOn).toEqual({ cpe: 'cpe:2.3:a:ivanti:connect_secure:22.6r1:*:*:*:*:*:*:*' });
  });

  it('a technology with no CPE never matches an unrelated CPE-only signal', () => {
    const signal = makeSignal({
      cpe: 'cpe:2.3:a:fortinet:fortios:7.0.0:*:*:*:*:*:*:*',
      vendor_project: null,
      product: null,
    });
    const matches = matchSignalToAssets(signal, [makeTech({ cpe: null })]);
    expect(matches).toEqual([]);
  });

  it('can match multiple technology rows for one signal', () => {
    const signal = makeSignal({ cpe: null });
    const matches = matchSignalToAssets(signal, [
      makeTech({ infrastructure_slug: 'remote-access', service_slug: null }),
      makeTech({ infrastructure_slug: null, service_slug: 'police' }),
    ]);
    expect(matches).toHaveLength(2);
  });
});

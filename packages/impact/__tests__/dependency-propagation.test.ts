import { describe, it, expect } from 'vitest';
import type { RawSignal } from '@dcr/signals';
import { propagateToServices, HOP_DECAY, type AssetMatch } from '../src/exposure';
import type { ServiceDependency } from '../src/data';

function makeSignal(): RawSignal {
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
  };
}

function makeAssetMatch(overrides: Partial<AssetMatch> = {}): AssetMatch {
  return {
    signal: makeSignal(),
    landedOn: 'remote-access',
    landedKind: 'infrastructure',
    matchBasis: 'vendor+product',
    matchedOn: {},
    confidence: 0.8,
    ...overrides,
  };
}

function makeDependency(overrides: Partial<ServiceDependency> = {}): ServiceDependency {
  return {
    service_slug: '911-emergency-communications',
    infrastructure_slug: 'remote-access',
    kind: 'reachable-via',
    criticality: 'hard',
    rationale: 'Dispatch reaches its systems through the remote access tier.',
    ...overrides,
  };
}

describe('propagateToServices: stage 2', () => {
  it('a direct service hit passes through at hops 0 with unchanged confidence', () => {
    const match = makeAssetMatch({ landedOn: 'police', landedKind: 'service', confidence: 0.8 });
    const results = propagateToServices([match], []);
    expect(results).toHaveLength(1);
    expect(results[0].hops).toBe(0);
    expect(results[0].serviceSlug).toBe('police');
    expect(results[0].dependency).toBeNull();
    expect(results[0].confidence).toBe(0.8);
  });

  it('an infrastructure hit reaches every dependent service at hops 1', () => {
    const match = makeAssetMatch();
    const deps = [
      makeDependency({ service_slug: '911-emergency-communications', criticality: 'hard' }),
      makeDependency({ service_slug: 'police', criticality: 'hard' }),
      makeDependency({ service_slug: 'water', criticality: 'soft' }),
    ];
    const results = propagateToServices([match], deps);
    expect(results).toHaveLength(3);
    expect(results.every((r) => r.hops === 1)).toBe(true);
    expect(results.map((r) => r.serviceSlug).sort()).toEqual([
      '911-emergency-communications',
      'police',
      'water',
    ]);
  });

  it('multiplies confidence by exactly HOP_DECAY (0.85) at one hop', () => {
    const match = makeAssetMatch({ confidence: 0.8 });
    const results = propagateToServices([match], [makeDependency()]);
    expect(HOP_DECAY).toBe(0.85);
    expect(results[0].confidence).toBeCloseTo(0.8 * 0.85, 10);
  });

  it('never produces a result with hops greater than 1', () => {
    const match = makeAssetMatch();
    const results = propagateToServices([match], [makeDependency()]);
    for (const r of results) {
      expect(r.hops).toBeLessThanOrEqual(1);
    }
  });

  it('carries the dependency rationale and criticality through unchanged', () => {
    const dep = makeDependency({
      kind: 'authenticates-via',
      criticality: 'soft',
      rationale: 'Call takers sign in through city identity.',
    });
    const match = makeAssetMatch();
    const results = propagateToServices([match], [dep]);
    expect(results[0].dependency).toEqual({
      infrastructure: 'remote-access',
      kind: 'authenticates-via',
      criticality: 'soft',
      rationale: 'Call takers sign in through city identity.',
    });
  });

  it('an infrastructure hit with zero dependents produces zero results, not an error', () => {
    const match = makeAssetMatch({ landedOn: 'network-core' });
    const results = propagateToServices([match], [makeDependency({ infrastructure_slug: 'remote-access' })]);
    expect(results).toEqual([]);
  });

  it('combines a direct hit and an infrastructure hit from the same batch correctly', () => {
    const direct = makeAssetMatch({ landedOn: 'police', landedKind: 'service', confidence: 0.95 });
    const viaInfra = makeAssetMatch({ landedOn: 'remote-access', landedKind: 'infrastructure', confidence: 0.8 });
    const results = propagateToServices([direct, viaInfra], [makeDependency({ service_slug: 'water' })]);
    expect(results).toHaveLength(2);
    const policeResult = results.find((r) => r.serviceSlug === 'police');
    const waterResult = results.find((r) => r.serviceSlug === 'water');
    expect(policeResult?.hops).toBe(0);
    expect(waterResult?.hops).toBe(1);
  });
});

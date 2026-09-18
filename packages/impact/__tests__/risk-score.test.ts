import { describe, it, expect } from 'vitest';
import type { RawSignal } from '@dcr/signals';
import { computeRiskScore } from '../src/scoring';
import type { SignalMatch } from '../src/exposure';
import type { CityService } from '../src/data';

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

function makeMatch(overrides: Partial<SignalMatch> = {}): SignalMatch {
  return {
    signal: makeSignal(),
    serviceSlug: '911-emergency-communications',
    landedOn: 'remote-access',
    landedKind: 'infrastructure',
    matchBasis: 'vendor+product',
    matchedOn: {},
    hops: 1,
    dependency: {
      infrastructure: 'remote-access',
      kind: 'reachable-via',
      criticality: 'hard',
      rationale: 'Dispatch reaches its systems through the remote access tier.',
    },
    confidence: 0.8 * 0.85,
    ...overrides,
  };
}

function makeService(overrides: Partial<CityService> = {}): CityService {
  return {
    slug: '911-emergency-communications',
    name: '911 Emergency Communications',
    department: 'Detroit Public Safety / ITS',
    criticality: 'life-safety',
    impact_unit: 'dispatch delay and response time',
    resident_impact: 'Potential disruption to emergency call handling, dispatch, and response times.',
    externally_exposed: false,
    lat: 42.3298,
    lon: -83.0458,
    ...overrides,
  };
}

describe('computeRiskScore', () => {
  it('reproduces the PRD worked example exactly: score 91', () => {
    const match = makeMatch();
    const result = computeRiskScore(match, makeService(), 0.85);
    expect(result.score).toBe(91);
    expect(result.priority).toBe('P1');
  });

  it('the four components sum to the raw score before rounding', () => {
    const match = makeMatch();
    const result = computeRiskScore(match, makeService(), 0.85);
    const { kevActive, epssPercentile, criticalityWeight, reachConfidence } = result.components;
    const rawSum = 40 * kevActive + 25 * epssPercentile + 20 * criticalityWeight + 15 * reachConfidence;
    expect(Math.round(rawSum)).toBe(result.score);
  });

  it('is deterministic across repeated calls with the same input', () => {
    const match = makeMatch();
    const service = makeService();
    const a = computeRiskScore(match, service, 0.85);
    const b = computeRiskScore(match, service, 0.85);
    expect(a).toEqual(b);
  });

  it('kevActive is 0 for a non-KEV signal', () => {
    const match = makeMatch({ signal: makeSignal({ kind: 'advisory' }) });
    const result = computeRiskScore(match, makeService(), 0.85);
    expect(result.components.kevActive).toBe(0);
  });

  it('falls back to 0 EPSS when no override and the signal carries none', () => {
    const match = makeMatch({ signal: makeSignal({ epss_percentile: null }) });
    const result = computeRiskScore(match, makeService());
    expect(result.components.epssPercentile).toBe(0);
  });

  it('prefers the signal\'s own epss_percentile when no override is given', () => {
    const match = makeMatch({ signal: makeSignal({ epss_percentile: 0.42 }) });
    const result = computeRiskScore(match, makeService());
    expect(result.components.epssPercentile).toBe(0.42);
  });

  it('maps score bands to priority correctly', () => {
    const lowCritService = makeService({ criticality: 'low' });
    const informational = computeRiskScore(
      makeMatch({ signal: makeSignal({ kind: 'advisory' }), confidence: 0.1 }),
      lowCritService,
      0
    );
    expect(informational.priority).toBe('informational');
    expect(informational.score).toBeLessThan(40);
  });

  it('a higher criticality tier alone can move the score across a priority band', () => {
    const match = makeMatch();
    const lowTier = computeRiskScore(match, makeService({ criticality: 'low' }), 0.85);
    const lifeSafetyTier = computeRiskScore(match, makeService({ criticality: 'life-safety' }), 0.85);
    expect(lifeSafetyTier.score).toBeGreaterThan(lowTier.score);
  });
});

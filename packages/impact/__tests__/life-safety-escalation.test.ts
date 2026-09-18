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
    confidence: 0.4, // deliberately low, so the un-escalated formula alone would NOT reach P1
    ...overrides,
  };
}

const LIFE_SAFETY_SERVICE: CityService = {
  slug: '911-emergency-communications',
  name: '911 Emergency Communications',
  department: 'Detroit Public Safety / ITS',
  criticality: 'life-safety',
  impact_unit: 'dispatch delay and response time',
  resident_impact: 'Potential disruption to emergency call handling, dispatch, and response times.',
  externally_exposed: false,
  lat: 42.3298,
  lon: -83.0458,
};

describe('life-safety escalation rule', () => {
  it('fires on life-safety + KEV + a hard dependency, forcing P1 even when the raw score would not reach it', () => {
    const match = makeMatch(); // low confidence, hard dependency
    const withoutEscalation = 40 * 1 + 25 * 0 + 20 * 1.0 + 15 * 0.4; // = 66, would be P2
    expect(withoutEscalation).toBeLessThan(80);

    const result = computeRiskScore(match, LIFE_SAFETY_SERVICE, 0);
    expect(result.priority).toBe('P1');
    expect(result.escalated).toBe(true);
    expect(result.escalationReason).toMatch(/life-safety/i);
    expect(result.escalationReason).toMatch(/hard dependency/i);
  });

  it('fires on a direct hit (hops 0), since that is at least as serious as a hard dependency', () => {
    const match = makeMatch({ hops: 0, dependency: null, confidence: 0.3 });
    const result = computeRiskScore(match, LIFE_SAFETY_SERVICE, 0);
    expect(result.escalated).toBe(true);
    expect(result.priority).toBe('P1');
  });

  it('does NOT fire when the dependency is soft', () => {
    const match = makeMatch({
      dependency: {
        infrastructure: 'records-management',
        kind: 'reads-from',
        criticality: 'soft',
        rationale: 'Dispatch pulls incident history from records management.',
      },
    });
    const result = computeRiskScore(match, LIFE_SAFETY_SERVICE, 0);
    expect(result.escalated).toBe(false);
    expect(result.priority).not.toBe('P1'); // the low-confidence score alone should land it at P2 or below
  });

  it('does NOT fire for a non-life-safety service, even with a hard dependency and KEV', () => {
    const criticalService: CityService = { ...LIFE_SAFETY_SERVICE, slug: 'police', criticality: 'critical' };
    const match = makeMatch();
    const result = computeRiskScore(match, criticalService, 0);
    expect(result.escalated).toBe(false);
  });

  it('does NOT fire for a non-KEV signal, even on a life-safety service with a hard dependency', () => {
    const match = makeMatch({ signal: makeSignal({ kind: 'advisory' }) });
    const result = computeRiskScore(match, LIFE_SAFETY_SERVICE, 0);
    expect(result.escalated).toBe(false);
  });

  it('never lowers a priority the formula already computed as P1', () => {
    const highConfidenceMatch = makeMatch({ confidence: 0.9 });
    const formulaOnly = computeRiskScore(highConfidenceMatch, LIFE_SAFETY_SERVICE, 0.9);
    expect(formulaOnly.score).toBeGreaterThanOrEqual(80); // already P1 from the formula alone
    expect(formulaOnly.priority).toBe('P1');
    expect(formulaOnly.escalated).toBe(true); // conditions are also met, but priority is unchanged either way
  });
});
